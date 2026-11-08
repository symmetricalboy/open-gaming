# `@opengaming/sdk` & `opengaming` CLI Guide

The `@opengaming/sdk` package provides everything needed to integrate Open Gaming (`games.opengaming.*`) into a game backend, client, revival host, or AppView — including P-256 key generation, PLC `#attestations` setup, Mode A inline signing & verification (`rkey` binding, `trustedIssuers`, `replay` blobs), ATProto Labeler folding, `games.opengaming.revocation` management, multi-component leaderboard formatting/ranking, and XP-free Gamercard aggregation.

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

### Validate Lexicons & Example Records
```bash
npx opengaming validate
```

### Sign & Verify Records (Classic & Multi-Component)
```bash
# Sign an achievement unlock (with optional --rkey anti-evasion binding)
npx opengaming sign-unlock \
  --achievement "at://did:plc:game/games.opengaming.achievement.definition/first-flight" \
  --player "did:plc:player" \
  --issuer "did:plc:game" \
  --rkey "first-flight-unlock" \
  --private-key "$OPENGAMING_PRIVATE_KEY" > unlock.json

# Sign a multi-component rhythm/stage score map with a legal chart version hash
npx opengaming sign-score \
  --leaderboard "at://did:plc:game/games.opengaming.leaderboard.definition/rhythm-stage-1" \
  --components '{"ex-score":{"$type":"games.opengaming.defs#pointsComponentVal","value":2840},"accuracy":{"$type":"games.opengaming.defs#percentageComponentVal","value":9942}}' \
  --version "md5:8a4f2c91e0b3d71244f9a10293847561" \
  --rkey "rhythm-pb-1" \
  --player "did:plc:player" \
  --issuer "did:plc:game" \
  --private-key "$OPENGAMING_PRIVATE_KEY" > score.json

# Verify a signed (or community-labeled) record with trusted federated issuers & ATProto labels
npx opengaming verify \
  --file score.json \
  --player "did:plc:player" \
  --record-uri "at://did:plc:player/games.opengaming.leaderboard.score/rhythm-pb-1" \
  --issuer "did:plc:game" \
  --trusted-issuers "did:web:revival.community.games" \
  --allow-community-labels \
  --labels ./labels.json
```

### Revoke or Reinstate Cheated / Exploited Records
```bash
# Surgical revocation of a single signed attestation CID (publishes to Game PDS with --publish)
npx opengaming revoke \
  --scope attestation \
  --cid "bafyreibym4dl6h3luuk5mdlkhznlrzqqc57vdcqwfbe4swkddtmfgxwb34" \
  --player "did:plc:cheater" \
  --subject "at://did:plc:game/games.opengaming.leaderboard.definition/high-score" \
  --reason exploit \
  --note "Submitted via v1.0 pause-frame glitch" \
  --publish \
  --identifier mygame.bsky.social \
  --password "$ATP_PASSWORD"

# Reinstate (un-revoke) by deleting the revocation record from the Game PDS
npx opengaming unrevoke \
  --rkey "bafyreibym4dl6h3luuk5mdlkhznlrzqqc57vdcqwfbe4swkddtmfgxwb34" \
  --identifier mygame.bsky.social \
  --password "$ATP_PASSWORD"
```

---

## 2. TypeScript SDK Usage (`@opengaming/sdk`)

```ts
import {
  NSIDS,
  loadSigningKey,
  createSignedUnlock,
  createSignedScore,
  verifyRecordAttestation,
  resolveActiveLabels,
  getScoreSortMetric,
  evaluateScoreSubmission,
  getUnlockRkey,
} from '@opengaming/sdk';

const signingKey = await loadSigningKey(process.env.OPENGAMING_PRIVATE_KEY!);

// 1. Sign a multi-component score bound to player DID + target rkey
const targetRkey = 'stage-1-pb';
const { record: signedScore, attestationCid } = await createSignedScore({
  leaderboard: 'at://did:plc:game/games.opengaming.leaderboard.definition/stage-1',
  playerDid: 'did:plc:player123',
  issuerDid: 'did:plc:game',
  rkey: targetRkey,
  components: {
    'ex-score': { $type: 'games.opengaming.defs#pointsComponentVal', value: 2840 },
    accuracy: { $type: 'games.opengaming.defs#percentageComponentVal', value: 9942 },
    'clear-time': { $type: 'games.opengaming.defs#timeComponentVal', value: 124150 },
  },
  details: {
    $type: 'games.opengaming.defs#judgmentBreakdown',
    judgments: {
      perfect: { total: 1400 },
      great: { total: 40, early: 15, late: 25 },
    },
    judgmentOrder: ['perfect', 'great'],
    maxCombo: 1440,
  },
  version: 'md5:8a4f2c91e0b3d71244f9a10293847561',
  signingKey,
});

// 2. Verify with multi-issuer federation, publisher revocations, and ATProto Labeler events
const verification = await verifyRecordAttestation({
  record: signedScore,
  recordUri: `at://did:plc:player123/${NSIDS.LeaderboardScore}/${targetRkey}`,
  playerDid: 'did:plc:player123',
  trustedIssuerDids: ['did:web:revival.community.games'],
  allowCommunityLabelVerification: true,
  revocations: indexedPublisherRevocations,
  activeLabels: resolveActiveLabels(labelEvents),
});

if (verification.verified) {
  console.log('Verified CID:', verification.attestationCid, 'Issuer:', verification.issuerDid);
}
```
