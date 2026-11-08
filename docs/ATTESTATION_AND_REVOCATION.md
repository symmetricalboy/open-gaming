# Inline Cryptographic Attestations, Labelers, Revocations & EoS Continuity

Open Gaming combines three complementary trust & longevity mechanisms:
1. **Mode A Inline DID-Key Signatures** (`games.opengaming.defs#inlineSignature`) for zero-Game-PDS-write real-time verification.
2. **Co-Equal Moderation**: **ATProto Labelers** (`com.atproto.label.defs#label`) alongside **Publisher Revocation Records** (`games.opengaming.revocation`).
3. **End-of-Service (EoS) Continuity**: Optional signatures, `trustedIssuers` federation, deterministic `replay` blobs, and community `verified-replay` labels so leaderboards survive server shutdowns.

---

## 1. How Inline Attestation Works (`games.opengaming.defs#inlineSignature`)

Every `achievement.unlock`, `achievement.progress`, and `leaderboard.score` record lives in the **player's own AT Protocol repository**, optionally signed inline by an authorized issuer's `#attestations` verification method:

1. **Key Setup (One-Time per Issuer DID)**
   - Generate a P-256 ECDSA keypair (`opengaming keygen`).
   - Store `privateKeyBase64url` safely on your game server (`OPENGAMING_PRIVATE_KEY`).
   - Publish `publicDidKey` (`did:key:z...`) under `#attestations` in the issuer's DID Document (`verificationMethods.attestations` on `did:plc`, or `verificationMethod` in `/.well-known/did.json` for `did:web`).
2. **Computing the Repository-Bound (and Optional `rkey`-Bound) Attestation CID**
   - Start with the unsigned player record JSON and remove any `signatures` array (normalizing any `BlobRef` CID links deterministically).
   - Build transient `$sig` metadata (`$type`, `key`, `issuer`, `issuedAt`, **`"repository": "<player-did>"`**, plus optional **`"rkey": "<target-rkey>"`**).
   - Encode `{ ...recordWithoutSigs, $sig }` to deterministic **DAG-CBOR**, compute its SHA-256 hash, and wrap as **CIDv1 (`bafy...`)**.
3. **Signing & Writing**
   - Sign `cid.bytes` with the issuer's private key (`low-S` normalized ECDSA).
   - Attach `{ $type: "games.opengaming.defs#inlineSignature", key, issuer, issuedAt, rkey, cid, signature: { $bytes } }` inside `signatures[]`.
   - Write the signed record to the **player's PDS** (`com.atproto.repo.putRecord` / `createRecord`) with **zero writes to the Game's PDS**.

### Built-In Security Guarantees
- **Tamper-Proof**: Modifying `score`, `components`, `version`, `replay`, `achievement`, or timestamps changes the DAG-CBOR hash and invalidates the ECDSA signature.
- **Cross-Repository Replay Protection**: Because `"repository": "<player-did>"` is injected into `$sig` during CID calculation, copying Alice's signed record into Mallory's PDS fails verification.
- **`$sig.rkey` Anti-Evasion Binding**: When `rkey` is included in the signature, a player cannot copy a signed record to a new `rkey` in their own repo to dodge `at-uri`-targeted ATProto moderation labels (`rkey_mismatch`).
- **Authorized Issuer Check**: Verifiers check that the signing DID matches either the owner of the referenced definition AT-URI or an entry in the definition's `trustedIssuers` array.

---

## 2. Co-Equal Moderation: ATProto Labelers + Publisher Revocations

Open Gaming treats **ATProto Labelers** (`com.atproto.label.defs#label`) and **Publisher Revocations** (`games.opengaming.revocation`) as co-equal, complementary layers:

### A. ATProto Anti-Cheat & Replay Labelers (`com.atproto.label.defs#label`)
- Game publishers and community moderation teams can run standard ATProto Labelers subscribing to reports from developers and players.
- **Invalidating Labels** (`!cheat`, `cheating`, `exploit`, `invalid-replay`, `revoked`) targeting a record AT-URI (optionally pinned to `cid`) or a player `did` automatically exclude cheated runs across subscribed AppViews (`error: "label_invalidated"`).
- **Appeals via `neg: true`**: Publishing a negation label (`neg: true`) immediately reinstates the record (`resolveActiveLabels` folds chronological label streams and `exp` expirations).
- **Community Replay Verification Labels** (`verified-replay`, `community-verified`): Allow community verifier bots/labelers to validate unsigned direct-to-PDS runs with attached `replay` blobs!

### B. Standard Publisher Revocation Records (`games.opengaming.revocation`)
Published directly in the **game publisher's (or authorized `trustedIssuers` host's) PDS** — requiring zero dedicated Labeler infrastructure for indie/jam games:
- **`scope: "attestation"`** (`rkey = <attestationCid>`): Surgically invalidates a specific signed payload across any `rkey` with O(1) `getRecord` lookup.
- **`scope: "leaderboard" | "achievement" | "game"`**: Invalidates all matching records for `player` on `subject`, with optional `before` ISO timestamp cutoffs. *(Note: When a chart or level is patched for everyone without player wrongdoing, prefer updating `leaderboard.definition#rankedVersions` so historical pre-patch scores stay valid in players' PDSs!)*
- Deleting the revocation record (`opengaming unrevoke`) reinstates validity.

---

## 3. End-of-Service (EoS) Fault Tolerance & Revival Continuity

To ensure scores and achievements outlive any single hosted server:
1. **Optional `signatures`**: Player records remain schema-valid without server signatures so open-source or offline clients can write directly to the player's PDS via ATProto OAuth.
2. **Multi-Issuer Federation (`trustedIssuers` & AppView Trust Lists)**: Multiple federated hosts can sign scores for the same game (`issuer` records which host attested each run). If an original studio shuts down without updating its PDS, community AppViews can trust a revival server's DID (`trustedIssuerDids` / `allowAnyValidIssuer`) on the original `leaderboard.definition` AT-URIs — preserving 100% of historical scores alongside new revival runs!
3. **Self-Verifying `replay` Blobs**: Attaching deterministic input logs (`replay` blob on `leaderboard.score`) lets third-party verifiers and community labelers re-simulate runs and attach `verified-replay` labels with zero publisher server involvement.
