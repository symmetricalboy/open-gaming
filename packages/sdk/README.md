# `@opengaming/sdk` & `@opengaming/sdk/appview`

Official TypeScript SDK, AppView & Web Viewer Toolkit, and `opengaming` CLI for the Open Gaming (`games.opengaming.*`) AT Protocol Lexicons:

- **Mode A Inline Attestation**: P-256 key generation (`generateSigningKeys`), PLC `#attestations` setup (`registerAttestationKey`), deterministic repository-bound CID-first signing (`createSignedUnlock`, `createSignedProgress`, `createSignedScore`, `createSignedMatchResult`, `coSignMatchResult`), and DID-resolved verification (`verifyRecordAttestation`, `verifyMatchResult`).
- **Standard Revocations & ATProto Labelers**: Surgical `attestationCid` and scoped (`leaderboard | achievement | match | challenge | game` with `before` cutoffs) revocation creation (`createRevocationRecord`), PDS publishing (`publishRevocation`), reinstatement (`reinstateRevocation`), O(1) PDS checking (`checkRevocationOnPds`), authority-checked enforcement (`isRecordRevoked`), and chronological ATProto Labeler folding (`resolveActiveLabels`).
- **Per-Game Completion & Profiles**: Uncapped per-game completion (`calculateGameCompletion`), non-penalizing `completionOptional` bonus badges, RFC 5545 `RRULE` timelocks (`isWithinTimelock`), BCP-47 localization (`resolveTranslation`), deterministic achievement ordering (`sortAchievementDefinitions`), and Gamercard aggregation (`summarizeActorProfile`).
- **Leaderboards**: Single-integer (`numeric`, `time`, `currency`, `signedPrefix`) and local multi-component (`#points`, `#percentage`, `#time`, `#enum`, `#text`) formatting & ranking (`formatScore`, `formatComponentValue`, `getScoreSortMetric`), sub-board `dimensions`, and `overwriteBest` / `personalBests` / `perWindowBest` / `everyRun` submission policies (`evaluateScoreSubmission`).
- **AppView & Web Viewer Toolkit (`@opengaming/sdk/appview`)**:
  - **Server-Side AppView**: Pluggable `AppViewStorageAdapter` (`MemoryAppViewStore`), `OpenGamingAppViewEngine` (indexing `games.atmosphere.define` / `games.gamesgamesgamesgames.game` catalogs, player game library shelves, and all `games.opengaming.*` records with reactive revocations & labels), `OpenGamingJetstreamConsumer`, `createAppViewFetchHandler`, and `fetchSafePdsBlob`.
  - **Web Viewer Client**: `OpenGamingViewerClient`, serverless `verifyActorDirectFromPds`, and headless UI helpers (`maskAchievementForViewer`, `groupLibraryByShelf`, `buildLeaderboardColumns`).
- **Lexicon Validation**: Pre-configured `@atproto/lexicon` validator (`createOpenGamingLexicons`).

## Multi-Platform SDKs & Guides
- **TypeScript & CLI Guide**: [`../../docs/SDK_AND_CLI.md`](../../docs/SDK_AND_CLI.md)
- **AppView & Web Viewer Guide**: [`../../docs/APPVIEW_IMPLEMENTATION.md`](../../docs/APPVIEW_IMPLEMENTATION.md)
- **Unity C# SDK (`com.opengaming.sdk`)**: [`../unity-sdk/`](../unity-sdk/) · [`../../docs/UNITY_SDK.md`](../../docs/UNITY_SDK.md)
- **Native Android Kotlin SDK (`games.opengaming:sdk`)**: [`../kotlin-sdk/`](../kotlin-sdk/) · [`../../docs/ANDROID_KOTLIN_SDK.md`](../../docs/ANDROID_KOTLIN_SDK.md)
