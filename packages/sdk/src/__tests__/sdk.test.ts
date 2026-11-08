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
  formatScore,
  generateSigningKeys,
  loadSigningKey,
  sortAchievementDefinitions,
  summarizeActorProfile,
  verifyRecordAttestation,
  type AchievementDefinitionRecord,
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
});
