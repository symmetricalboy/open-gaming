# Inline Cryptographic Attestations & Revocations

Open Gaming uses **Mode A Inline DID-Key Signatures** (`games.opengaming.defs#inlineSignature`) paired with a standardized **Publisher Revocation Lexicon** (`games.opengaming.revocation`).

This pairing delivers **infinite write scalability** (zero writes to the Game's PDS during normal gameplay) while preserving **surgical 1-record anti-cheat revocation** whenever an exploit or bug occurs.

---

## 1. How Inline Attestation Works (`games.opengaming.defs#inlineSignature`)

Every `achievement.unlock`, `achievement.progress`, and `leaderboard.score` record lives in the **player's own AT Protocol repository**, signed inline by the **game publisher's `#attestations` verification method** following the `badge.blue` CID-First Attestation Specification:

1. **Key Setup (One-Time per Game DID)**
   - Generate a P-256 ECDSA keypair (`opengaming keygen`).
   - Store `privateKeyBase64url` safely on your game server (`OPENGAMING_PRIVATE_KEY`).
   - Publish `publicDidKey` (`did:key:z...`) under `#attestations` in your game publisher's DID Document (`verificationMethods.attestations` on `did:plc`, or `verificationMethod` in `/.well-known/did.json` for `did:web`).
2. **Computing the Repository-Bound Attestation CID**
   - Start with the unsigned player record JSON and remove any `signatures` array.
   - Build transient `$sig` metadata (`$type`, `key`, `issuer`, `issuedAt`, **plus `"repository": "<player-did>"`**).
   - Encode `{ ...recordWithoutSigs, $sig }` to deterministic **DAG-CBOR**, compute its SHA-256 hash, and wrap as **CIDv1 (`bafy...`)**.
3. **Signing & Writing**
   - Sign `cid.bytes` with the game's private key (`low-S` normalized ECDSA).
   - Attach `{ $type: "games.opengaming.defs#inlineSignature", key: "did:plc:game#attestations", issuer, issuedAt, cid, signature: { $bytes } }` inside `signatures[]`.
   - Write the signed record to the **player's PDS** (`com.atproto.repo.putRecord` / `createRecord`).

### Built-In Security Guarantees
- **Tamper-Proof**: Modifying `score`, `achievement`, `unlockedAt`, or `recordedAt` changes the DAG-CBOR hash and invalidates the ECDSA signature.
- **Cross-Repository Replay Protection**: Because `"repository": "<player-did>"` is injected into `$sig` during CID calculation, copying Alice's signed record into Mallory's PDS produces a completely different CID and fails verification.
- **Cross-Publisher Spoofing Protection**: Verifiers check that the signing DID matches the DID authority in the referenced `achievement.definition` or `leaderboard.definition` AT-URI — Game B can never sign unlocks or scores for Game A.

---

## 2. Standard Revocation Schema (`games.opengaming.revocation`)

Because inline-signed records reside in the *player's* PDS, a game developer cannot directly delete a cheated score or mistakenly granted achievement from a player's repository. Instead, the game publisher writes a **`games.opengaming.revocation`** record into **the game's own PDS**.

### Why Revoke by `attestationCid` Instead of Only `recordUri`?
If a revocation only targeted a player's `recordUri` (e.g. `at://did:plc:cheater/games.opengaming.leaderboard.score/rkey-1`), the cheater could evade revocation simply by copying the **exact same signed JSON payload** to `rkey-2` in their own repository (since `$sig` binds to `repository`, not `rkey`).

By revoking **`attestationCid`** (the deterministic 32-byte CIDv1 that was signed):
- Re-uploading the signed record to *any* `rkey` produces the **exact same `attestationCid`** and remains revoked.
- Modifying *any* field inside the record to alter `attestationCid` breaks the ECDSA signature.
- Setting the revocation record's `rkey` equal to `<attestationCid>` (`at://<gameDid>/games.opengaming.revocation/<attestationCid>`) gives lightweight clients without a database an **O(1) single-request check** via `com.atproto.repo.getRecord`!

### Four Revocation Scopes

| `scope` | `rkey` Convention | Required Fields | Behavior |
| :--- | :--- | :--- | :--- |
| `"attestation"` | `<attestationCid>` | `attestationCid`, `player`, `subject`, `reason`, `revokedAt` | Surgically invalidates one specific signed unlock/score payload across all `rkey`s. |
| `"leaderboard"` | `getScopedRevocationRkey(...)` | `player`, `subject` (leaderboard URI), `reason`, `revokedAt` | Invalidates all scores by `player` on `subject` (optionally only at/before `before` ISO timestamp). |
| `"achievement"` | `getScopedRevocationRkey(...)` | `player`, `subject` (achievement URI), `reason`, `revokedAt` | Invalidates `player`'s unlocks for `subject` (optionally bounded by `before`). |
| `"game"` | `getScopedRevocationRkey(...)` | `player`, `subject` (game `define` URI), `reason`, `revokedAt` | Blanket game-wide revocation for `player` across all achievements & leaderboards of `subject` (optionally bounded by `before`). |

### Reinstatement (Un-Revoking)
To reinstate a mistakenly revoked score or player after an appeal or bug fix, simply **delete** the `games.opengaming.revocation` record from the game publisher's PDS (`opengaming unrevoke --rkey <rkey>`).

### Authority Rule
Compliant AppViews and `@opengaming/sdk` verify that a `games.opengaming.revocation` record resides in the **exact same publisher repository DID** that owns `subject`. No third party can ever revoke another game's achievements or scores.
