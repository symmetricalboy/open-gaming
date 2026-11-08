import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jsonToLex } from '@atproto/lexicon';
import {
  NSIDS,
  calculateGameCompletion,
  createOpenGamingLexicons,
  createRevocationRecord,
  createSignedProgress,
  createSignedScore,
  createSignedUnlock,
  evaluateScoreSubmission,
  formatComponentValue,
  formatScore,
  generateSigningKeys,
  getOrderedComponentIds,
  getOrderedJudgmentIds,
  getScoreSortMetric,
  loadSigningKey,
  resolveActiveLabels,
  sortAchievementDefinitions,
  summarizeActorProfile,
  validateComponentDefs,
  validateScoreComponents,
  verifyRecordAttestation,
  type AchievementDefinitionRecord,
  type AtprotoLabel,
  type LeaderboardDefinitionRecord,
} from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../../');

const GAME_DID = 'did:plc:flappyskygameexample';
const RIVAL_GAME_DID = 'did:plc:rivalstudio000000000';
const ALICE_DID = 'did:plc:aliceplayer000000001';
const MALLORY_DID = 'did:plc:malloryplayer0000002';

const GAME_URI = `at://${GAME_DID}/games.atmosphere.define/flappysky`;
const ACH_FIRST_FLIGHT = `at://${GAME_DID}/${NSIDS.AchievementDefinition}/first-flight`;
const LB_HIGH_SCORE = `at://${GAME_DID}/${NSIDS.LeaderboardDefinition}/high-score`;

const DUMMY_ICON = {
  $type: 'blob' as const,
  ref: { $link: 'bafkreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori' },
  mimeType: 'image/png',
  size: 10240,
};

describe('Open Gaming Lexicon Validation', () => {
  it('compiles all games.opengaming.* schemas and validates Flappysky example records', () => {
    const lex = createOpenGamingLexicons();
    const examplesPath = path.join(REPO_ROOT, 'examples/flappysky.examples.json');
    const examples = JSON.parse(fs.readFileSync(examplesPath, 'utf8')) as Record<string, any>;

    let validatedCount = 0;
    for (const [key, entry] of Object.entries(examples)) {
      if (key.startsWith('$')) continue;
      const list = Array.isArray(entry) ? entry : [entry];
      for (const item of list) {
        const value = item.value ?? item;
        if (value?.$type?.startsWith('games.opengaming.')) {
          lex.assertValidRecord(value.$type, jsonToLex(value));
          validatedCount += 1;
        }
      }
    }
    assert.ok(validatedCount >= 7, `Expected at least 7 Open Gaming example records, validated ${validatedCount}`);
  });
});

