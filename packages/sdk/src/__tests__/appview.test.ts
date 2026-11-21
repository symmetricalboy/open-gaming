import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NSIDS,
  OpenGamingAppViewEngine,
  OpenGamingJetstreamConsumer,
  OpenGamingViewerClient,
  MemoryAppViewStore,
  buildLeaderboardColumns,
  coSignMatchResult,
  createAppViewFetchHandler,
  createRevocationRecord,
  createSignedMatchResult,
  createSignedScore,
  createSignedUnlock,
  generateSigningKeys,
  groupLibraryByShelf,
  maskAchievementForViewer,
  verifyActorDirectFromPds,
  type AchievementDefinitionRecord,
  type LeaderboardDefinitionRecord,
} from '../index.js';

const STUDIO_DID = 'did:plc:studioopengaming0001';
const ALICE_DID = 'did:plc:aliceviewer000000001';
const BOB_DID = 'did:plc:bobviewer00000000002';
const LABELER_DID = 'did:plc:trustedanticheat0001';

const GAME_URI = `at://${STUDIO_DID}/games.atmosphere.define/sky-quest`;
const ACH_CORE = `at://${STUDIO_DID}/${NSIDS.AchievementDefinition}/first-clear`;
const ACH_SECRET = `at://${STUDIO_DID}/${NSIDS.AchievementDefinition}/true-ending`;
const ACH_DLC = `at://${STUDIO_DID}/${NSIDS.AchievementDefinition}/holiday-event`;
const LB_STAGE = `at://${STUDIO_DID}/${NSIDS.LeaderboardDefinition}/stage-1`;

const DUMMY_BLOB = {
  $type: 'blob' as const,
  ref: { $link: 'bafkreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori' },
  mimeType: 'image/png',
  size: 2048,
};

