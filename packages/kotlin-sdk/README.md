# `games.opengaming:sdk` — Open Gaming Android & Kotlin SDK

Official Kotlin / Native Android SDK for the Open Gaming (`games.opengaming.*`) AT Protocol Lexicons:

- **100% Cryptographic Interoperability**: Canonical IPLD DAG-CBOR encoder (`DagCbor`), CIDv1 (`bafy...`) multiformats codec, and P-256 `low-S` ECDSA (`did:key:zDna...`) signing & verification matching `@opengaming/sdk` (TypeScript) and `com.opengaming.sdk` (Unity C#) byte-for-byte.
- **Coroutines & `kotlinx.serialization`**: First-class suspend APIs and `@Serializable` data models across all 11 `games.opengaming.*` schemas, plus R8/ProGuard consumer rules (`consumer-rules.pro`).
- **Native Android ATProto OAuth**: PKCE (`S256`) + Custom Tabs authorization URL builder + Android App Links / reverse-domain deep-link callback verification + RFC 9449 DPoP proof JWT generation (`DPoP-Nonce` auto-retry).
- **Offline Queue**: JSON-backed `enqueueOfflineWrite` / `flushOfflineQueue` ready to pair with Android `WorkManager`.

See [`../../docs/ANDROID_KOTLIN_SDK.md`](../../docs/ANDROID_KOTLIN_SDK.md) for Jetpack Compose, ViewModel, Custom Tabs OAuth, and `WorkManager` integration examples.