describe('Mode A Inline Attestation & Security Defenses', () => {
  it('generates keys, round-trips key import, and verifies signed unlocks, progress, and scores via DID doc', async () => {
    const generated = await generateSigningKeys();
    const reloadedKey = await loadSigningKey(generated.privateKeyBase64url);

    const mockDidDoc = {
      id: GAME_DID,
      verificationMethods: {
        attestations: generated.publicDidKey,
      },
    };

    const { record: unlock, attestationCid: unlockCid } = await createSignedUnlock({
      achievement: ACH_FIRST_FLIGHT,
      game: GAME_URI,
      playerDid: ALICE_DID,
      issuerDid: GAME_DID,
      signingKey: reloadedKey,
    });

    // Ensure generated record passes strict @atproto/lexicon schema check
    const lex = createOpenGamingLexicons();
    lex.assertValidRecord(NSIDS.AchievementUnlock, jsonToLex(unlock));

    const verifiedUnlock = await verifyRecordAttestation({
      record: unlock,
      playerDid: ALICE_DID,
      resolveDidDoc: async (did) => (did === GAME_DID ? mockDidDoc : null),
    });
    assert.equal(verifiedUnlock.verified, true);
    if (verifiedUnlock.verified) {
      assert.equal(verifiedUnlock.issuerDid, GAME_DID);
      assert.equal(verifiedUnlock.attestationCid, unlockCid);
    }

    const { record: progress } = await createSignedProgress({
      achievement: ACH_FIRST_FLIGHT,
      currentSteps: 42,
      stepsNeeded: 100,
      playerDid: ALICE_DID,
      issuerDid: GAME_DID,
      signingKey: reloadedKey,
    });
    lex.assertValidRecord(NSIDS.AchievementProgress, jsonToLex(progress));
    const verifiedProg = await verifyRecordAttestation({
      record: progress,
      playerDid: ALICE_DID,
      resolveDidDoc: async () => mockDidDoc,
    });
    assert.equal(verifiedProg.verified, true);

    const { record: score } = await createSignedScore({
      leaderboard: LB_HIGH_SCORE,
      score: 128,
      displayScore: '128 pts',
      tag: 'posts:100,likes:28',
      playerDid: ALICE_DID,
      issuerDid: GAME_DID,
      signingKey: reloadedKey,
    });
    lex.assertValidRecord(NSIDS.LeaderboardScore, jsonToLex(score));
    const verifiedScore = await verifyRecordAttestation({
      record: score,
      playerDid: ALICE_DID,
      resolveDidDoc: async () => mockDidDoc,
    });
    assert.equal(verifiedScore.verified, true);
  });

  it('rejects score tampering, cross-repo replay attacks, and cross-publisher spoofing', async () => {
    const gameKeys = await generateSigningKeys();
    const rivalKeys = await generateSigningKeys();

    const { record: validScore } = await createSignedScore({
      leaderboard: LB_HIGH_SCORE,
      score: 50,
      playerDid: ALICE_DID,
      issuerDid: GAME_DID,
      signingKey: gameKeys.keypair,
    });

    // 1. Tamper with score after signing
    const tampered = { ...validScore, score: 9999 };
    const tamperRes = await verifyRecordAttestation({
      record: tampered,
      playerDid: ALICE_DID,
      publicDidKey: gameKeys.publicDidKey,
    });
    assert.equal(tamperRes.verified, false);

    // 2. Cross-repo replay: Mallory copies Alice's signed record (even stripping `player` or keeping it)
    const replayRes = await verifyRecordAttestation({
      record: validScore,
      playerDid: MALLORY_DID,
      publicDidKey: gameKeys.publicDidKey,
    });
    assert.equal(replayRes.verified, false);

    const { player: _p, ...withoutPlayerField } = validScore;
    const replayWithoutPlayerRes = await verifyRecordAttestation({
      record: withoutPlayerField,
      playerDid: MALLORY_DID,
      publicDidKey: gameKeys.publicDidKey,
    });
    assert.equal(replayWithoutPlayerRes.verified, false);

    // 3. Cross-publisher spoofing: Rival Game signs a score for Flappysky's leaderboard
    const { record: spoofed } = await createSignedScore({
      leaderboard: LB_HIGH_SCORE,
      score: 5000,
      playerDid: MALLORY_DID,
      issuerDid: RIVAL_GAME_DID,
      signingKey: rivalKeys.keypair,
    });
    const spoofRes = await verifyRecordAttestation({
      record: spoofed,
      playerDid: MALLORY_DID,
      publicDidKey: rivalKeys.publicDidKey,
    });
    assert.equal(spoofRes.verified, false);
    if (!spoofRes.verified) {
      assert.equal(spoofRes.error, 'issuer_mismatch');
    }
  });
});

