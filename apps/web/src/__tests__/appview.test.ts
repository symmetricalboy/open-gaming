import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import {
  NSIDS,
  createOpenGamingLexicons,
  createRevocationRecord,
  createSignedScore,
  createSignedUnlock,
  generateSigningKeys,
  getBestOnlyScoreRkey,
  getUnlockRkey,
} from '@opengaming/sdk';
import { createAppViewServer, type AppViewInstance } from '../server.js';

describe('opengaming.games AppView (Zero Dummy Data, XRPC, Jetstream & Revocation)', () => {
  let app: AppViewInstance;
  let baseUrl = '';

  const FLAPPY_DID = 'did:web:flappysky.symmetricalboy.com';
  const DYLAN_DID = 'did:plc:33d7gnwiagm6cimpiepefp72';
  const TREZY_DID = 'did:plc:4jrld6fwpnwqehtce56qshzv';
  const BOBA_DID = 'did:plc:r2vpg2iszskbkegoldmqa322';
  const BAILEY_DID = 'did:plc:rnpkyqnmsw4ipey6eotbdnnf';

  before(async () => {
    app = await createAppViewServer({
      dbPath: ':memory:',
      enableJetstream: false,
      enableNetworkIdentity: false,
      bootstrapRepos: [],
    });

    await new Promise<void>((resolve) => {
      app.server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await app.close();
  });

  it('starts completely clean with zero dummy data and serves SPA routes & healthcheck', async () => {
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as { status: string };
    assert.equal(health.status, 'ok');

    const overviewRes = await fetch(`${baseUrl}/api/overview`);
    assert.equal(overviewRes.status, 200);
    const overview = (await overviewRes.json()) as Record<string, any>;
    assert.equal(overview.stats.gamesCount, 0);
    assert.equal(overview.stats.achievementDefinitionsCount, 0);
    assert.equal(overview.stats.verifiedUnlocksCount, 0);
    assert.equal(overview.stats.verifiedScoresCount, 0);
    assert.equal(overview.stats.blockedAttemptsCount, 0);
    assert.equal(overview.games.length, 0);

    // Deep-linked SPA route fallback
    const spaRes = await fetch(`${baseUrl}/leaderboards`);
    assert.equal(spaRes.status, 200);
    assert.match(spaRes.headers.get('content-type') ?? '', /text\/html/);

    const iconRes = await fetch(`${baseUrl}/assets/icons/game-flappysky.svg`);
    assert.equal(iconRes.status, 200);
    assert.match(iconRes.headers.get('content-type') ?? '', /image\/svg\+xml/);
  });

  it('indexes real signed records and serves XP-free actor.getProfile, leaderboard.getScores, and hidden-achievement masking', async () => {
    const lex = createOpenGamingLexicons();
    const flappyKeys = await generateSigningKeys();

    app.identity.upsertActor({
      did: FLAPPY_DID,
      handle: 'flappysky.symmetricalboy.com',
      displayName: 'Flappysky',
      didDoc: {
        id: FLAPPY_DID,
        alsoKnownAs: ['at://flappysky.symmetricalboy.com'],
        verificationMethods: { attestations: flappyKeys.publicDidKey },
      },
    });
    app.identity.upsertActor({ did: DYLAN_DID, handle: 'symmetricalboy.com', displayName: 'symmetricalboy' });
    app.identity.upsertActor({ did: TREZY_DID, handle: 'trezy.codes', displayName: 'Trezy' });
    app.identity.upsertActor({ did: BOBA_DID, handle: 'essentialrandom.bsky.social', displayName: 'Ms Boba' });
    app.identity.upsertActor({ did: BAILEY_DID, handle: 'pds.dad', displayName: 'Bailey Townsend' });

    // Social graph for Trezy: follows Dylan & Boba, not Bailey
    const insertFollow = app.db.prepare('INSERT OR IGNORE INTO follows (follower_did, subject_did) VALUES (?, ?)');
    insertFollow.run(TREZY_DID, DYLAN_DID);
    insertFollow.run(TREZY_DID, BOBA_DID);

    const gameUri = `at://${FLAPPY_DID}/games.atmosphere.define/flappysky`;
    const achFirstFlightUri = `at://${FLAPPY_DID}/${NSIDS.AchievementDefinition}/first-flight`;
    const achTouchGrassUri = `at://${FLAPPY_DID}/${NSIDS.AchievementDefinition}/touch-grass`;
    const lbUri = `at://${FLAPPY_DID}/${NSIDS.LeaderboardDefinition}/high-score`;

    const blobStub = {
      $type: 'blob',
      ref: { $link: 'bafkreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori' },
      mimeType: 'image/png',
      size: 1024,
    };

    await app.indexer.indexRecord({
      uri: gameUri,
      record: {
        $type: 'games.atmosphere.define',
        name: 'Flappysky',
        url: 'https://flappysky.symmetricalboy.com',
        createdAt: new Date().toISOString(),
      },
    });

    await app.indexer.indexRecord({
      uri: achFirstFlightUri,
      record: {
        $type: NSIDS.AchievementDefinition,
        game: gameUri,
        title: 'First Flight',
        description: 'Completed your very first flight through the Blue Sky.',
        icon: blobStub,
        tier: 'bronze',
        hidden: false,
        listOrder: 10,
        createdAt: new Date().toISOString(),
      },
    });

    await app.indexer.indexRecord({
      uri: achTouchGrassUri,
      record: {
        $type: NSIDS.AchievementDefinition,
        game: gameUri,
        title: 'Touch Grass',
        description: 'Bonked straight into the ground without clearing a single post.',
        icon: blobStub,
        tier: 'bronze',
        hidden: true,
        listOrder: 20,
        createdAt: new Date().toISOString(),
      },
    });

    await app.indexer.indexRecord({
      uri: lbUri,
      record: {
        $type: NSIDS.LeaderboardDefinition,
        game: gameUri,
        name: 'All-Time Best Score',
        icon: blobStub,
        sortOrder: 'largerIsBetter',
        scoreFormat: { kind: 'numeric', decimalPlaces: 0, unitSingular: 'pt', unitPlural: 'pts' },
        timeframes: ['allTime'],
        recordPolicy: 'bestOnly',
        createdAt: new Date().toISOString(),
      },
    });

    // Dylan unlocks both achievements (100% completion of 2/2)
    for (const achUri of [achFirstFlightUri, achTouchGrassUri]) {
      const { record } = await createSignedUnlock({
        achievement: achUri,
        game: gameUri,
        playerDid: DYLAN_DID,
        issuerDid: FLAPPY_DID,
        signingKey: flappyKeys.keypair,
      });
      await app.indexer.indexRecord({
        uri: `at://${DYLAN_DID}/${NSIDS.AchievementUnlock}/${getUnlockRkey(achUri)}`,
        record,
      });
    }

    // Scores for Trezy (148), Dylan (84), Boba (62), Bailey (95)
    const scoreInputs = [
      { did: TREZY_DID, score: 148 },
      { did: BAILEY_DID, score: 95 },
      { did: DYLAN_DID, score: 84 },
      { did: BOBA_DID, score: 62 },
    ];
    for (const s of scoreInputs) {
      const { record } = await createSignedScore({
        leaderboard: lbUri,
        game: gameUri,
        playerDid: s.did,
        issuerDid: FLAPPY_DID,
        score: s.score,
        signingKey: flappyKeys.keypair,
      });
      await app.indexer.indexRecord({
        uri: `at://${s.did}/${NSIDS.LeaderboardScore}/${getBestOnlyScoreRkey(lbUri)}`,
        record,
      });
    }

    // 1. Validate XRPC actor.getProfile (XP-free)
    const profileRes = await fetch(`${baseUrl}/xrpc/games.opengaming.actor.getProfile?actor=symmetricalboy.com`);
    assert.equal(profileRes.status, 200);
    const profile = (await profileRes.json()) as Record<string, any>;
    lex.assertValidXrpcOutput(NSIDS.ActorGetProfile, profile);
    assert.equal(profile.did, DYLAN_DID);
    assert.equal(profile.gamesPlayed, 1);
    assert.equal(profile.completedGames, 1);
    assert.equal('totalXp' in profile, false);
    assert.equal('level' in profile, false);

    // 2. Validate XRPC leaderboard.getScores (Global & Social)
    const allTimeRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(lbUri)}&timeframe=allTime&scope=public`
    );
    const allTime = (await allTimeRes.json()) as Record<string, any>;
    lex.assertValidXrpcOutput(NSIDS.LeaderboardGetScores, allTime);
    assert.equal(allTime.entries.length, 4);
    assert.equal(allTime.entries[0].handle, 'trezy.codes');
    assert.equal(allTime.entries[0].score, 148);

    const socialRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(lbUri)}&timeframe=allTime&scope=social&viewer=trezy.codes`
    );
    const social = (await socialRes.json()) as Record<string, any>;
    assert.equal(social.entries.length, 3);
    assert.equal(
      social.entries.some((e: any) => e.handle === 'pds.dad'),
      false
    );

    // 3. Validate hidden achievement masking (`touch-grass` masked for Boba, revealed for Dylan)
    const maskedRes = await fetch(
      `${baseUrl}/api/game?uri=${encodeURIComponent(gameUri)}&viewer=essentialrandom.bsky.social`
    );
    const maskedGame = (await maskedRes.json()) as Record<string, any>;
    const hiddenForBoba = maskedGame.achievements.find((a: any) => a.rkey === 'touch-grass');
    assert.equal(hiddenForBoba.masked, true);
    assert.equal(hiddenForBoba.title, 'Hidden Achievement');

    const revealedRes = await fetch(
      `${baseUrl}/api/game?uri=${encodeURIComponent(gameUri)}&viewer=symmetricalboy.com`
    );
    const revealedGame = (await revealedRes.json()) as Record<string, any>;
    const revealedForDylan = revealedGame.achievements.find((a: any) => a.rkey === 'touch-grass');
    assert.equal(revealedForDylan.masked, false);
    assert.equal(revealedForDylan.title, 'Touch Grass');
  });

  it('ingests live Jetstream commits, reactively revokes scores on games.opengaming.revocation, and reinstates on delete', async () => {
    const studioDid = 'did:plc:livejetstreamstudio01';
    const playerDid = 'did:plc:livejetstreamplayer01';
    const studioKeys = await generateSigningKeys();

    app.identity.upsertActor({
      did: studioDid,
      handle: 'studio.opengaming.games',
      didDoc: {
        id: studioDid,
        verificationMethods: { attestations: studioKeys.publicDidKey },
      },
    });

    const gameUri = `at://${studioDid}/games.atmosphere.define/starhopper`;
    const lbUri = `at://${studioDid}/${NSIDS.LeaderboardDefinition}/arcade`;

    await app.jetstream.handleMessage(
      JSON.stringify({
        did: studioDid,
        time_us: 1_700_000_000_001_000,
        kind: 'commit',
        commit: {
          rev: 'rev1',
          operation: 'create',
          collection: 'games.atmosphere.define',
          rkey: 'starhopper',
          record: {
            $type: 'games.atmosphere.define',
            name: 'Starhopper',
            createdAt: new Date().toISOString(),
          },
        },
      })
    );

    await app.jetstream.handleMessage(
      JSON.stringify({
        did: studioDid,
        time_us: 1_700_000_000_002_000,
        kind: 'commit',
        commit: {
          rev: 'rev2',
          operation: 'create',
          collection: NSIDS.LeaderboardDefinition,
          rkey: 'arcade',
          record: {
            $type: NSIDS.LeaderboardDefinition,
            game: gameUri,
            name: 'Arcade High Score',
            icon: {
              $type: 'blob',
              ref: { $link: 'bafkreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori' },
              mimeType: 'image/png',
              size: 1024,
            },
            sortOrder: 'largerIsBetter',
            scoreFormat: { kind: 'numeric', decimalPlaces: 0, unitPlural: 'pts' },
            timeframes: ['allTime'],
            recordPolicy: 'bestOnly',
            createdAt: new Date().toISOString(),
          },
        },
      })
    );

    const { record: signedScore, attestationCid } = await createSignedScore({
      leaderboard: lbUri,
      game: gameUri,
      playerDid,
      issuerDid: studioDid,
      score: 777,
      signingKey: studioKeys.keypair,
    });

    await app.jetstream.handleMessage(
      JSON.stringify({
        did: playerDid,
        time_us: 1_700_000_000_003_000,
        kind: 'commit',
        commit: {
          rev: 'rev3',
          operation: 'create',
          collection: NSIDS.LeaderboardScore,
          rkey: 'pb-1',
          record: signedScore,
        },
      })
    );

    const beforeRevRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(lbUri)}`
    );
    const beforeRev = (await beforeRevRes.json()) as Record<string, any>;
    assert.equal(beforeRev.entries.length, 1);
    assert.equal(beforeRev.entries[0].score, 777);

    const { rkey: revRkey, record: revRec } = createRevocationRecord({
      scope: 'attestation',
      attestationCid,
      player: playerDid,
      subject: lbUri,
      reason: 'cheating',
    });

    await app.jetstream.handleMessage(
      JSON.stringify({
        did: studioDid,
        time_us: 1_700_000_000_004_000,
        kind: 'commit',
        commit: {
          rev: 'rev4',
          operation: 'create',
          collection: NSIDS.Revocation,
          rkey: revRkey,
          record: revRec,
        },
      })
    );

    const afterRevRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(lbUri)}`
    );
    const afterRev = (await afterRevRes.json()) as Record<string, any>;
    assert.equal(afterRev.entries.length, 0);

    await app.jetstream.handleMessage(
      JSON.stringify({
        did: studioDid,
        time_us: 1_700_000_000_005_000,
        kind: 'commit',
        commit: {
          rev: 'rev5',
          operation: 'delete',
          collection: NSIDS.Revocation,
          rkey: revRkey,
        },
      })
    );

    const reinstatedRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(lbUri)}`
    );
    const reinstated = (await reinstatedRes.json()) as Record<string, any>;
    assert.equal(reinstated.entries.length, 1);
    assert.equal(reinstated.entries[0].score, 777);
  });

  it('supports redacted hiddenSpace stubs, multi-component sortBy & rankedVersions, trustedIssuers, and ATProto Labeler moderation', async () => {
    const lex = createOpenGamingLexicons();
    const rhythmStudioDid = 'did:plc:tsunagiterhythm00001';
    const revivalHostDid = 'did:web:revival.tsunagite.dev';
    const labelerDid = 'did:plc:communitylabeler0001';
    const playerADid = 'did:plc:rhythmplayera0000001';
    const playerBDid = 'did:plc:rhythmplayerb0000002';
    const playerEosDid = 'did:plc:rhythmeosplayer00003';

    const studioKeys = await generateSigningKeys();
    const revivalKeys = await generateSigningKeys();

    app.identity.upsertActor({
      did: rhythmStudioDid,
      handle: 'tsunagite.dev',
      didDoc: {
        id: rhythmStudioDid,
        verificationMethods: { attestations: studioKeys.publicDidKey },
      },
    });
    app.identity.upsertActor({
      did: revivalHostDid,
      handle: 'revival.tsunagite.dev',
      didDoc: {
        id: revivalHostDid,
        verificationMethods: { attestations: revivalKeys.publicDidKey },
      },
    });
    app.identity.upsertActor({ did: playerADid, handle: 'alice.rhythm.test', pdsUrl: 'https://pds.rhythm.test' });
    app.identity.upsertActor({ did: playerBDid, handle: 'bob.rhythm.test', pdsUrl: 'https://pds.rhythm.test' });
    app.identity.upsertActor({ did: playerEosDid, handle: 'eos.rhythm.test', pdsUrl: 'https://pds.rhythm.test' });

    const gameUri = `at://${rhythmStudioDid}/games.atmosphere.define/tsunagite`;
    const secretStubUri = `at://${rhythmStudioDid}/${NSIDS.AchievementDefinition}/true-encore`;
    const chartLbUri = `at://${rhythmStudioDid}/${NSIDS.LeaderboardDefinition}/aurora-expert`;
    const blobStub = {
      $type: 'blob' as const,
      ref: { $link: 'bafkreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori' },
      mimeType: 'image/png',
      size: 1024,
    };
    const replayStub = {
      $type: 'blob' as const,
      ref: { $link: 'bafkreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori' },
      mimeType: 'application/octet-stream',
      size: 2048,
    };

    await app.indexer.indexRecord({
      uri: gameUri,
      record: {
        $type: 'games.atmosphere.define',
        name: 'Tsunagite Reference',
        createdAt: '2026-11-08T00:00:00.000Z',
      },
    });

    // 1. Redacted `hidden: true` stub (zero title/description/icon spoilers on public PDS)
    const stubIdx = await app.indexer.indexRecord({
      uri: secretStubUri,
      record: {
        $type: NSIDS.AchievementDefinition,
        game: gameUri,
        hidden: true,
        hiddenSpace: `at://${rhythmStudioDid}/app.bsky.space/true-encore-reveal`,
        tier: 'platinum',
        listOrder: 1,
        createdAt: '2026-11-08T00:00:00.000Z',
      },
    });
    assert.equal(stubIdx.indexed, true);

    const gameDetailRes = await fetch(`${baseUrl}/api/game?uri=${encodeURIComponent(gameUri)}`);
    const gameDetail = (await gameDetailRes.json()) as Record<string, any>;
    assert.equal(gameDetail.achievements.length, 1);
    assert.equal(gameDetail.achievements[0].isRedactedStub, true);
    assert.equal(gameDetail.achievements[0].hiddenSpace, `at://${rhythmStudioDid}/app.bsky.space/true-encore-reveal`);
    assert.equal(gameDetail.achievements[0].title, 'Hidden Achievement');

    // 2. Multi-component leaderboard map + componentOrder with rankedVersions + trustedIssuers
    await app.indexer.indexRecord({
      uri: chartLbUri,
      record: {
        $type: NSIDS.LeaderboardDefinition,
        game: gameUri,
        name: 'Aurora [EXPERT]',
        icon: blobStub,
        components: {
          accuracy: {
            $type: 'games.opengaming.defs#percentageComponentDef',
            name: 'Accuracy',
            sortOrder: 'largerIsBetter',
            precision: 2,
            minimum: 0,
            maximum: 10000,
          },
          'ex-score': {
            $type: 'games.opengaming.defs#pointsComponentDef',
            name: 'EX Score',
            sortOrder: 'largerIsBetter',
            minimum: 0,
            maximum: 5000,
            unitPlural: 'EX',
          },
          'clear-time': {
            $type: 'games.opengaming.defs#timeComponentDef',
            name: 'Clear Time',
            sortOrder: 'smallerIsBetter',
            timeUnit: 'milliseconds',
          },
        },
        componentOrder: ['ex-score', 'accuracy', 'clear-time'],
        defaultComponent: 'ex-score',
        rankedVersions: ['md5:chart-v2-legal'],
        trustedIssuers: [revivalHostDid],
        timeframes: ['allTime'],
        recordPolicy: 'everyRun',
        createdAt: '2026-11-08T00:00:00.000Z',
      },
    });

    // Player A: higher EX score (3200 EX), slower clear time (95,000 ms), signed by Studio
    const { record: scoreA } = await createSignedScore({
      leaderboard: chartLbUri,
      game: gameUri,
      playerDid: playerADid,
      issuerDid: rhythmStudioDid,
      rkey: 'run-a1',
      components: {
        'ex-score': { $type: 'games.opengaming.defs#pointsComponentVal', value: 3200 },
        accuracy: { $type: 'games.opengaming.defs#percentageComponentVal', value: 9910 },
        'clear-time': { $type: 'games.opengaming.defs#timeComponentVal', value: 95000 },
      },
      version: 'md5:chart-v2-legal',
      replay: replayStub,
      signingKey: studioKeys.keypair,
    });
    const scoreAUri = `at://${playerADid}/${NSIDS.LeaderboardScore}/run-a1`;
    await app.indexer.indexRecord({ uri: scoreAUri, record: scoreA });

    // Player B: lower EX score (2950 EX), FASTER clear time (82,000 ms), signed by federated Revival Host (`trustedIssuers`)!
    const { record: scoreB } = await createSignedScore({
      leaderboard: chartLbUri,
      game: gameUri,
      playerDid: playerBDid,
      issuerDid: revivalHostDid,
      rkey: 'run-b1',
      components: {
        'ex-score': { $type: 'games.opengaming.defs#pointsComponentVal', value: 2950 },
        accuracy: { $type: 'games.opengaming.defs#percentageComponentVal', value: 9750 },
        'clear-time': { $type: 'games.opengaming.defs#timeComponentVal', value: 82000 },
      },
      version: 'md5:chart-v2-legal',
      signingKey: revivalKeys.keypair,
    });
    const scoreBUri = `at://${playerBDid}/${NSIDS.LeaderboardScore}/run-b1`;
    await app.indexer.indexRecord({ uri: scoreBUri, record: scoreB });

    // Player A also has an older pre-rechart score (`md5:chart-v1-old`, 4900 EX) — verified, kept in PDS, filtered from active rankedVersions!
    const { record: oldChartScore } = await createSignedScore({
      leaderboard: chartLbUri,
      game: gameUri,
      playerDid: playerADid,
      issuerDid: rhythmStudioDid,
      rkey: 'run-a-old',
      components: {
        'ex-score': { $type: 'games.opengaming.defs#pointsComponentVal', value: 4900 },
        accuracy: { $type: 'games.opengaming.defs#percentageComponentVal', value: 9999 },
        'clear-time': { $type: 'games.opengaming.defs#timeComponentVal', value: 70000 },
      },
      version: 'md5:chart-v1-old',
      signingKey: studioKeys.keypair,
    });
    await app.indexer.indexRecord({
      uri: `at://${playerADid}/${NSIDS.LeaderboardScore}/run-a-old`,
      record: oldChartScore,
    });

    // Default sort (`ex-score`, largerIsBetter, legal `rankedVersions` only): Player A (3200) > Player B (2950)
    const defaultSortRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(chartLbUri)}`
    );
    assert.equal(defaultSortRes.status, 200);
    const defaultSort = (await defaultSortRes.json()) as Record<string, any>;
    lex.assertValidXrpcOutput(NSIDS.LeaderboardGetScores, defaultSort);
    assert.equal(defaultSort.sortedBy, 'ex-score');
    assert.equal(defaultSort.entries.length, 2);
    assert.equal(defaultSort.entries[0].player, playerADid);
    assert.equal(defaultSort.entries[0].score, 3200);
    assert.equal(defaultSort.entries[0].components['ex-score'].value, 3200);
    assert.equal(defaultSort.entries[0].hasReplay, true);
    assert.equal(defaultSort.entries[1].player, playerBDid);
    assert.equal(defaultSort.entries[1].issuer, revivalHostDid);

    // Rich UI endpoint preserves `componentOrder` (`['ex-score', 'accuracy', 'clear-time']`) regardless of map insertion order
    const richBoardRes = await fetch(`${baseUrl}/api/leaderboard?leaderboard=${encodeURIComponent(chartLbUri)}`);
    const richBoard = (await richBoardRes.json()) as Record<string, any>;
    assert.deepEqual(richBoard.definition.componentOrder, ['ex-score', 'accuracy', 'clear-time']);
    assert.deepEqual(
      richBoard.entries[0].formattedComponents.map((c: any) => c.id),
      ['ex-score', 'accuracy', 'clear-time']
    );

    // Sort by `clear-time` (`smallerIsBetter`): Player B (82,000 ms) > Player A (95,000 ms)!
    const timeSortRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(chartLbUri)}&sortBy=clear-time`
    );
    const timeSort = (await timeSortRes.json()) as Record<string, any>;
    lex.assertValidXrpcOutput(NSIDS.LeaderboardGetScores, timeSort);
    assert.equal(timeSort.sortedBy, 'clear-time');
    assert.equal(timeSort.entries[0].player, playerBDid);
    assert.equal(timeSort.entries[0].displayScore, '1:22.00');

    // Explicit `?version=md5:chart-v1-old` queries historical chart archive cleanly
    const archiveRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(chartLbUri)}&version=md5:chart-v1-old`
    );
    const archive = (await archiveRes.json()) as Record<string, any>;
    assert.equal(archive.entries.length, 1);
    assert.equal(archive.entries[0].score, 4900);

    // 3. Reactive ATProto Labeler moderation: `!cheat` invalidates Player A's run, `neg: true` reinstates it
    await app.indexer.ingestLabel({
      src: labelerDid,
      uri: scoreAUri,
      val: '!cheat',
      cts: '2026-11-08T05:00:00.000Z',
    });

    const afterCheatLabelRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(chartLbUri)}`
    );
    const afterCheatLabel = (await afterCheatLabelRes.json()) as Record<string, any>;
    assert.equal(afterCheatLabel.entries.length, 1);
    assert.equal(afterCheatLabel.entries[0].player, playerBDid);

    const proofFlaggedRes = await fetch(`${baseUrl}/api/proof?uri=${encodeURIComponent(scoreAUri)}`);
    const proofFlagged = (await proofFlaggedRes.json()) as Record<string, any>;
    assert.equal(proofFlagged.labelInvalidated, true);
    assert.equal(proofFlagged.activeLabels.length, 1);

    // Negate the `!cheat` label after appeal
    await app.indexer.ingestLabel({
      src: labelerDid,
      uri: scoreAUri,
      val: '!cheat',
      neg: true,
      cts: '2026-11-08T06:00:00.000Z',
    });

    const afterAppealRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(chartLbUri)}`
    );
    const afterAppeal = (await afterAppealRes.json()) as Record<string, any>;
    assert.equal(afterAppeal.entries.length, 2);

    // 4. Post-EoS unsigned direct-to-PDS replay run promoted via community `verified-replay` label
    const eosScoreUri = `at://${playerEosDid}/${NSIDS.LeaderboardScore}/eos-replay-1`;
    await app.indexer.indexRecord({
      uri: eosScoreUri,
      record: {
        $type: NSIDS.LeaderboardScore,
        leaderboard: chartLbUri,
        game: gameUri,
        components: {
          'ex-score': { $type: 'games.opengaming.defs#pointsComponentVal', value: 3450 },
          accuracy: { $type: 'games.opengaming.defs#percentageComponentVal', value: 9985 },
          'clear-time': { $type: 'games.opengaming.defs#timeComponentVal', value: 88000 },
        },
        version: 'md5:chart-v2-legal',
        replay: replayStub,
        recordedAt: '2026-11-08T07:00:00.000Z',
      },
    });

    await app.indexer.ingestLabel({
      src: labelerDid,
      uri: eosScoreUri,
      val: 'verified-replay',
      cts: '2026-11-08T07:05:00.000Z',
    });

    const withEosRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(chartLbUri)}`
    );
    const withEos = (await withEosRes.json()) as Record<string, any>;
    lex.assertValidXrpcOutput(NSIDS.LeaderboardGetScores, withEos);
    assert.equal(withEos.entries.length, 3);
    assert.equal(withEos.entries[0].player, playerEosDid);
    assert.equal(withEos.entries[0].score, 3450);
    assert.deepEqual(withEos.entries[0].labels, ['verified-replay']);
  });
});
