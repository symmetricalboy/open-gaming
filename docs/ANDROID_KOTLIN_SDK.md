# Native Android Kotlin SDK Guide (`games.opengaming:sdk`)

Package location: [`packages/kotlin-sdk/`](../packages/kotlin-sdk/)  
Target runtimes: **Android API 26+ (Android 8.0+)**, **Jetpack Compose / Views**, and **Kotlin JVM 17+**

The `games.opengaming:sdk` library provides idiomatic Kotlin Coroutines and `kotlinx.serialization` components for integrating Open Gaming (`games.opengaming.*`) into native Android games and companion apps — with 100% byte-for-byte DAG-CBOR, CIDv1 (`bafy...`), and P-256 `low-S` ECDSA (`did:key:zDna...`) compatibility with `@opengaming/sdk` (TypeScript) and `com.opengaming.sdk` (Unity C#).

---

## 1. Gradle Setup

### Option A: Monorepo Composite Build (`settings.gradle.kts`)
```kotlin
// settings.gradle.kts
includeBuild("../open-gaming/packages/kotlin-sdk")
```

### Option B: App Module Dependencies (`app/build.gradle.kts`)
```kotlin
plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.serialization")
}

dependencies {
    implementation("games.opengaming:sdk:0.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
    implementation("androidx.browser:browser:1.8.0")       // Chrome Custom Tabs for ATProto OAuth
    implementation("androidx.work:work-runtime-ktx:2.10.0") // Optional: background offline sync
}
```

R8 / ProGuard rules for `kotlinx.serialization` classes are bundled automatically via [`consumer-rules.pro`](../packages/kotlin-sdk/consumer-rules.pro).

---

## 2. Native Android ATProto OAuth (Custom Tabs + PKCE `S256` + DPoP)

### Step 1: Publish `oauth-client-metadata.json`
Host your OAuth client metadata on your game's HTTPS domain. Native Android apps use `"application_type": "native"` and a reverse-DNS custom scheme matching your domain (note the **single slash** after `:`):

```json
{
  "client_id": "https:// pocketracer.example.com/oauth-client-metadata.json",
  "client_name": "Pocket Racer",
  "client_uri": "https://pocketracer.example.com",
  "redirect_uris": [
    "com.example.pocketracer:/oauth/callback"
  ],
  "scope": "atproto repo:games.opengaming.achievement.unlock repo:games.opengaming.achievement.progress repo:games.opengaming.leaderboard.score repo:games.opengaming.match.result blob:image/* blob:application/octet-stream",
  "token_endpoint_auth_method": "none",
  "response_types": ["code"],
  "grant_types": ["authorization_code", "refresh_token"],
  "application_type": "native",
  "dpop_bound_access_tokens": true
}
```

### Step 2: Register the Redirect Intent Filter in `AndroidManifest.xml`
```xml
<activity
    android:name=".MainActivity"
    android:exported="true"
    android:launchMode="singleTop">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data
            android:scheme="com.example.pocketracer"
            android:path="/oauth/callback" />
    </intent-filter>
</activity>
```

### Step 3: Launch Custom Tabs & Handle the Callback
```kotlin
package com.example.pocketracer.auth

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import games.opengaming.sdk.crypto.OpenGamingSigningKey
import games.opengaming.sdk.network.OpenGamingClient
import games.opengaming.sdk.network.PkceChallenge

class AtprotoAuthManager(
    val dpopKey: OpenGamingSigningKey = OpenGamingSigningKey.generate(),
    val client: OpenGamingClient = OpenGamingClient(
        appViewBaseUrl = "https://opengaming.games",
        dpopKey = dpopKey
    )
) {
    private var pendingPkce: PkceChallenge? = null

    fun launchSignIn(context: Context, handleHint: String? = null) {
        val pkce = OpenGamingClient.generatePkceChallenge()
        pendingPkce = pkce

        val authUrl = OpenGamingClient.buildNativeOAuthAuthorizeUrl(
            authorizationEndpoint = "https://bsky.social/oauth/authorize",
            clientIdMetadataUrl = "https://pocketracer.example.com/oauth-client-metadata.json",
            redirectUri = "com.example.pocketracer:/oauth/callback",
            pkce = pkce,
            loginHint = handleHint
        )

        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
            .launchUrl(context, Uri.parse(authUrl))
    }

    fun handleRedirectIntent(intent: Intent?) {
        val data = intent?.data?.toString() ?: return
        val expectedPkce = pendingPkce ?: return
        if (!data.startsWith("com.example.pocketracer:/oauth/callback")) return

        val callback = OpenGamingClient.parseOAuthCallbackUri(data, expectedPkce.state)
        pendingPkce = null
        // Exchange `callback.code` + `expectedPkce.codeVerifier` with DPoP header
        // (`OpenGamingClient.createDpopProofJwt(dpopKey, "POST", tokenEndpoint)`),
        // then populate `client.session = AtprotoSession(..., isDpopBound = true)`!
    }
}
```

> **Tip — Automatic `DPoP-Nonce` Rotation:**  
> `OpenGamingClient` automatically catches HTTP `400`/`401` `DPoP-Nonce` challenges from ATProto PDSes, updates `session.dpopNonce`, re-signs a fresh RFC 9449 DPoP JWT proof, and retries the request transparently.

---

## 3. Unlocking Achievements & Submitting Scores (`ViewModel` + Coroutines)

Keep your studio's `OPENGAMING_PRIVATE_KEY` on your game server or cloud function. From your Android `ViewModel`, request the Mode A signed receipt and write it directly to the player's PDS:

```kotlin
package com.example.pocketracer.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import games.opengaming.sdk.*
import games.opengaming.sdk.network.OpenGamingClient
import games.opengaming.sdk.network.QueuedPdsWrite
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

class GameProgressViewModel(
    private val client: OpenGamingClient,
    private val offlineQueueFile: File
) : ViewModel() {

    private val _profile = MutableStateFlow<ActorProfileSummary?>(null)
    val profile: StateFlow<ActorProfileSummary?> = _profile

    private val lapBoardUri =
        "at://did:plc:pocketracer/games.opengaming.leaderboard.definition/canyon-time-trial"
    private val driftAchUri =
        "at://did:plc:pocketracer/games.opengaming.achievement.definition/drift-master"

    fun unlockDriftAchievement(screenshotPng: ByteArray? = null) {
        val playerDid = client.session?.did ?: return
        val rkey = OpenGamingLeaderboards.getUnlockRkey(driftAchUri)

        viewModelScope.launch {
            val mediaBlob = screenshotPng?.let { client.uploadBlob(it, "image/png") }

            val claim = buildJsonObject {
                put("achievement", driftAchUri)
                put("playerDid", playerDid)
                put("rkey", rkey)
                put("note", " drifted the entire hairpin without braking!")
                if (mediaBlob != null) {
                    put("mediaCid", mediaBlob.ref.link)
                }
            }

            runCatching {
                client.requestAttestedRecordAndWrite(
                    studioAttestationEndpoint = "https://api.pocketracer.example.com/opengaming/sign-unlock",
                    claimPayload = claim,
                    collection = OpenGamingConstants.Nsids.ACHIEVEMENT_UNLOCK,
                    writeMode = "putRecord",
                    rkey = rkey
                )
            }.onSuccess {
                refreshGamercard(playerDid)
            }
        }
    }

    fun submitLapTimeMs(
        lapTimeMs: Long,
        boardDef: LeaderboardDefinitionRecord,
        existingRuns: List<LeaderboardScoreRecord>
    ) {
        val playerDid = client.session?.did ?: return
        val decision = OpenGamingLeaderboards.evaluateScoreSubmission(
            leaderboardUri = lapBoardUri,
            score = lapTimeMs,
            definition = boardDef,
            existingPlayerScores = existingRuns,
            dimensions = mapOf("car" to "gt-turbo")
        )
        if (!decision.shouldWrite) return

        viewModelScope.launch {
            val claim = buildJsonObject {
                put("leaderboard", lapBoardUri)
                put("playerDid", playerDid)
                put("score", lapTimeMs)
                put("rkey", decision.recommendedRkey)
            }

            try {
                client.requestAttestedRecordAndWrite(
                    studioAttestationEndpoint = "https://api.pocketracer.example.com/opengaming/sign-score",
                    claimPayload = claim,
                    collection = OpenGamingConstants.Nsids.LEADERBOARD_SCORE,
                    writeMode = decision.writeMode,
                    rkey = decision.recommendedRkey
                )
            } catch (_: Exception) {
                // If player is on subway / airplane mode, queue locally for WorkManager sync
                val unsignedFallback = LeaderboardScoreRecord(
                    leaderboard = lapBoardUri,
                    player = playerDid,
                    score = lapTimeMs,
                    dimensions = mapOf("car" to "gt-turbo"),
                    recordedAt = java.time.Instant.now().toString()
                )
                val recordJson = OpenGamingJson.decodeFromString<kotlinx.serialization.json.JsonObject>(
                    OpenGamingJson.encodeToString(LeaderboardScoreRecord.serializer(), unsignedFallback)
                )
                client.enqueueOfflineWrite(
                    offlineQueueFile,
                    QueuedPdsWrite(
                        collection = OpenGamingConstants.Nsids.LEADERBOARD_SCORE,
                        rkey = decision.recommendedRkey,
                        writeMode = decision.writeMode,
                        record = recordJson
                    )
                )
            }
        }
    }

    fun refreshGamercard(actor: String) {
        viewModelScope.launch {
            _profile.value = runCatching { client.getActorProfile(actor) }.getOrNull()
        }
    }
}
```

---

## 4. Serverless P2P Match Co-Signing on Android (`match.result`)

For local Wi-Fi / Nearby Connections / turn-based mobile PvP games without a studio server, players can sign and co-sign `MatchResultRecord` directly on device:

```kotlin
// Player 1 creates and signs the initial match record bound to Player 1's repo
val (matchStep1, _) = OpenGamingAttestation.createSignedMatchResult(
    match = MatchResultRecord(
        game = "at://did:plc:pocketracer/games.atmosphere.define/pocket-racer",
        matchId = "nearby-race-77",
        mode = "1v1-sprint",
        participants = listOf(
            MatchParticipant(did = aliceDid, outcome = "win", score = 1),
            MatchParticipant(did = bobDid, outcome = "loss", score = 2)
        ),
        playedAt = java.time.Instant.now().toString()
    ),
    repositoryDid = aliceDid,
    issuerDid = aliceDid,
    signingKey = aliceKey,
    rkey = "nearby-race-77"
)

// Player 2 verifies the result over Nearby Connections / WebRTC and appends their co-signature
val (coSignedMatch, _, _) = OpenGamingAttestation.coSignMatchResult(
    match = matchStep1,
    repositoryDid = aliceDid,
    signerDid = bobDid,
    signingKey = bobKey,
    rkey = "nearby-race-77"
)
```

---

## 5. Jetpack Compose Leaderboard & Gamercard UI Example

```kotlin
@Composable
fun LeaderboardScreen(
    client: OpenGamingClient,
    leaderboardUri: String,
    viewerDid: String?
) {
    var scope by remember { mutableStateOf("public") }
    var response by remember { mutableStateOf<LeaderboardGetScoresResponse?>(null) }

    LaunchedEffect(leaderboardUri, scope) {
        response = client.getLeaderboardScores(
            leaderboard = leaderboardUri,
            timeframe = "weekly",
            scope = scope,
            viewer = viewerDid,
            limit = 50
        )
    }

    Column {
        Row {
            FilterChip(
                selected = scope == "public",
                onClick = { scope = "public" },
                label = { Text("Global") }
            )
            if (viewerDid != null) {
                FilterChip(
                    selected = scope == "social",
                    onClick = { scope = "social" },
                    label = { Text("Following") }
                )
            }
        }

        LazyColumn {
            items(response?.entries.orEmpty(), key = { it.uri }) { entry ->
                ListItem(
                    leadingContent = { Text("#${entry.rank}") },
                    headlineContent = { Text(entry.displayName ?: entry.handle ?: entry.player) },
                    supportingContent = {
                        if (!entry.dimensions.isNullOrEmpty()) {
                            Text(entry.dimensions.entries.joinToString(" · ") { "${it.key}: ${it.value}" })
                        }
                    },
                    trailingContent = { Text(entry.displayScore ?: entry.score.toString()) }
                )
            }
        }
    }
}
```

---

## 6. Offline Background Sync with `WorkManager`

Pair `client.flushOfflineQueue(queueFile)` with a constrained `CoroutineWorker` so awards earned offline sync automatically as soon as `NetworkType.CONNECTED` returns:

```kotlin
class OpenGamingSyncWorker(
    appContext: Context,
    params: WorkerParameters,
    private val client: OpenGamingClient
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val queueFile = File(applicationContext.filesDir, "opengaming_offline_queue.json")
        val flushed = runCatching { client.flushOfflineQueue(queueFile) }
            .getOrElse { return Result.retry() }
        return if (queueFile.exists() && flushed == 0) Result.retry() else Result.success()
    }
}
```

---

## 7. Running Unit Tests

```bash
cd packages/kotlin-sdk
gradle test
```