describe('games.opengaming.revocation Schema & Enforcement', () => {
  it('revokes a specific attestationCid even if the player copies the signed record to a new rkey', async () => {
    const gameKeys = await generateSigningKeys();
    const lex = createOpenGamingLexicons();

    const { record: exploitedScore, attestationCid } = await createSignedScore({
      leaderboard: LB_HIGH_SCORE,
      score: 9999,
      playerDid: MALLORY_DID,
      issuerDid: GAME_DID,
      signingKey: gameKeys.keypair,
    });

    const { rkey, record: revocation } = createRevocationRecord({
      scope: 'attestation',
      attestationCid,
      player: MALLORY_DID,
      subject: LB_HIGH_SCORE,
      recordUri: `at://${MALLORY_DID}/${NSIDS.LeaderboardScore}/original-rkey`,
      reason: 'exploit',
      note: 'Pause-frame glitch exploit.',
    });

    assert.equal(rkey, attestationCid);
    lex.assertValidRecord(NSIDS.Revocation, jsonToLex(revocation));

    // Mallory moves her signed record to a brand new rkey `sneaky-new-rkey`!
    const verifyMoved = await verifyRecordAttestation({
      record: exploitedScore,
      recordUri: `at://${MALLORY_DID}/${NSIDS.LeaderboardScore}/sneaky-new-rkey`,
      playerDid: MALLORY_DID,
      publicDidKey: gameKeys.publicDidKey,
      revocations: [{ publisherDid: GAME_DID, value: revocation }],
    });

    assert.equal(verifyMoved.verified, false);
    if (!verifyMoved.verified) {
      assert.equal(verifyMoved.error, 'revoked');
      assert.equal(verifyMoved.revocation?.reason, 'exploit');
    }

    // Reinstatement (empty revocations list after deleteRecord) makes it valid again
    const verifyReinstated = await verifyRecordAttestation({
      record: exploitedScore,
      playerDid: MALLORY_DID,
      publicDidKey: gameKeys.publicDidKey,
      revocations: [],
    });
    assert.equal(verifyReinstated.verified, true);
  });

  it('supports scoped leaderboard revocations with a `before` patch cutoff and blocks cross-game revocations', async () => {
    const gameKeys = await generateSigningKeys();

    const { record: prePatchScore } = await createSignedScore({
      leaderboard: LB_HIGH_SCORE,
      score: 800,
      playerDid: MALLORY_DID,
      issuerDid: GAME_DID,
      recordedAt: '2026-11-07T18:00:00.000Z',
      signingKey: gameKeys.keypair,
    });

    const { record: postPatchScore } = await createSignedScore({
      leaderboard: LB_HIGH_SCORE,
      score: 45,
      playerDid: MALLORY_DID,
      issuerDid: GAME_DID,
      recordedAt: '2026-11-08T12:00:00.000Z',
      signingKey: gameKeys.keypair,
    });

    const { record: cutoffRevocation } = createRevocationRecord({
      scope: 'leaderboard',
      player: MALLORY_DID,
      subject: LB_HIGH_SCORE,
      before: '2026-11-08T00:00:00.000Z',
      reason: 'bug',
    });

    // Foreign revocation from RIVAL_GAME_DID must be ignored
    const ignoredForeign = await verifyRecordAttestation({
      record: prePatchScore,
      playerDid: MALLORY_DID,
      publicDidKey: gameKeys.publicDidKey,
      revocations: [{ publisherDid: RIVAL_GAME_DID, value: cutoffRevocation }],
    });
    assert.equal(ignoredForeign.verified, true);

    // Authentic publisher revocation catches pre-patch score, allows post-patch score!
    const preRes = await verifyRecordAttestation({
      record: prePatchScore,
      playerDid: MALLORY_DID,
      publicDidKey: gameKeys.publicDidKey,
      revocations: [{ publisherDid: GAME_DID, value: cutoffRevocation }],
    });
    assert.equal(preRes.verified, false);

    const postRes = await verifyRecordAttestation({
      record: postPatchScore,
      playerDid: MALLORY_DID,
      publicDidKey: gameKeys.publicDidKey,
      revocations: [{ publisherDid: GAME_DID, value: cutoffRevocation }],
    });
    assert.equal(postRes.verified, true);
  });
});

