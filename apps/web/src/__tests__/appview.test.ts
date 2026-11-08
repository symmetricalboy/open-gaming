import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import {
  NSIDS,
  createOpenGamingLexicons,
  createRevocationRecord,
  createSignedScore,
  generateSigningKeys,
} from '@opengaming/sdk';
import { createAppViewServer, type AppViewInstance } from '../server.js';

describe('opengaming.games AppView, XRPC, Jetstream & Revocation Integration', () => {
  let app: AppViewInstance;
  let baseUrl = '';

  before(async () => {
    app = await createAppViewServer({
      dbPath: ':memory:',
      enableJetstream: false,
      enableNetworkIdentity: false,
      seedDemoData: true,
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

  it('serves healthcheck, overview stats, static SPA routes, and SVG icons', async () => {
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as { status: string };
    assert.equal(health.status, 'ok');

    const overviewRes = await fetch(`${baseUrl}/api/overview`);
    assert.equal(overviewRes.status, 200);
    const overview = (await overviewRes.json()) as Record<string, any>;
    assert.equal(overview.stats.gamesCount, 2);
    assert.ok(overview.stats.verifiedUnlocksCount >= 10);
    assert.equal(overview.stats.blockedAttemptsCount, 2); // 1 revoked exploit + 1 unsigned forgery

    // Deep-linked SPA route fallback
    const spaRes = await fetch(`${baseUrl}/leaderboards`);
    assert.equal(spaRes.status, 200);
    assert.match(spaRes.headers.get('content-type') ?? '', /text\/html/);

    const iconRes = await fetch(`${baseUrl}/assets/icons/game-flappysky.svg`);
    assert.equal(iconRes.status, 200);
    assert.match(iconRes.headers.get('content-type') ?? '', /image\/svg\+xml/);
  });

  it('implements XRPC games.opengaming.actor.getProfile (XP-free, per-game completion)', async () => {
    const lex = createOpenGamingLexicons();
    const res = await fetch(`${baseUrl}/xrpc/games.opengaming.actor.getProfile?actor=symmetricalboy.com`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;

    // Validate XRPC output against compiled Lexicon schema!
    lex.assertValidXrpcOutput(NSIDS.ActorGetProfile, body);

    assert.equal(body.did, 'did:plc:33d7gnwiagm6cimpiepefp72');
    assert.equal(body.gamesPlayed, 2);
    assert.equal(body.completedGames, 1); // Neon Drift 2/2 (100%), Flappysky 3/5 (60%)
    assert.equal('totalXp' in body, false);
    assert.equal('level' in body, false);
  });

  it('implements XRPC games.opengaming.leaderboard.getScores across timeframes, social scope, and speedrun clocks', async () => {
    const lex = createOpenGamingLexicons();
    const flappyLb = 'at://did:plc:flappyskygameexample/games.opengaming.leaderboard.definition/high-score';

    // 1. All-Time Global: Trezy's 148 pts (5 days ago) is #1; FrameGlitcher's revoked 9420 pts is excluded!
    const allTimeRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(flappyLb)}&timeframe=allTime&scope=public`
    );
    assert.equal(allTimeRes.status, 200);
    const allTime = (await allTimeRes.json()) as Record<string, any>;
    lex.assertValidXrpcOutput(NSIDS.LeaderboardGetScores, allTime);
    assert.equal(allTime.entries[0].handle, 'trezy.codes');
    assert.equal(allTime.entries[0].score, 148);
    assert.equal(
      allTime.entries.some((e: any) => e.score === 9420),
      false,
      'Revoked 9420 exploit score must not appear in verified leaderboard'
    );

    // 2. Daily Global: Dylan's 94 pts today outranks Boba (86) and Trezy's today run (79)!
    const dailyRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(flappyLb)}&timeframe=daily&scope=public`
    );
    const daily = (await dailyRes.json()) as Record<string, any>;
    assert.equal(daily.entries[0].handle, 'symmetricalboy.com');
    assert.equal(daily.entries[0].score, 94);

    // 3. Social Scope (`viewer=trezy.codes`): includes Trezy, Dylan, Boba; excludes Bailey!
    const socialRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(flappyLb)}&timeframe=allTime&scope=social&viewer=trezy.codes`
    );
    const social = (await socialRes.json()) as Record<string, any>;
    assert.equal(social.entries.length, 3);
    assert.equal(
      social.entries.some((e: any) => e.handle === 'pds.dad'),
      false
    );
    assert.equal(social.viewerEntry?.handle, 'trezy.codes');

    // 4. smallerIsBetter millisecond time leaderboard (`Neon Bay Time Trial`)
    const driftLb = 'at://did:plc:neondriftgameexample/games.opengaming.leaderboard.definition/neon-bay-time-trial';
    const driftRes = await fetch(
      `${baseUrl}/xrpc/games.opengaming.leaderboard.getScores?leaderboard=${encodeURIComponent(driftLb)}&timeframe=allTime`
    );
    const drift = (await driftRes.json()) as Record<string, any>;
    assert.equal(drift.entries[0].score, 52480);
    assert.equal(drift.entries[0].displayScore, '0:52.48');
    assert.equal(drift.entries[1].score, 56910);
  });

  it('masks hidden achievements for non-unlockers while revealing them to players who unlocked them', async () => {
    const flappyUri = 'at://did:plc:flappyskygameexample/games.atmosphere.define/flappysky';

    // Boba has NOT unlocked `touch-grass` -> masked!
    const maskedRes = await fetch(
      `${baseUrl}/api/game?uri=${encodeURIComponent(flappyUri)}&viewer=essentialrandom.bsky.social`
    );
    const maskedGame = (await maskedRes.json()) as Record<string, any>;
    const hiddenForBoba = maskedGame.achievements.find((a: any) => a.rkey === 'touch-grass');
    assert.equal(hiddenForBoba.masked, true);
    assert.equal(hiddenForBoba.title, 'Hidden Achievement');

    // Dylan HAS unlocked `touch-grass` -> revealed!
    const revealedRes = await fetch(
      `${baseUrl}/api/game?uri=${encodeURIComponent(flappyUri)}&viewer=symmetricalboy.com`
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

    // 1. Ingest game & leaderboard definitions via Jetstream commit stream
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

    // 2. Player submits inline-signed score over Jetstream -> appears as #1!
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

    // 3. Publisher publishes `games.opengaming.revocation` over Jetstream -> score vanishes immediately!
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

    // 4. Publisher deletes revocation (`unrevoke`) over Jetstream -> score is reinstated immediately!
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
});
