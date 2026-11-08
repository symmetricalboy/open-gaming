# `@opengaming/sdk` & `opengaming` CLI Guide

The `@opengaming/sdk` package provides everything needed to integrate Open Gaming (`games.opengaming.*`) into a game backend, serverless P2P client, revival host, or AppView — including P-256 key generation, PLC `#attestations` setup, Mode A inline signing & verification (`rkey` binding, `trustedIssuers`, `replay` blobs), P2P multi-participant `match.result` co-signing, ATProto Labeler folding, `games.opengaming.revocation` management, local multi-component & sub-board `dimensions` leaderboard helpers, BCP-47 `resolveTranslation`, and XP-free Gamercard aggregation.

---

## 1. CLI Quickstart (`opengaming`)

### Generate Signing Keys & Register `#attestations` on PLC
```bash
# 1. Generate a P-256 keypair (saves opengaming.private.key + opengaming.public.txt)
npx opengaming keygen --out ./secrets

# 2. Request a PLC confirmation email token for your game's ATProto account
npx opengaming plc-request-token \
  --service https://bsky.social \
  --identifier mygame.bsky.social \
  --password "$ATP_PASSWORD"

# 3. Register your public did:key under #attestations in your DID document
npx opengaming plc-register-key \
  --service https://bsky.social \
  --identifier mygame.bsky.social \
  --password "$ATP_PASSWORD" \
  --public-key "$(cat ./secrets/opengaming.public.txt)" \
  --token "<TOKEN_FROM_EMAIL>"
```

### Validate All 11 Lexicons & Example Records
```bash
npx opengaming validate
```

### Sign & Verify Unlocks, Scores & Co-Signed P2P Matches
```bash
# Sign an achievement unlock (with co-op participants, runId & anti-evasion rkey)
npx opengaming sign-unlock \
  --achievement "at://did:plc:game/games.opengaming.achievement.definition/raid-boss" \
  --player "did:plc:alice" \
  --issuer "did:plc:game" \
  --participants '[{"did":"did:plc:alice","role":"tank"},{"did":"did:plc:bob","role":"healer"}]' \
  --run-id "raid-2026-001" \
  --note "Zero-wipe clear!" \
  --rkey "raid-boss" \
  --private-key "$OPENGAMING_PRIVATE_KEY" > unlock.json

# Sign a multi-component rhythm/stage score with sub-board dimensions, seed & version hash
npx opengaming sign-score \
  --leaderboard "at://did:plc:game/games.opengaming.leaderboard.definition/rhythm-stage-1" \
  --components '{"ex-score":{"$type":"games.opengaming.leaderboard.score#points","value":2840},"accuracy":{"$type":"games.opengaming.leaderboard.score#percentage","value":9942}}' \
  --dimensions '{"mode":"4k"}' \
  --seed "2026-11-08" \
  --version "md5:8a4f2c91e0b3d71244f9a10293847561" \
  --rkey "rhythm-pb-1" \
  --player "did:plc:alice" \
  --issuer "did:plc:game" \
  --private-key "$OPENGAMING_PRIVATE_KEY" > score.json

# Sign & co-sign a serverless P2P 1v1 PvP match result (Alice signs, then Bob co-signs!)
npx opengaming sign-match \
  --game "at://did:plc:game/games.atmosphere.define/sky-duel" \
  --match-id "duel-99" \
  --mode "1v1-ranked" \
  --participants '[{"did":"did:plc:alice","outcome":"win","score":3},{"did":"did:plc:bob","outcome":"loss","score":1}]' \
  --repo "did:plc:alice" \
  --issuer "did:plc:alice" \
  --rkey "duel-99" \
  --private-key "$ALICE_PRIVATE_KEY" > match.alice.json

npx opengaming cosign-match \
  --file match.alice.json \
  --repo "did:plc:alice" \
  --signer "did:plc:bob" \
  --rkey "duel-99" \
  --private-key "$BOB_PRIVATE_KEY" > match.cosigned.json
```

---

## 2. TypeScript SDK Usage (`@opengaming/sdk`)

```ts
import {
  NSIDS,
  loadSigningKey,
  createSignedUnlock,
  createSignedScore,
  createSignedMatchResult,
  coSignMatchResult,
  verifyRecordAttestation,
  verifyMatchResult,
  evaluateScoreSubmission,
  getUnlockRecordPlan,
  resolveTranslation,
  resolveActiveLabels,
} from '@opengaming/sdk';

const signingKey = await loadSigningKey(process.env.OPENGAMING_PRIVATE_KEY!);

// 1. Sign a multi-component score with sub-board dimensions & co-op runId
const { record: signedScore } = await createSignedScore({
  leaderboard: 'at://did:plc:game/games.opengaming.leaderboard.definition/stage-1',
  playerDid: 'did:plc:player123',
  issuerDid: 'did:plc:game',
  rkey: 'stage-1-pb-2',
  components: {
    'ex-score': { $type: 'games.opengaming.leaderboard.score#points', value: 2840 },
    accuracy: { $type: 'games.opengaming.leaderboard.score#percentage', value: 9942 },
    'clear-time': { $type: 'games.opengaming.leaderboard.score#time', value: 124150 },
  },
  dimensions: { mode: '4k' },
  seed: '2026-11-08',
  version: 'md5:8a4f2c91e0b3d71244f9a10293847561',
  signingKey,
});

// 2. Evaluate personalBests / overwriteBest / perWindowBest / everyRun write policy
const plan = evaluateScoreSubmission({
  candidateScore: 2840,
  definition: leaderboardDef,
  existingScores: playerExistingVerifiedScores,
  candidateDimensions: { mode: '4k' },
});
if (plan.shouldWrite) {
  console.log(plan.writeMode, plan.recommendedRkey); // 'create' | 'put'
}
```