describe('Per-Game Achievement Appreciation (No XP & Uncapped Definitions)', () => {
  it('validates XP-free definitions, supports uncapped >250 achievements per game, and computes per-game completion', () => {
    const lex = createOpenGamingLexicons();

    const flappyDefs = [
      {
        uri: `at://${GAME_DID}/${NSIDS.AchievementDefinition}/touch-grass`,
        record: {
          $type: NSIDS.AchievementDefinition,
          game: GAME_URI,
          title: 'Touch Grass',
          description: 'Bonked immediately.',
          icon: DUMMY_ICON,
          tier: 'bronze',
          hidden: true,
          listOrder: 90,
          createdAt: '2026-11-07T00:00:00.000Z',
        } satisfies AchievementDefinitionRecord,
      },
      {
        uri: ACH_FIRST_FLIGHT,
        record: {
          $type: NSIDS.AchievementDefinition,
          game: GAME_URI,
          title: 'First Flight',
          description: 'Cleared 1 post.',
          icon: DUMMY_ICON,
          tier: 'platinum',
          listOrder: 10,
          createdAt: '2026-11-07T00:00:00.000Z',
        } satisfies AchievementDefinitionRecord,
      },
    ];

    for (const def of flappyDefs) {
      lex.assertValidRecord(NSIDS.AchievementDefinition, jsonToLex(def.record));
    }

    const sorted = sortAchievementDefinitions(flappyDefs);
    assert.equal(sorted[0].uri, ACH_FIRST_FLIGHT);

    // Sprawling RPG defines 320 achievements (exceeding the old 250 cap — all 320 are honored!)
    const bigGameUri = 'at://did:plc:bigstudio/games.atmosphere.define/odyssey';
    const bigGameDefs = Array.from({ length: 320 }, (_, i) => ({
      uri: `at://did:plc:bigstudio/${NSIDS.AchievementDefinition}/quest-${String(i + 1).padStart(3, '0')}`,
      record: {
        $type: NSIDS.AchievementDefinition,
        game: bigGameUri,
        title: `Quest ${i + 1}`,
        description: `Completed quest ${i + 1}.`,
        icon: DUMMY_ICON,
        tier: i === 319 ? 'gold' : 'bronze',
        createdAt: '2026-11-07T00:00:00.000Z',
      } satisfies AchievementDefinitionRecord,
    }));

    // Unlock 100% of Flappysky (2/2) and 319/320 of Odyssey (should floor to 99%, NOT prematurely round to 100%!)
    const verifiedUnlocks = [
      ...flappyDefs.map((d) => ({
        $type: NSIDS.AchievementUnlock,
        achievement: d.uri,
        player: ALICE_DID,
        unlockedAt: '2026-11-07T22:00:00.000Z',
      })),
      ...bigGameDefs.slice(0, 319).map((d) => ({
        $type: NSIDS.AchievementUnlock,
        achievement: d.uri,
        player: ALICE_DID,
        unlockedAt: '2026-11-07T21:00:00.000Z',
      })),
    ];

    const odysseyCompletion = calculateGameCompletion({
      game: bigGameUri,
      verifiedUnlocks,
      definitions: bigGameDefs,
    });
    assert.equal(odysseyCompletion.totalAchievements, 320);
    assert.equal(odysseyCompletion.unlockedCount, 319);
    assert.equal(odysseyCompletion.completionPercent, 99);
    assert.equal(odysseyCompletion.completed, false);

    const profile = summarizeActorProfile({
      playerDid: ALICE_DID,
      handle: 'alice.bsky.social',
      verifiedUnlocks,
      definitions: [...flappyDefs, ...bigGameDefs],
    });

    assert.equal(profile.gamesPlayed, 2);
    assert.equal(profile.completedGames, 1); // Flappysky is 100% completed!
    assert.equal(profile.totalUnlocks, 321);
    assert.equal(profile.tiers.platinum, 1);
    assert.equal(profile.tiers.bronze, 320);
    assert.equal(profile.games[0].game, GAME_URI); // Most recent unlock first
    assert.equal(profile.games[0].completed, true);
    assert.equal(profile.games[0].completionPercent, 100);
  });
});