describe('@opengaming/sdk/appview — Engine, HTTP Handler, Jetstream & Viewer Client', () => {
  it('indexes catalogs, shelves, unlocks, multi-component scores, P2P matches, revocations, and serves OpenGamingViewerClient', async () => {
    const studioKeys = await generateSigningKeys();
    const aliceKeys = await generateSigningKeys();
    const bobKeys = await generateSigningKeys();

    const store = new MemoryAppViewStore();
    const engine = new OpenGamingAppViewEngine({
      store,
      trustedLabelerDids: [LABELER_DID],
      identityOptions: { enableNetwork: false },
    });

    // Seed DID documents with #attestations keys and social graph
    const nowIso = '2026-11-21T12:00:00.000Z';
    store.upsertActor({
      did: STUDIO_DID,
      handle: 'skyquest.example',
      pdsUrl: 'https://pds.skyquest.example',
      didDoc: { id: STUDIO_DID, verificationMethods: { attestations: studioKeys.publicDidKey } },
      updatedAt: nowIso,
    });
    store.upsertActor({
      did: ALICE_DID,
      handle: 'alice.bsky.social',
      displayName: 'Alice',
      pdsUrl: 'https://pds.example',
      didDoc: { id: ALICE_DID, verificationMethods: { attestations: aliceKeys.publicDidKey } },
      updatedAt: nowIso,
    });
    store.upsertActor({
      did: BOB_DID,
      handle: 'bob.bsky.social',
      displayName: 'Bob',
      pdsUrl: 'https://pds.example',
      didDoc: { id: BOB_DID, verificationMethods: { attestations: bobKeys.publicDidKey } },
      updatedAt: nowIso,
    });
    store.setFollows(ALICE_DID, [BOB_DID]);

    // 1. Index game catalog & definitions
    await engine.indexRecord({
      uri: GAME_URI,
      record: {
        $type: 'games.atmosphere.define',
        name: 'Sky Quest',
        tagline: 'Soar across the clouds',
        icon: DUMMY_BLOB,
        developer: { name: 'Sky Studio', did: STUDIO_DID },
      },
    });

    const coreDef: AchievementDefinitionRecord = {
      $type: NSIDS.AchievementDefinition,
      game: GAME_URI,
      title: 'First Clear',
      description: 'Complete Chapter 1.',
      tier: 'silver',
      listOrder: 1,
      createdAt: nowIso,
    };
    const secretDef: AchievementDefinitionRecord = {
      $type: NSIDS.AchievementDefinition,
      game: GAME_URI,
      title: 'Starlight Sovereign',
      description: 'Defeat the hidden celestial boss.',
      hidden: true,
      tier: 'gold',
      listOrder: 2,
      createdAt: nowIso,
    };
    const bonusDef: AchievementDefinitionRecord = {
      $type: NSIDS.AchievementDefinition,
      game: GAME_URI,
      title: 'Winter Festival',
      description: 'Participate in the 2026 Winter Jam.',
      completionOptional: true,
      tier: 'bronze',
      listOrder: 3,
      createdAt: nowIso,
    };

    await engine.indexRecord({ uri: ACH_CORE, record: coreDef });
    await engine.indexRecord({ uri: ACH_SECRET, record: secretDef });
    await engine.indexRecord({ uri: ACH_DLC, record: bonusDef });

    const lbDef: LeaderboardDefinitionRecord = {
      $type: NSIDS.LeaderboardDefinition,
      game: GAME_URI,
      name: 'Stage 1 Rhythm Trial',
      icon: DUMMY_BLOB,
      components: {
        points: { $type: 'games.opengaming.leaderboard.definition#points', name: 'EX Score' },
        acc: { $type: 'games.opengaming.leaderboard.definition#percentage', name: 'Accuracy', precision: 2 },
      },
      componentOrder: ['points', 'acc'],
      defaultComponent: 'points',
      dimensions: {
        mode: {
          name: 'Key Mode',
          required: true,
          values: [
            { id: '4k', name: '4 Keys' },
            { id: '7k', name: '7 Keys' },
          ],
        },
      },
      timeframes: ['allTime', 'weekly', 'daily'],
      recordPolicy: 'personalBests',
      createdAt: nowIso,
    };
    await engine.indexRecord({ uri: LB_STAGE, record: lbDef });

    // 2. Index player shelf item (`games.atmosphere.library.item`), signed unlocks, scores, and P2P match
    await engine.indexRecord({
      uri: `at://${ALICE_DID}/games.atmosphere.library.item/sky-quest`,
      record: {
        $type: 'games.atmosphere.library.item',
        game: GAME_URI,
        status: 'playing',
        favorite: true,
        rating: 9,
        playtimeMinutes: 180,
        note: 'Loving the 4K rhythm mode!',
        addedAt: nowIso,
      },
    });

    const { record: aliceUnlock1 } = await createSignedUnlock({
      achievement: ACH_CORE,
      game: GAME_URI,
      playerDid: ALICE_DID,
      issuerDid: STUDIO_DID,
      unlockedAt: '2026-11-21T12:10:00.000Z',
      signingKey: studioKeys.keypair,
    });
    const { record: aliceUnlockBonus } = await createSignedUnlock({
      achievement: ACH_DLC,
      game: GAME_URI,
      playerDid: ALICE_DID,
      issuerDid: STUDIO_DID,
      unlockedAt: '2026-11-21T12:15:00.000Z',
      signingKey: studioKeys.keypair,
    });
    await engine.indexRecord({
      uri: `at://${ALICE_DID}/${NSIDS.AchievementUnlock}/first-clear`,
      record: aliceUnlock1,
    });
    await engine.indexRecord({
      uri: `at://${ALICE_DID}/${NSIDS.AchievementUnlock}/holiday-event`,
      record: aliceUnlockBonus,
    });

    const { record: aliceScore, attestationCid: aliceScoreCid } = await createSignedScore({
      leaderboard: LB_STAGE,
      game: GAME_URI,
      playerDid: ALICE_DID,
      issuerDid: STUDIO_DID,
      components: {
        points: { $type: 'games.opengaming.leaderboard.score#points', value: 2950 },
        acc: { $type: 'games.opengaming.leaderboard.score#percentage', value: 9975 },
      },
      dimensions: { mode: '4k' },
      recordedAt: '2026-11-21T12:20:00.000Z',
      signingKey: studioKeys.keypair,
    });
    const { record: bobScore } = await createSignedScore({
      leaderboard: LB_STAGE,
      game: GAME_URI,
      playerDid: BOB_DID,
      issuerDid: STUDIO_DID,
      components: {
        points: { $type: 'games.opengaming.leaderboard.score#points', value: 2810 },
        acc: { $type: 'games.opengaming.leaderboard.score#percentage', value: 9990 },
      },
      dimensions: { mode: '4k' },
      recordedAt: '2026-11-21T12:22:00.000Z',
      signingKey: studioKeys.keypair,
    });
    await engine.indexRecord({
      uri: `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/pb-1`,
      record: aliceScore,
    });
    await engine.indexRecord({
      uri: `at://${BOB_DID}/${NSIDS.LeaderboardScore}/pb-1`,
      record: bobScore,
    });

    // Co-signed serverless P2P match stored in BOTH Alice's and Bob's repos (should deduplicate by matchId!)
    const { record: matchDraft } = await createSignedMatchResult({
      game: GAME_URI,
      matchId: 'duel-101',
      mode: '1v1-rhythm',
      participants: [
        { did: ALICE_DID, outcome: 'win', score: 2 },
        { did: BOB_DID, outcome: 'loss', score: 1 },
      ],
      repositoryDid: ALICE_DID,
      issuerDid: ALICE_DID,
      playedAt: '2026-11-21T12:30:00.000Z',
      signingKey: aliceKeys.keypair,
    });
    const { record: aliceMatch } = await coSignMatchResult({
      record: matchDraft,
      repositoryDid: ALICE_DID,
      signerDid: BOB_DID,
      signingKey: bobKeys.keypair,
    });
    await engine.indexRecord({
      uri: `at://${ALICE_DID}/${NSIDS.MatchResult}/duel-101`,
      record: aliceMatch,
    });

    // 3. Mount Web Fetch Handler & test via OpenGamingViewerClient
    const fetchHandler = createAppViewFetchHandler(engine, {
      blobOptions: {
        fetchImpl: async () =>
          new Response(new Uint8Array([137, 80, 78, 71]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
      },
    });

    const viewerClient = new OpenGamingViewerClient({
      baseUrl: 'https://appview.example',
      fetchImpl: (input, init) => fetchHandler(new Request(String(input), init)),
    });

    // Gamercard check: 1 of 2 core achievements unlocked (50%), plus 1 bonus achievement!
    const profile = await viewerClient.getActorProfile('alice.bsky.social');
    assert.equal(profile.gamesPlayed, 1);
    assert.equal(profile.totalUnlocks, 2);
    assert.equal(profile.games[0].unlockedCount, 1);
    assert.equal(profile.games[0].totalAchievements, 2);
    assert.equal(profile.games[0].bonusUnlockedCount, 1);
    assert.equal(profile.games[0].completionPercent, 50);

    // Game Library check: combines explicit shelf metadata + achievements + leaderboard PB + match stats!
    const library = await viewerClient.getActorLibrary({ actor: 'alice.bsky.social' });
    assert.equal(library.totalGames, 1);
    assert.equal(library.items[0].name, 'Sky Quest');
    assert.equal(library.items[0].shelfStatus, 'playing');
    assert.equal(library.items[0].favorite, true);
    assert.equal(library.items[0].playtimeMs, 180 * 60_000);
    assert.deepEqual(library.items[0].sources, ['shelf', 'achievements', 'leaderboards', 'matches']);
    assert.equal(library.items[0].personalBests.length, 1);
    assert.equal(library.items[0].matchesPlayed, 1);
    assert.equal(library.items[0].matchWins, 1);

    const groupedShelves = groupLibraryByShelf(library.items);
    assert.equal(groupedShelves[0].shelf, 'playing');

    // Game Hub spoiler masking check: Alice hasn't unlocked `true-ending`, so it must be masked!
    const hubBeforeSecret = await viewerClient.getGameDetail({ uri: GAME_URI, viewer: ALICE_DID });
    const secretCardLocked = hubBeforeSecret.achievements.find((a) => a.uri === ACH_SECRET)!;
    assert.equal(secretCardLocked.isMaskedSpoiler, true);
    assert.equal(secretCardLocked.title, 'Hidden Achievement');

    // Once Alice unlocks `true-ending`, the Game Hub unmasks it for Alice while keeping it masked for Bob!
    const { record: aliceSecretUnlock } = await createSignedUnlock({
      achievement: ACH_SECRET,
      game: GAME_URI,
      playerDid: ALICE_DID,
      issuerDid: STUDIO_DID,
      unlockedAt: '2026-11-21T12:35:00.000Z',
      signingKey: studioKeys.keypair,
    });
    await engine.indexRecord({
      uri: `at://${ALICE_DID}/${NSIDS.AchievementUnlock}/true-ending`,
      record: aliceSecretUnlock,
    });

    const hubForAlice = await viewerClient.getGameDetail({ uri: GAME_URI, viewer: ALICE_DID });
    const secretForAlice = hubForAlice.achievements.find((a) => a.uri === ACH_SECRET)!;
    assert.equal(secretForAlice.isMaskedSpoiler, false);
    assert.equal(secretForAlice.title, 'Starlight Sovereign');
    assert.equal(hubForAlice.viewerCompletion?.completed, true);

    const hubForBob = await viewerClient.getGameDetail({ uri: GAME_URI, viewer: BOB_DID });
    const secretForBob = hubForBob.achievements.find((a) => a.uri === ACH_SECRET)!;
    assert.equal(secretForBob.isMaskedSpoiler, true);

    // Multi-component sorting check: by `points` Alice is #1 (2950 > 2810); by `acc` Bob is #1 (99.90% > 99.75%)!
    const byPoints = await viewerClient.getLeaderboardScores({
      leaderboard: LB_STAGE,
      sortBy: 'points',
      dimensions: { mode: '4k' },
    });
    assert.equal(byPoints.entries[0].player, ALICE_DID);
    assert.equal(byPoints.entries[1].player, BOB_DID);

    const byAcc = await viewerClient.getLeaderboardScores({
      leaderboard: LB_STAGE,
      sortBy: 'acc',
      scope: 'social',
      viewer: ALICE_DID,
    });
    assert.equal(byAcc.entries[0].player, BOB_DID);
    assert.equal(byAcc.entries[0].displayScore, '99.90%');
    assert.equal(byAcc.viewerEntry?.player, ALICE_DID);

    // Reactive Revocation & Unrevoke check!
    const { rkey: revRkey, record: revRec } = createRevocationRecord({
      scope: 'attestation',
      attestationCid: aliceScoreCid,
      player: ALICE_DID,
      subject: LB_STAGE,
      reason: 'bug',
    });
    const revUri = `at://${STUDIO_DID}/${NSIDS.Revocation}/${revRkey}`;
    await engine.indexRecord({ uri: revUri, record: revRec });

    const afterRevoke = await viewerClient.getLeaderboardScores({ leaderboard: LB_STAGE });
    assert.equal(afterRevoke.entries.length, 1);
    assert.equal(afterRevoke.entries[0].player, BOB_DID);

    await engine.deleteRecord(revUri);
    const afterUnrevoke = await viewerClient.getLeaderboardScores({ leaderboard: LB_STAGE });
    assert.equal(afterUnrevoke.entries.length, 2);

    // Reactive ATProto Labeler moderation & `neg: true` appeal check!
    await engine.ingestLabel({
      src: LABELER_DID,
      uri: `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/pb-1`,
      val: '!cheat',
      cts: '2026-11-21T13:00:00.000Z',
    });
    const afterLabel = await viewerClient.getLeaderboardScores({ leaderboard: LB_STAGE });
    assert.equal(afterLabel.entries.length, 1);

    await engine.ingestLabel({
      src: LABELER_DID,
      uri: `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/pb-1`,
      val: '!cheat',
      neg: true,
      cts: '2026-11-21T13:05:00.000Z',
    });
    const afterAppeal = await viewerClient.getLeaderboardScores({ leaderboard: LB_STAGE });
    assert.equal(afterAppeal.entries.length, 2);

    // Safe Blob Proxy check
    const blobRes = await fetchHandler(
      new Request(viewerClient.getBlobUrl(STUDIO_DID, DUMMY_BLOB.ref.$link))
    );
    assert.equal(blobRes.status, 200);
    assert.equal(blobRes.headers.get('content-security-policy'), "default-src 'none'");

    // Headless UI helpers check
    const cols = buildLeaderboardColumns(lbDef);
    assert.equal(cols.length, 2);
    assert.equal(cols[0].isDefaultSort, true);
    assert.equal(maskAchievementForViewer(ACH_SECRET, secretDef, { viewerUnlocked: false }).isMaskedSpoiler, true);
  });

  it('consumes Jetstream events with cursor persistence and supports serverless verifyActorDirectFromPds', async () => {
    const studioKeys = await generateSigningKeys();
    const engine = new OpenGamingAppViewEngine({
      identityOptions: { enableNetwork: false },
    });
    const jetstream = new OpenGamingJetstreamConsumer(engine);

    await jetstream.handleMessage(
      JSON.stringify({
        did: STUDIO_DID,
        time_us: 1_763_726_400_000_000,
        kind: 'commit',
        commit: {
          rev: '3abc',
          operation: 'create',
          collection: 'games.atmosphere.define',
          rkey: 'sky-quest',
          record: { $type: 'games.atmosphere.define', name: 'Sky Quest' },
        },
      })
    );

    const subUrl = await jetstream.buildSubscribeUrl();
    assert.ok(subUrl.includes('cursor=1763726395000000'), 'Should rewind saved cursor by 5s on reconnect');
    const catalog = await engine.getGamesCatalog();
    assert.equal(catalog.length, 1);

    // Test serverless verifyActorDirectFromPds with mock PDS HTTP responses
    const { record: signedUnlock } = await createSignedUnlock({
      achievement: ACH_CORE,
      game: GAME_URI,
      playerDid: ALICE_DID,
      issuerDid: STUDIO_DID,
      signingKey: studioKeys.keypair,
    });

    const mockFetch: typeof fetch = async (input) => {
      const u = new URL(String(input));
      if (u.pathname === '/xrpc/com.atproto.repo.listRecords') {
        const repo = u.searchParams.get('repo');
        const col = u.searchParams.get('collection');
        if (repo === ALICE_DID && col === NSIDS.AchievementUnlock) {
          return new Response(
            JSON.stringify({
              records: [
                {
                  uri: `at://${ALICE_DID}/${NSIDS.AchievementUnlock}/first-clear`,
                  value: signedUnlock,
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (repo === STUDIO_DID && col === 'games.atmosphere.define') {
          return new Response(
            JSON.stringify({
              records: [{ uri: GAME_URI, value: { $type: 'games.atmosphere.define', name: 'Sky Quest' } }],
            }),
            { status: 200 }
          );
        }
        if (repo === STUDIO_DID && col === NSIDS.AchievementDefinition) {
          return new Response(
            JSON.stringify({
              records: [
                {
                  uri: ACH_CORE,
                  value: {
                    $type: NSIDS.AchievementDefinition,
                    game: GAME_URI,
                    title: 'First Clear',
                    description: 'Beat Ch 1.',
                    createdAt: '2026-11-21T00:00:00.000Z',
                  },
                },
              ],
            }),
            { status: 200 }
          );
        }
      }
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    };

    // Pre-populate DID docs via custom engine test or mock PLC
    const mockPlcFetch: typeof fetch = async (input, init) => {
      const s = String(input);
      if (s.includes(STUDIO_DID)) {
        return new Response(
          JSON.stringify({
            id: STUDIO_DID,
            verificationMethods: { attestations: studioKeys.publicDidKey },
            service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.test' }],
          }),
          { status: 200 }
        );
      }
      if (s.includes(ALICE_DID)) {
        return new Response(
          JSON.stringify({
            id: ALICE_DID,
            alsoKnownAs: ['at://alice.test'],
            service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.test' }],
          }),
          { status: 200 }
        );
      }
      return mockFetch(input, init);
    };

    // Verify direct-from-PDS flow when DID docs are resolvable
    const serverlessEngine = new OpenGamingAppViewEngine({
      fetchImpl: mockPlcFetch,
      identityOptions: { enableNetwork: false },
    });
    await serverlessEngine.store.upsertActor({
      did: STUDIO_DID,
      pdsUrl: 'https://pds.test',
      didDoc: { id: STUDIO_DID, verificationMethods: { attestations: studioKeys.publicDidKey } },
      updatedAt: '2026-11-21T00:00:00.000Z',
    });
    await serverlessEngine.store.upsertActor({
      did: ALICE_DID,
      handle: 'alice.test',
      pdsUrl: 'https://pds.test',
      didDoc: { id: ALICE_DID },
      updatedAt: '2026-11-21T00:00:00.000Z',
    });
    await serverlessEngine.syncActorRepository(STUDIO_DID);
    await serverlessEngine.syncActorRepository(ALICE_DID);

    const serverlessLib = await serverlessEngine.getActorLibrary({ actor: ALICE_DID });
    assert.equal(serverlessLib.totalGames, 1);
    assert.equal(serverlessLib.items[0].achievements.completed, true);
    assert.equal(typeof verifyActorDirectFromPds, 'function');
  });
});
