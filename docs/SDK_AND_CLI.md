# `@opengaming/sdk` & `opengaming` CLI Guide

The `@opengaming/sdk` package provides everything needed to integrate Open Gaming (`games.opengaming.*`) into a game backend, client, or AppView — including P-256 key generation, PLC `#attestations` setup, Mode A inline signing & verification, `games.opengaming.revocation` management, per-game completion & profile aggregation, and leaderboard score windowing.

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

### Sign & Verify Records from the Command Line
```bash
# Sign an achievement unlock
npx opengaming sign-unlock \
  --achievement "at://did:plc:game/games.opengaming.achievement.definition/first-flight" \
  --player "did:plc:player" \
  --issuer "did:plc:game" \
  --private-key "$OPENGAMING_PRIVATE_KEY" > unlock.json

# Verify a signed unlock or score (optionally passing revocations)
npx opengaming verify \
  --file unlock.json \
  --player "did:plc:player" \
  --issuer "did:plc:game"
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

# Scoped pre-patch cutoff revocation (invalidates scores before patch, allows post-patch scores)
npx opengaming revoke \
  --scope leaderboard \
  --player "did:plc:cheater" \
  --subject "at://did:plc:game/games.opengaming.leaderboard.definition/high-score" \
  --before "2026-11-08T00:00:00.000Z" \
  --reason bug \
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
  createRevocationRecord,
  evaluateScoreSubmission,
  formatScore,
  calculateGameCompletion,
  summarizeActorProfile,
  getUnlockRkey,
} from '@opengaming/sdk';

// 1. Game server signs an achievement unlock for a player
const signingKey = await loadSigningKey(process.env.OPENGAMING_PRIVATE_KEY!);

const { record: signedUnlock, attestationCid } = await createSignedUnlock({
  achievement: 'at://did:plc:flappysky/games.opengaming.achievement.definition/first-flight',
  game: 'at://did:plc:flappysky/games.atmosphere.define/flappysky',
  playerDid: 'did:plc:player123',
  issuerDid: 'did:plc:flappysky',
  signingKey,
});

// 2. Player's authenticated client writes the signed receipt to their own PDS
await playerAgent.com.atproto.repo.putRecord({
  repo: 'did:plc:player123',
  collection: NSIDS.AchievementUnlock,
  rkey: getUnlockRkey(signedUnlock.achievement),
  record: signedUnlock,
});

// 3. Any AppView (like opengaming.games) verifies the signature & checks revocations
const verification = await verifyRecordAttestation({
  record: signedUnlock,
  playerDid: 'did:plc:player123',
  revocations: indexedPublisherRevocations,
});

if (verification.verified) {
  console.log('Verified unlock CID:', verification.attestationCid);
}

// 4. Revoke an exploited score or unlock on the Game's PDS
const { rkey, record: revocation } = createRevocationRecord({
  scope: 'attestation',
  attestationCid,
  player: 'did:plc:player123',
  subject: signedUnlock.achievement,
  reason: 'exploit',
  note: 'Invalidated exploit run',
});
```