describe('Leaderboard Score Formatting & Record Policies', () => {
  it('formats numeric, time, and currency integer scores accurately', () => {
    assert.equal(
      formatScore(1, { kind: 'numeric', decimalPlaces: 0, unitSingular: 'pt', unitPlural: 'pts' }),
      '1 pt'
    );
    assert.equal(
      formatScore(42, { kind: 'numeric', decimalPlaces: 0, unitSingular: 'pt', unitPlural: 'pts' }),
      '42 pts'
    );
    assert.equal(formatScore(314159, { kind: 'numeric', decimalPlaces: 2 }, 'en-US'), '3,141.59');
    assert.equal(formatScore(66032, { kind: 'time', timeUnit: 'milliseconds' }), '1:06.03');
    assert.equal(formatScore(19950000, { kind: 'currency', currencyCode: 'USD', decimalPlaces: 6 }, 'en-US'), '$19.95');
  });

  it('evaluates bestOnly vs perWindowBest across daily, weekly, and allTime timeframes', () => {
    const baseBoard: LeaderboardDefinitionRecord = {
      $type: NSIDS.LeaderboardDefinition,
      game: GAME_URI,
      name: 'High Scores',
      icon: DUMMY_ICON,
      sortOrder: 'largerIsBetter',
      scoreFormat: { kind: 'numeric', decimalPlaces: 0 },
      timeframes: ['daily', 'weekly', 'allTime'],
      recordPolicy: 'perWindowBest',
      scoreMin: 1,
      scoreMax: 1000,
      createdAt: '2026-11-01T00:00:00.000Z',
    };

    const existing = [
      {
        $type: NSIDS.LeaderboardScore,
        leaderboard: LB_HIGH_SCORE,
        score: 100, // Last month's All-Time PB
        recordedAt: '2026-10-15T12:00:00.000Z',
      },
    ];

    const today = new Date('2026-11-07T20:00:00.000Z');

    // Score 60 doesn't beat All-Time (100), EXCEPT under `perWindowBest` it's the player's first Daily & Weekly score!
    const perWindowDecision = evaluateScoreSubmission({
      leaderboardUri: LB_HIGH_SCORE,
      score: 60,
      definition: baseBoard,
      existingPlayerScores: existing,
      now: today,
    });
    assert.equal(perWindowDecision.shouldWrite, true);
    assert.deepEqual(perWindowDecision.beatenTimeframes, ['daily', 'weekly']);

    // Under `bestOnly`, score 60 is NOT written because All-Time is 100
    const bestOnlyDecision = evaluateScoreSubmission({
      leaderboardUri: LB_HIGH_SCORE,
      score: 60,
      definition: { ...baseBoard, timeframes: ['allTime'], recordPolicy: 'bestOnly' },
      existingPlayerScores: existing,
      now: today,
    });
    assert.equal(bestOnlyDecision.shouldWrite, false);

    // Out-of-bounds score 5000 (> scoreMax 1000) is rejected
    const outOfBounds = evaluateScoreSubmission({
      leaderboardUri: LB_HIGH_SCORE,
      score: 5000,
      definition: baseBoard,
      existingPlayerScores: existing,
      now: today,
    });
    assert.equal(outOfBounds.validBounds, false);
    assert.equal(outOfBounds.shouldWrite, false);
  });

  it('supports forward-compatible component maps + componentOrder, #judgmentBreakdown maps, rankedVersions, and replay blobs', async () => {
    const lex = createOpenGamingLexicons();
    const gameKeys = await generateSigningKeys();
    const rhythmLbUri = `at://${GAME_DID}/${NSIDS.LeaderboardDefinition}/rhythm-stage-1`;

    // Deliberately list map keys in DAG-CBOR byte-length order (`lamp`, `comment`, `accuracy`, `ex-score`, `clear-time`)
    // to prove `componentOrder` preserves author-intended column order after DAG-CBOR round-trips!
    const rhythmDef: LeaderboardDefinitionRecord = {
      $type: NSIDS.LeaderboardDefinition,
      game: GAME_URI,
      name: 'Skyline Pulse [HYPER]',
      icon: DUMMY_ICON,
      components: {
        lamp: {
          $type: 'games.opengaming.defs#enumComponentDef',
          name: 'Clear Lamp',
          sortOrder: 'smallerIsBetter',
          values: [
            { id: 'ap', name: 'All Perfect' },
            { id: 'fc', name: 'Full Combo' },
            { id: 'clear', name: 'Cleared' },
          ],
        },
        comment: {
          $type: 'games.opengaming.defs#textComponentDef',
          name: 'Run Note',
          maxGraphemes: 64,
        },
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
          maximum: 4000,
          unitSingular: 'EX',
          unitPlural: 'EX',
        },
        'clear-time': {
          $type: 'games.opengaming.defs#timeComponentDef',
          name: 'Clear Time',
          sortOrder: 'smallerIsBetter',
          timeUnit: 'milliseconds',
          minimum: 10000,
          maximum: 600000,
        },
      },
      componentOrder: ['ex-score', 'accuracy', 'clear-time', 'lamp', 'comment'],
      defaultComponent: 'ex-score',
      detailsSchema: 'games.opengaming.defs#judgmentBreakdown',
      rankedVersions: ['sha256:legal-chart-v2'],
      timeframes: ['allTime', 'weekly'],
      recordPolicy: 'perWindowBest',
      createdAt: '2026-11-08T00:00:00.000Z',
    };

    lex.assertValidRecord(NSIDS.LeaderboardDefinition, jsonToLex(rhythmDef));
    assert.equal(validateComponentDefs(rhythmDef.components, rhythmDef.componentOrder), null);
    assert.deepEqual(getOrderedComponentIds(rhythmDef), [
      'ex-score',
      'accuracy',
      'clear-time',
      'lamp',
      'comment',
    ]);

    const replayBlob = {
      $type: 'blob' as const,
      ref: { $link: 'bafkreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori' },
      mimeType: 'application/octet-stream',
      size: 4096,
    };

    const judgmentDetails = {
      $type: 'games.opengaming.defs#judgmentBreakdown' as const,
      judgments: {
        miss: { total: 0 },
        great: { total: 40, early: 15, late: 25 },
        perfect: { total: 1400 },
      },
      judgmentOrder: ['perfect', 'great', 'miss'],
      maxCombo: 1440,
      totalEarly: 15,
      totalLate: 25,
      mode: '4k',
      inputMethod: 'keyboard',
    };
    assert.deepEqual(getOrderedJudgmentIds(judgmentDetails), ['perfect', 'great', 'miss']);

    const { record: signedRhythmScore, attestationCid } = await createSignedScore({
      leaderboard: rhythmLbUri,
      game: GAME_URI,
      playerDid: ALICE_DID,
      issuerDid: GAME_DID,
      rkey: 'rhythm-pb-1',
      components: {
        'ex-score': { $type: 'games.opengaming.defs#pointsComponentVal', value: 2840 },
        accuracy: { $type: 'games.opengaming.defs#percentageComponentVal', value: 9942 },
        'clear-time': { $type: 'games.opengaming.defs#timeComponentVal', value: 124150 },
        lamp: { $type: 'games.opengaming.defs#enumComponentVal', value: 'fc' },
        comment: { $type: 'games.opengaming.defs#textComponentVal', value: 'Sightread FC!' },
      },
      details: judgmentDetails,
      version: 'sha256:legal-chart-v2',
      replay: replayBlob,
      signingKey: gameKeys.keypair,
    });

    const hydratedLex = jsonToLex(signedRhythmScore);
    lex.assertValidRecord(NSIDS.LeaderboardScore, hydratedLex);

    // Deterministic CID verification works identically on both raw JSON and jsonToLex-hydrated records (BlobRef CID normalization)
    const verifyRaw = await verifyRecordAttestation({
      record: signedRhythmScore,
      recordUri: `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/rhythm-pb-1`,
      playerDid: ALICE_DID,
      publicDidKey: gameKeys.publicDidKey,
    });
    assert.equal(verifyRaw.verified, true);

    const verifyHydrated = await verifyRecordAttestation({
      record: hydratedLex as Record<string, any>,
      recordUri: `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/rhythm-pb-1`,
      playerDid: ALICE_DID,
      publicDidKey: gameKeys.publicDidKey,
    });
    assert.equal(verifyHydrated.verified, true);
    if (verifyHydrated.verified) {
      assert.equal(verifyHydrated.attestationCid, attestationCid);
    }

    assert.equal(validateScoreComponents(signedRhythmScore.components, rhythmDef), null);

    // Reject reserved/invalid map keys and $type mismatches at application layer
    assert.notEqual(
      validateScoreComponents(
        { $keyFormat: { $type: 'games.opengaming.defs#pointsComponentVal', value: 1 } },
        rhythmDef
      ),
      null
    );
    assert.notEqual(
      validateScoreComponents(
        { 'ex-score': { $type: 'games.opengaming.defs#enumComponentVal', value: 'fc' } },
        rhythmDef
      ),
      null
    );

    assert.equal(
      formatComponentValue(
        signedRhythmScore.components!.accuracy,
        rhythmDef.components!.accuracy,
        'en-US'
      ),
      '99.42%'
    );

    const exMetric = getScoreSortMetric(signedRhythmScore, rhythmDef, 'ex-score', 'en-US');
    assert.equal(exMetric?.sortableValue, 2840);
    assert.equal(exMetric?.displayValue, '2,840 EX');
    assert.equal(exMetric?.sortOrder, 'largerIsBetter');

    const timeMetric = getScoreSortMetric(signedRhythmScore, rhythmDef, 'clear-time', 'en-US');
    assert.equal(timeMetric?.sortableValue, 124150);
    assert.equal(timeMetric?.displayValue, '2:04.15');
    assert.equal(timeMetric?.sortOrder, 'smallerIsBetter');

    const lampMetric = getScoreSortMetric(signedRhythmScore, rhythmDef, 'lamp', 'en-US');
    assert.equal(lampMetric?.sortableValue, 1);
    assert.equal(lampMetric?.displayValue, 'Full Combo');

    // Outdated chart hash rejected by evaluateScoreSubmission
    const outdatedDecision = evaluateScoreSubmission({
      leaderboardUri: rhythmLbUri,
      components: signedRhythmScore.components,
      version: 'sha256:old-chart-v1',
      definition: rhythmDef,
      existingPlayerScores: [],
    });
    assert.equal(outdatedDecision.validBounds, false);
    assert.equal(outdatedDecision.shouldWrite, false);

    // Legal chart hash accepted
    const legalDecision = evaluateScoreSubmission({
      leaderboardUri: rhythmLbUri,
      components: signedRhythmScore.components,
      version: 'sha256:legal-chart-v2',
      definition: rhythmDef,
      existingPlayerScores: [],
    });
    assert.equal(legalDecision.validBounds, true);
    assert.equal(legalDecision.shouldWrite, true);
  });
});

