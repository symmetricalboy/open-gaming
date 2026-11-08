# `@opengaming/sdk`

Official TypeScript SDK and `opengaming` CLI for the Open Gaming (`games.opengaming.*`) AT Protocol Lexicons:

- **Mode A Inline Attestation**: P-256 key generation (`generateSigningKeys`), PLC `#attestations` setup (`registerAttestationKey`), deterministic repository-bound CID-first signing (`createSignedUnlock`, `createSignedProgress`, `createSignedScore`), and DID-resolved verification (`verifyRecordAttestation`).
- **Standard Revocations (`games.opengaming.revocation`)**: Surgical `attestationCid` and scoped (`leaderboard | achievement | game` with `before` cutoffs) revocation creation (`createRevocationRecord`), PDS publishing (`publishRevocation`), reinstatement (`reinstateRevocation`), O(1) PDS checking (`checkRevocationOnPds`), and authority-checked enforcement (`isRecordRevoked`).
- **Per-Game Completion & Profiles**: Uncapped per-game completion (`calculateGameCompletion`), deterministic achievement ordering (`sortAchievementDefinitions`), and Gamercard aggregation (`summarizeActorProfile`).
- **Leaderboards**: `numeric`, `time`, and `currency` integer formatting (`formatScore`) and `bestOnly` / `perWindowBest` / `everyRun` submission policies (`evaluateScoreSubmission`).
- **Lexicon Validation**: Pre-configured `@atproto/lexicon` validator (`createOpenGamingLexicons`).

See [`../../docs/SDK_AND_CLI.md`](../../docs/SDK_AND_CLI.md) for full CLI and TypeScript usage examples.
