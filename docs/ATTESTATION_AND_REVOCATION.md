# Inline Cryptographic Attestations, P2P Co-Signing, Labelers, Revocations & EoS Continuity

Open Gaming combines four complementary trust & longevity mechanisms:
1. **Mode A Inline DID-Key Signatures** (`games.opengaming.defs#inlineSignature`) for zero-Game-PDS-write real-time verification.
2. **Serverless Peer-to-Peer Multi-Participant Co-Signing** on `games.opengaming.match.result` when all `participants` sign with their own `#attestations` keys.
3. **Co-Equal Moderation**: **ATProto Labelers** (`com.atproto.label.defs#label`) alongside **Publisher Revocation Records** (`games.opengaming.revocation`).
4. **End-of-Service (EoS) Continuity**: Optional signatures, `trustedIssuers` federation, deterministic `replay` blobs, and community `verified-replay` labels so leaderboards survive server shutdowns.

---

## 1. How Inline Attestation Works (`games.opengaming.defs#inlineSignature`)

Every `achievement.unlock`, `achievement.progress`, `leaderboard.score`, and `match.result` record lives in a **player's own AT Protocol repository**, signed inline via `#attestations`:

1. **Key Setup (One-Time per Issuer or P2P Player DID)**
   - Generate a P-256 ECDSA keypair (`opengaming keygen`).
   - Store `privateKeyBase64url` safely (`OPENGAMING_PRIVATE_KEY`).
   - Publish `publicDidKey` (`did:key:z...`) under `#attestations` in the DID Document (`verificationMethods.attestations` on `did:plc`, or `verificationMethod` in `/.well-known/did.json` for `did:web`).
2. **Computing the Repository-Bound (and Optional `rkey`-Bound) Attestation CID**
   - Start with the unsigned record JSON and remove any `signatures` array (normalizing any `BlobRef` CID links deterministically).
   - Build transient `$sig` metadata (`$type`, `key`, `issuer`, `issuedAt`, **`"repository": "<target-repo-did>"`**, plus optional **`"rkey": "<target-rkey>"`**).
   - Encode `{ ...recordWithoutSigs, $sig }` to deterministic **DAG-CBOR**, compute its SHA-256 hash, and wrap as **CIDv1 (`bafy...`)**.
3. **Signing & Writing**
   - Sign `cid.bytes` with the signer's private key (`low-S` normalized ECDSA).
   - Attach `{ $type: "games.opengaming.defs#inlineSignature", key, issuer, issuedAt, rkey, cid, signature: { $bytes } }` inside `signatures[]`.
   - Write the signed record to the **player's PDS** (`com.atproto.repo.putRecord` / `createRecord`) with **zero writes to the Game's PDS**.

### Serverless P2P Co-Signing (`games.opengaming.match.result`)
For serverless 1v1 or multiplayer matches (`verifyMatchResult`), if no publisher/host signature is present, verifiers check whether **every** DID-bearing entry in `participants[]` (>= 2 distinct DIDs) has attached a valid inline signature bound to `repositoryDid` (and `rkey` if present). Each co-signer produces their own per-signer `$sig` CID over the identical match payload, and revoking **any** co-signer's `attestationCid` revokes the match.

---

## 2. Co-Equal Moderation: ATProto Labelers + Publisher Revocations

Open Gaming treats **ATProto Labelers** (`com.atproto.label.defs#label`) and **Publisher Revocations** (`games.opengaming.revocation`) as co-equal, complementary layers:

### A. ATProto Anti-Cheat & Replay Labelers (`com.atproto.label.defs#label`)
- **Invalidating Labels** (`!cheat`, `cheating`, `exploit`, `invalid-replay`, `revoked`) targeting a record AT-URI (optionally pinned to `cid`) or a player `did` automatically exclude cheated runs across subscribed AppViews (`error: "label_invalidated"`).
- **Appeals via `neg: true`**: Publishing a negation label (`neg: true`) immediately reinstates the record (`resolveActiveLabels` folds chronological label streams and `exp` expirations).
- **Community Replay Verification Labels** (`verified-replay`, `community-verified`): Allow community verifier bots/labelers to validate unsigned direct-to-PDS runs or matches with attached `replay` blobs!

### B. Standard Publisher Revocation Records (`games.opengaming.revocation`)
Published directly in the **game publisher's (or authorized `trustedIssuers` host's) PDS** — requiring zero dedicated Labeler infrastructure for indie/jam games:
- **`scope: "attestation"`** (`rkey = <attestationCid>`): Surgically invalidates a specific signed payload across any `rkey` with O(1) `getRecord` lookup.
- **`scope: "leaderboard" | "achievement" | "match" | "challenge" | "game"`**: Invalidates all matching records for `player` on `subject`, with optional `before` ISO timestamp cutoffs. *(Note: When a chart or level is patched for everyone without player wrongdoing, prefer updating `leaderboard.definition#rankedVersions` so historical pre-patch scores stay valid in players' PDSs!)*
- Deleting the revocation record (`opengaming unrevoke`) reinstates validity.

---

## 3. End-of-Service (EoS) Fault Tolerance & Revival Continuity

1. **Optional `signatures`**: Player records remain schema-valid without server signatures so open-source or offline clients can write directly to the player's PDS via ATProto OAuth.
2. **Multi-Issuer Federation (`trustedIssuers` & AppView Trust Lists)**: Multiple federated hosts can sign scores for the same game (`issuer` records which host attested each run).
3. **Self-Verifying `replay` Blobs**: Attaching deterministic input logs (`replay` blob on `leaderboard.score` or `match.result`) lets third-party verifiers and community labelers re-simulate runs and attach `verified-replay` labels with zero publisher server involvement.