describe('Spoiler-Proof Hidden Stubs, EoS Federation, $sig.rkey Binding & ATProto Labels', () => {
  it('validates redacted hidden:true achievement stubs with hiddenSpace and definitionCid on progress', async () => {
    const lex = createOpenGamingLexicons();
    const gameKeys = await generateSigningKeys();

    const redactedStub: AchievementDefinitionRecord = {
      $type: NSIDS.AchievementDefinition,
      game: GAME_URI,
      hidden: true,
      hiddenSpace: 'at://did:plc:flappyskygameexample/app.bsky.space/true-ending-spoilers',
      tier: 'platinum',
      listOrder: 99,
      createdAt: '2026-11-08T00:00:00.000Z',
    };
    lex.assertValidRecord(NSIDS.AchievementDefinition, jsonToLex(redactedStub));

    const { record: progressWithDefCid } = await createSignedProgress({
      achievement: `at://${GAME_DID}/${NSIDS.AchievementDefinition}/secret-ending`,
      definitionCid: 'bafyreihbrikl5p3a3tmsgmt5ymprlxmbgo2vrw3xf3iokwoyhlfkj2jori',
      currentSteps: 3,
      stepsNeeded: 5,
      playerDid: ALICE_DID,
      issuerDid: GAME_DID,
      signingKey: gameKeys.keypair,
    });
    lex.assertValidRecord(NSIDS.AchievementProgress, jsonToLex(progressWithDefCid));
  });

  it('enforces $sig.rkey anti-evasion binding, multi-issuer EoS federation, and ATProto Labeler moderation', async () => {
    const revivalKeys = await generateSigningKeys();
    const REVIVAL_DID = 'did:web:revival.community.games';
    const LABELER_DID = 'did:plc:anticheatlabeler0001';

    const { record: revivalSigned } = await createSignedScore({
      leaderboard: LB_HIGH_SCORE,
      score: 320,
      playerDid: ALICE_DID,
      issuerDid: REVIVAL_DID,
      rkey: 'legit-rkey-1',
      signingKey: revivalKeys.keypair,
    });

    // Without trustedIssuerDids, revival server signature is rejected for GAME_DID's leaderboard
    const untrustedRes = await verifyRecordAttestation({
      record: revivalSigned,
      recordUri: `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/legit-rkey-1`,
      playerDid: ALICE_DID,
      publicDidKey: revivalKeys.publicDidKey,
    });
    assert.equal(untrustedRes.verified, false);
    if (!untrustedRes.verified) {
      assert.equal(untrustedRes.error, 'issuer_mismatch');
    }

    // With trustedIssuerDids, revival server signature verifies cleanly
    const trustedRes = await verifyRecordAttestation({
      record: revivalSigned,
      recordUri: `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/legit-rkey-1`,
      playerDid: ALICE_DID,
      trustedIssuerDids: [REVIVAL_DID],
      publicDidKey: revivalKeys.publicDidKey,
    });
    assert.equal(trustedRes.verified, true);

    // Moving an rkey-bound signed record to a new rkey to evade URI labels fails with rkey_mismatch!
    const movedRkeyRes = await verifyRecordAttestation({
      record: revivalSigned,
      recordUri: `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/evaded-rkey-2`,
      playerDid: ALICE_DID,
      trustedIssuerDids: [REVIVAL_DID],
      publicDidKey: revivalKeys.publicDidKey,
    });
    assert.equal(movedRkeyRes.verified, false);
    if (!movedRkeyRes.verified) {
      assert.equal(movedRkeyRes.error, 'rkey_mismatch');
    }

    // ATProto anti-cheat label (`!cheat`) invalidates record; `neg: true` appeal reinstates it
    const targetUri = `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/legit-rkey-1`;
    const cheatLabel: AtprotoLabel = {
      src: LABELER_DID,
      uri: targetUri,
      val: '!cheat',
      cts: '2026-11-08T01:00:00.000Z',
    };

    const labeledRes = await verifyRecordAttestation({
      record: revivalSigned,
      recordUri: targetUri,
      playerDid: ALICE_DID,
      trustedIssuerDids: [REVIVAL_DID],
      publicDidKey: revivalKeys.publicDidKey,
      activeLabels: resolveActiveLabels([cheatLabel]),
    });
    assert.equal(labeledRes.verified, false);
    if (!labeledRes.verified) {
      assert.equal(labeledRes.error, 'label_invalidated');
    }

    const negatedLabels = resolveActiveLabels([
      cheatLabel,
      {
        src: LABELER_DID,
        uri: targetUri,
        val: '!cheat',
        neg: true,
        cts: '2026-11-08T02:00:00.000Z',
      },
    ]);
    assert.equal(negatedLabels.length, 0);

    // Post-EoS unsigned direct-to-PDS replay run verified via community `verified-replay` label
    const unsignedEosRun = {
      $type: NSIDS.LeaderboardScore,
      leaderboard: LB_HIGH_SCORE,
      score: 410,
      recordedAt: '2026-11-08T03:00:00.000Z',
    };
    const eosUri = `at://${ALICE_DID}/${NSIDS.LeaderboardScore}/eos-run-1`;

    const unverifiedEos = await verifyRecordAttestation({
      record: unsignedEosRun,
      recordUri: eosUri,
      playerDid: ALICE_DID,
    });
    assert.equal(unverifiedEos.verified, false);

    const communityVerifiedEos = await verifyRecordAttestation({
      record: unsignedEosRun,
      recordUri: eosUri,
      playerDid: ALICE_DID,
      allowCommunityLabelVerification: true,
      activeLabels: [
        {
          src: LABELER_DID,
          uri: eosUri,
          val: 'verified-replay',
          cts: '2026-11-08T03:05:00.000Z',
        },
      ],
    });
    assert.equal(communityVerifiedEos.verified, true);
    if (communityVerifiedEos.verified) {
      assert.equal(communityVerifiedEos.issuerDid, LABELER_DID);
    }
  });
});
