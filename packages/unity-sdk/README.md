# `com.opengaming.sdk` — Open Gaming Unity C# SDK

Official Unity Package Manager (UPM) & `.NET` SDK for the Open Gaming (`games.opengaming.*`) AT Protocol Lexicons:

- **Zero External Dependencies & IL2CPP-Safe**: Self-contained canonical IPLD DAG-CBOR encoder, CIDv1 (`bafy...`) multiformats codec, P-256 `low-S` ECDSA (`did:key:zDna...`) cryptography, and JSON serializer.
- **Byte-for-Byte Interoperable with `@opengaming/sdk`**: Produces identical repository-bound attestation CIDs, deterministic `rkey`s, and ECDSA signatures.
- **Flexible Game Topologies**:
  1. **Backend-Attested Mode A**: Authenticate the player via ATProto Native OAuth (PKCE `S256` + DPoP + deep links), request a signed receipt from your game backend, and write to the player's PDS (`putRecord` / `createRecord`).
  2. **Serverless P2P Co-Signed Matches**: Sign and co-sign `games.opengaming.match.result` receipts across peer-to-peer participants (`CreateSignedMatchResult` + `CoSignMatchResult`).
  3. **Offline Resilience**: Queue PDS writes to `Application.persistentDataPath` when offline and flush automatically on reconnect.
- **Unity Runtime Components**: Includes `UnityWebRequestTransport` and `OpenGamingManager` `MonoBehaviour`.

See [`../../docs/UNITY_SDK.md`](../../docs/UNITY_SDK.md) for the complete Unity setup & integration guide.
