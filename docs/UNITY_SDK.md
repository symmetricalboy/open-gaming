# Unity C# SDK Integration Guide (`com.opengaming.sdk`)

Package location: [`packages/unity-sdk/`](../packages/unity-sdk/)  
Target runtimes: **Unity 2021.3+** (Mono, IL2CPP, Desktop, iOS, Android, Consoles, WebGL) & **.NET 6+**

The `com.opengaming.sdk` package brings the full Open Gaming (`games.opengaming.*`) AT Protocol suite to Unity games with **zero external NuGet or UPM dependencies** — including canonical IPLD DAG-CBOR encoding, CIDv1 (`bafy...`) hashing, P-256 `low-S` ECDSA (`did:key:zDna...`) signing and verification, native ATProto PKCE + DPoP OAuth helpers, `UnityWebRequest` transport, offline write queueing, and AppView leaderboard/gamercard queries.

---

## 1. Architecture Overview

Open Gaming separates **publisher authority** from **player data ownership**:

1. **Game Studio PDS (`did:plc:yourstudio` or `did:web:yourgame.com`)**: Publishes canonical `games.atmosphere.define`, `achievement.definition`, `leaderboard.definition`, and `challenge.definition` records once (using the `opengaming` CLI), and registers a public `#attestations` `did:key` in its DID Document.
2. **Unity Game Client (`com.opengaming.sdk`)**:
   - Authenticates the player with their own ATProto account (Bluesky or any PDS) via Native OAuth (PKCE `S256` + DPoP + deep links).
   - Evaluates `recordPolicy` (`overwriteBest`, `personalBests`, `perWindowBest`, `everyRun`) locally via `OpenGamingLeaderboards.EvaluateScoreSubmission`.
   - Obtains a Mode A inline signature from your studio's attestation endpoint (or co-signs peer-to-peer `match.result` receipts directly between players!) and writes the signed record to the **player's own PDS** (`putRecord` / `createRecord`).
   - Queries any Open Gaming AppView (`opengaming.games` or self-hosted) to render global/social leaderboards, unlock rarity, and player gamercards.

> **Security Rule — Never Ship Studio Private Keys in Client Binaries:**  
> Never embed your studio's `OPENGAMING_PRIVATE_KEY` inside a Unity build (`Resources`, `StreamingAssets`, or C# constants), as Unity assemblies and IL2CPP metadata can be extracted by players. Keep your studio signing key on a lightweight backend / serverless function, **or** use P2P participant co-signing (`match.result`) / deterministic `replay` blobs for serverless games.

---

## 2. Installation (Unity Package Manager)

### Option A: Install via Git URL (Subfolder)
In the Unity Editor, open **Window -> Package Manager -> `+` -> Add package from git URL...** and enter:

```text
https://github.com/symmetricalboy/open-gaming.git?path=/packages/unity-sdk
```

### Option B: Local Monorepo Reference
In `Packages/manifest.json`:

```json
{
  "dependencies": {
    "com.opengaming.sdk": "file:../../packages/unity-sdk"
  }
}
```

### Scene Setup (`OpenGamingManager`)
Create an empty `GameObject` in your bootstrap scene and attach `OpenGaming.Sdk.Unity.OpenGamingManager`:
- **App View Base Url**: `https://opengaming.games` (or your custom AppView URL)
- **Game Uri**: `at://did:plc:yourstudio/games.atmosphere.define/your-game`

`OpenGamingManager` automatically configures `DontDestroyOnLoad`, initializes `UnityWebRequestTransport` with an ephemeral P-256 DPoP key, subscribes to `Application.deepLinkActivated`, and stores offline PDS writes at `Application.persistentDataPath/opengaming_offline_queue.json`.

---

## 3. Player Authentication in Unity

### A. Production: Native ATProto OAuth (PKCE `S256` + Deep Links + DPoP)

Host an `oauth-client-metadata.json` file on your game's HTTPS domain. Per the AT Protocol OAuth specification, native apps use `"application_type": "native"` and a reverse-domain custom URI scheme with a **single slash** after the colon:

```json
{
  "client_id": "https://skyquest.example.com/oauth-client-metadata.json",
  "client_name": "Sky Quest",
  "client_uri": "https://skyquest.example.com",
  "redirect_uris": [
    "com.example.skyquest:/oauth/callback"
  ],
  "scope": "atproto repo:games.opengaming.achievement.unlock repo:games.opengaming.achievement.progress repo:games.opengaming.leaderboard.score repo:games.opengaming.match.result blob:image/* blob:application/octet-stream",
  "token_endpoint_auth_method": "none",
  "response_types": ["code"],
  "grant_types": ["authorization_code", "refresh_token"],
  "application_type": "native",
  "dpop_bound_access_tokens": true
}
```

Register the matching custom scheme (`com.example.skyquest`) in **Project Settings -> Player -> iOS / Android / Windows Deep Linking**, then launch the OAuth flow from C#:

```csharp
using OpenGaming.Sdk;
using OpenGaming.Sdk.Unity;
using UnityEngine;

public class AtprotoSignInController : MonoBehaviour
{
    private PkceChallenge? _pendingPkce;

    private void OnEnable()
    {
        if (OpenGamingManager.Instance != null)
            OpenGamingManager.Instance.OnOAuthDeepLinkReceived += HandleOAuthCallback;
    }

    private void OnDisable()
    {
        if (OpenGamingManager.Instance != null)
            OpenGamingManager.Instance.OnOAuthDeepLinkReceived -= HandleOAuthCallback;
    }

    public void StartSignIn(string playerHandleHint)
    {
        _pendingPkce = OpenGamingClient.GeneratePkceChallenge();

        string authorizeUrl = OpenGamingClient.BuildNativeOAuthAuthorizeUrl(
            authorizationEndpoint: "https://bsky.social/oauth/authorize",
            clientIdMetadataUrl: "https://skyquest.example.com/oauth-client-metadata.json",
            redirectUri: "com.example.skyquest:/oauth/callback",
            pkce: _pendingPkce,
            loginHint: playerHandleHint
        );

        OpenGamingManager.Instance!.OpenSystemBrowserForOAuth(authorizeUrl);
    }

    private async void HandleOAuthCallback(string callbackUrl)
    {
        if (_pendingPkce == null || !callbackUrl.StartsWith("com.example.skyquest:/oauth/callback"))
            return;

        // Exchange `code` + `_pendingPkce.CodeVerifier` at the authorization server's token endpoint
        // using `OpenGamingClient.CreateDpopProofJwt(...)`, then assign `Client.Session`:
        Debug.Log($"Received ATProto OAuth redirect: {callbackUrl}");
        await OpenGamingManager.Instance!.Client.FlushOfflineQueueAsync(
            OpenGamingManager.Instance.OfflineQueuePath
        );
    }
}
```

### B. Unity Editor Development: App Passwords
During local Unity Editor prototyping (before deep-link schemes are registered on an OS), sign in with a test account App Password:

```csharp
var session = await OpenGamingManager.Instance!.Client.LoginWithAppPasswordAsync(
    identifier: "playtester.bsky.social",
    appPassword: "xxxx-xxxx-xxxx-xxxx",
    pdsUrl: "https://bsky.social"
);
Debug.Log($"Signed in as {session.Did}");
```

---

## 4. Pattern 1 (Recommended): Backend-Attested Unlocks & Scores

1. Your Unity client sends the run telemetry / session proof + `playerDid` to your studio backend.
2. Your backend validates gameplay, signs the record with `@opengaming/sdk` (`createSignedUnlock` / `createSignedScore`), and returns `{ record, rkey }`.
3. Your Unity client writes the signed record to **the player's PDS** (queueing offline automatically if connectivity drops!):

```csharp
using System.Collections.Generic;
using System.Threading.Tasks;
using OpenGaming.Sdk;
using OpenGaming.Sdk.Unity;
using UnityEngine;

public class GameplayAwardsService : MonoBehaviour
{
    private const string FirstBossUri =
        "at://did:plc:yourstudio/games.opengaming.achievement.definition/first-boss";
    private const string Stage1BoardUri =
        "at://did:plc:yourstudio/games.opengaming.leaderboard.definition/stage-1";

    public async Task UnlockBossAchievementAsync(byte[]? commemorativePng = null)
    {
        var manager = OpenGamingManager.Instance!;
        var client = manager.Client;
        string rkey = OpenGamingLeaderboards.GetUnlockRkey(FirstBossUri);

        // Optional: upload a commemorative screenshot blob (<= 2 MB) to the player's PDS first!
        BlobRef? mediaBlob = null;
        if (commemorativePng != null)
        {
            mediaBlob = await client.UploadBlobAsync(commemorativePng, "image/png");
        }

        var claimPayload = new Dictionary<string, object?>
        {
            ["achievement"] = FirstBossUri,
            ["playerDid"] = client.Session!.Did,
            ["rkey"] = rkey,
            ["note"] = "Defeated with 1 HP remaining!",
            ["media"] = mediaBlob?.ToRecordMap()
        };

        var (uri, _, _) = await client.RequestAttestedRecordAndWriteAsync(
            studioAttestationEndpoint: "https://api.skyquest.example.com/opengaming/sign-unlock",
            claimPayload: claimPayload,
            collection: OpenGamingConstants.Nsids.AchievementUnlock,
            writeMode: "putRecord",
            rkey: rkey
        );

        Debug.Log($"Verified unlock saved to player PDS: {uri}");
    }

    public async Task SubmitStageScoreAsync(
        long exScore,
        LeaderboardDefinitionRecord boardDef,
        List<LeaderboardScoreRecord> cachedPlayerScores)
    {
        var client = OpenGamingManager.Instance!.Client;
        var dims = new Dictionary<string, string> { ["mode"] = "4k" };

        // Check `overwriteBest` / `personalBests` / `perWindowBest` / `everyRun` before hitting the network
        var decision = OpenGamingLeaderboards.EvaluateScoreSubmission(
            leaderboardUri: Stage1BoardUri,
            score: exScore,
            definition: boardDef,
            existingPlayerScores: cachedPlayerScores,
            dimensions: dims
        );

        if (!decision.ShouldWrite)
        {
            Debug.Log($"Skipping PDS write: {decision.Reason}");
            return;
        }

        var claimPayload = new Dictionary<string, object?>
        {
            ["leaderboard"] = Stage1BoardUri,
            ["playerDid"] = client.Session!.Did,
            ["score"] = exScore,
            ["dimensions"] = dims,
            ["rkey"] = decision.RecommendedRkey
        };

        await client.RequestAttestedRecordAndWriteAsync(
            studioAttestationEndpoint: "https://api.skyquest.example.com/opengaming/sign-score",
            claimPayload: claimPayload,
            collection: OpenGamingConstants.Nsids.LeaderboardScore,
            writeMode: decision.WriteMode,
            rkey: decision.RecommendedRkey
        );
    }
}
```

---

## 5. Pattern 2: Serverless Peer-to-Peer PvP Co-Signing (`match.result`)

For serverless 1v1 fighting games, card battlers, chess, or Steam/WebRTC P2P lobbies where each player has registered `#attestations` on their own DID:

1. **Player A** constructs the canonical `MatchResultRecord` and signs it bound to `repositoryDid: aliceDid`.
2. **Player B** inspects the agreed outcome over your P2P channel and appends their co-signature via `OpenGamingAttestation.CoSignMatchResult`.
3. **Player A** writes the dual-signed record to their PDS — any AppView running `verifyMatchResult` verifies mutual consent with **zero studio backend**!

```csharp
using System.Collections.Generic;
using OpenGaming.Sdk;

// Step 1 (Alice's client): create initial signed match receipt for Alice's repo
var (draftMatch, _) = OpenGamingAttestation.CreateSignedMatchResult(
    new MatchResultRecord
    {
        Game = "at://did:plc:yourstudio/games.atmosphere.define/sky-duel",
        MatchId = "lobby-match-8842",
        Mode = "1v1-ranked",
        Participants = new List<MatchParticipant>
        {
            new MatchParticipant { Did = aliceDid, Outcome = "win", Score = 3 },
            new MatchParticipant { Did = bobDid, Outcome = "loss", Score = 2 }
        }
    },
    repositoryDid: aliceDid,
    issuerDid: aliceDid,
    signingKey: aliceAttestationKey,
    rkey: "lobby-match-8842"
);

// Step 2 (Bob's client): verify agreed scores and co-sign Alice's receipt
var (coSignedMatch, _, _) = OpenGamingAttestation.CoSignMatchResult(
    draftMatch,
    repositoryDid: aliceDid,
    signerDid: bobDid,
    signingKey: bobAttestationKey,
    rkey: "lobby-match-8842"
);

// Step 3 (Alice's client): write the co-signed receipt to Alice's PDS
await aliceClient.PutRecordAsync(
    collection: OpenGamingConstants.Nsids.MatchResult,
    rkey: "lobby-match-8842",
    record: coSignedMatch.ToRecordMap()
);
```

---

## 6. Querying Leaderboards, Gamercards & Game Libraries in Unity UI

```csharp
var client = OpenGamingManager.Instance!.Client;

// 1. Fetch Following-only ("social") Weekly Leaderboard around the current player
var socialBoard = await client.GetLeaderboardScoresAsync(
    leaderboardUri: "at://did:plc:yourstudio/games.opengaming.leaderboard.definition/stage-1",
    timeframe: "weekly",
    scope: "social",
    viewer: client.Session?.Did,
    dimensions: new Dictionary<string, string> { ["mode"] = "4k" },
    limit: 25
);

// 2. Fetch XP-free Player Gamercard (`games.opengaming.actor.getProfile`)
var profile = await client.GetActorProfileAsync("alice.bsky.social");

// 3. Format integer scores locally (`numeric`, `time`, `currency`, `signedPrefix`)
string formattedTime = OpenGamingLeaderboards.FormatScore(
    66032,
    new ScoreFormat { Kind = "time", TimeUnit = "milliseconds" }
); // "1:06.03"
```

---

## 7. IL2CPP, WebGL & Automated Testing

- **IL2CPP / AOT Safety**: `OpenGamingJson` and `DagCborEncoder` use explicit dictionary/type dispatch rather than runtime reflection codegen, so **High** Managed Stripping Levels work out-of-the-box without custom `link.xml` rules.
- **WebGL**: `UnityWebRequestTransport` uses Unity's browser `fetch`/`XMLHttpRequest` bridge on WebGL builds automatically. Ensure your studio attestation endpoint and target AppView include CORS headers (`Access-Control-Allow-Origin`).
- **Running SDK Tests Outside Unity**:
  ```bash
  dotnet run --project packages/unity-sdk/Tests/OpenGaming.Sdk.Tests.csproj
  ```
