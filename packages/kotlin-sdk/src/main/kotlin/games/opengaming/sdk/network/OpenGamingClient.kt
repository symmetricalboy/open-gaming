package games.opengaming.sdk.network

import games.opengaming.sdk.ActorGameLibraryResponse
import games.opengaming.sdk.ActorProfileSummary
import games.opengaming.sdk.BlobRef
import games.opengaming.sdk.CidLinkWrapper
import games.opengaming.sdk.LeaderboardGetScoresResponse
import games.opengaming.sdk.OpenGamingConstants
import games.opengaming.sdk.OpenGamingJson
import games.opengaming.sdk.OpenGamingLeaderboards
import games.opengaming.sdk.cbor.CidV1
import games.opengaming.sdk.crypto.OpenGamingSigningKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant

data class HttpResponseData(
    val statusCode: Int,
    val body: String,
    val headers: Map<String, String> = emptyMap()
)

fun interface OpenGamingHttpTransport {
    suspend fun send(
        method: String,
        url: String,
        body: ByteArray?,
        contentType: String?,
        headers: Map<String, String>
    ): HttpResponseData
}

class HttpUrlConnectionTransport(
    private val connectTimeoutMs: Int = 15_000,
    private val readTimeoutMs: Int = 15_000
) : OpenGamingHttpTransport {
    override suspend fun send(
        method: String,
        url: String,
        body: ByteArray?,
        contentType: String?,
        headers: Map<String, String>
    ): HttpResponseData = withContext(Dispatchers.IO) {
        val conn = (URI.create(url).toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            for ((k, v) in headers) setRequestProperty(k, v)
            if (contentType != null) setRequestProperty("Content-Type", contentType)
        }

        try {
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            val outHeaders = mutableMapOf<String, String>()
            for ((k, vals) in conn.headerFields) {
                if (k != null && vals != null) outHeaders[k] = vals.joinToString(",")
            }
            HttpResponseData(status, text, outHeaders)
        } finally {
            conn.disconnect()
        }
    }
}

@Serializable
data class AtprotoSession(
    val did: String,
    val handle: String? = null,
    val pdsUrl: String = "https://bsky.social",
    val accessToken: String,
    val refreshToken: String? = null,
    val isDpopBound: Boolean = false,
    var dpopNonce: String? = null
)

data class PkceChallenge(
    val codeVerifier: String,
    val codeChallenge: String,
    val state: String
)

data class OAuthCallbackParams(
    val code: String,
    val state: String,
    val iss: String? = null
)

@Serializable
data class QueuedPdsWrite(
    val collection: String,
    val rkey: String? = null,
    val writeMode: String = "putRecord",
    val record: JsonObject
)

@Serializable
private data class OfflineQueueEnvelope(
    val items: List<QueuedPdsWrite> = emptyList()
)

/**
 * Coroutines-first AT Protocol & Open Gaming client for Native Android Kotlin applications.
 * Supports:
 * - Native OAuth PKCE (`S256`) + Custom Tabs / App Links callback parsing + RFC 9449 DPoP proof JWTs
 * - Writing signed or direct records & media/replay blobs to the player's PDS (`putRecord`, `createRecord`, `uploadBlob`)
 * - Studio backend attestation requests (`requestAttestedRecordAndWrite`)
 * - AppView queries (`getActorProfile`, `getLeaderboardScores`, `getActorLibrary`)
 * - Persistent `OfflineSubmissionQueue` for mobile connectivity drops
 */
class OpenGamingClient(
    appViewBaseUrl: String = "https://opengaming.games",
    private val transport: OpenGamingHttpTransport = HttpUrlConnectionTransport(),
    private val dpopKey: OpenGamingSigningKey? = null
) {
    private val appViewBase = appViewBaseUrl.trimEnd('/')
    var session: AtprotoSession? = null

    companion object {
        private val rng = SecureRandom()

        fun generatePkceChallenge(): PkceChallenge {
            val verifierBytes = ByteArray(32).also { rng.nextBytes(it) }
            val stateBytes = ByteArray(16).also { rng.nextBytes(it) }
            val verifier = CidV1.toBase64Url(verifierBytes)
            val challengeBytes = MessageDigest.getInstance("SHA-256")
                .digest(verifier.toByteArray(StandardCharsets.US_ASCII))
            return PkceChallenge(
                codeVerifier = verifier,
                codeChallenge = CidV1.toBase64Url(challengeBytes),
                state = CidV1.toBase64Url(stateBytes)
            )
        }

        /**
         * Build the authorization URL to launch inside an Android Custom Tab (`CustomTabsIntent`).
         * Remember ATProto native OAuth requires a reverse-DNS custom scheme with a single slash
         * (e.g. `com.studio.mygame:/oauth/callback`) matching the `client_id` domain.
         */
        fun buildNativeOAuthAuthorizeUrl(
            authorizationEndpoint: String,
            clientIdMetadataUrl: String,
            redirectUri: String,
            pkce: PkceChallenge,
            scope: String = OpenGamingConstants.RECOMMENDED_OAUTH_SCOPES,
            loginHint: String? = null
        ): String {
            val sep = if ('?' in authorizationEndpoint) "&" else "?"
            return buildString {
                append(authorizationEndpoint).append(sep)
                append("response_type=code")
                append("&client_id=").append(urlEnc(clientIdMetadataUrl))
                append("&redirect_uri=").append(urlEnc(redirectUri))
                append("&scope=").append(urlEnc(scope))
                append("&code_challenge=").append(urlEnc(pkce.codeChallenge))
                append("&code_challenge_method=S256")
                append("&state=").append(urlEnc(pkce.state))
                if (!loginHint.isNullOrBlank()) {
                    append("&login_hint=").append(urlEnc(loginHint))
                }
            }
        }

        /**
         * Parse and validate the deep-link callback URI delivered to your Android Activity's `intent.data`.
         */
        fun parseOAuthCallbackUri(callbackUri: String, expectedState: String): OAuthCallbackParams {
            val uri = URI.create(callbackUri)
            val params = uri.rawQuery.orEmpty()
                .split('&')
                .mapNotNull { pair ->
                    val idx = pair.indexOf('=')
                    if (idx <= 0) null
                    else URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8) to
                        URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8)
                }.toMap()

            val error = params["error"]
            require(error.isNullOrEmpty()) {
                "OAuth authorization failed: $error (${params["error_description"].orEmpty()})"
            }

            val state = params["state"] ?: throw IllegalArgumentException("Missing OAuth state parameter.")
            require(state == expectedState) { "OAuth state mismatch." }

            val code = params["code"] ?: throw IllegalArgumentException("Missing OAuth authorization code.")
            return OAuthCallbackParams(code = code, state = state, iss = params["iss"])
        }

        fun createDpopProofJwt(
            dpopKey: OpenGamingSigningKey,
            httpMethod: String,
            targetUrl: String,
            nonce: String? = null,
            accessToken: String? = null
        ): String {
            val jtiBytes = ByteArray(16).also { rng.nextBytes(it) }
            val header = buildJsonObject {
                put("typ", "dpop+jwt")
                put("alg", "ES256")
                put("jwk", buildJsonObject {
                    put("kty", "EC")
                    put("crv", "P-256")
                    put("x", CidV1.toBase64Url(dpopKey.publicPointX))
                    put("y", CidV1.toBase64Url(dpopKey.publicPointY))
                })
            }

            val payload = buildJsonObject {
                put("jti", CidV1.toBase64Url(jtiBytes))
                put("htm", httpMethod.uppercase())
                put("htu", targetUrl.substringBefore('?'))
                put("iat", Instant.now().epochSecond)
                if (!nonce.isNullOrEmpty()) put("nonce", nonce)
                if (!accessToken.isNullOrEmpty()) {
                    val ath = MessageDigest.getInstance("SHA-256")
                        .digest(accessToken.toByteArray(StandardCharsets.US_ASCII))
                    put("ath", CidV1.toBase64Url(ath))
                }
            }

            val h64 = CidV1.toBase64Url(OpenGamingJson.encodeToString(header).encodeToByteArray())
            val p64 = CidV1.toBase64Url(OpenGamingJson.encodeToString(payload).encodeToByteArray())
            val signingInput = "$h64.$p64"
            val sig = dpopKey.sign(signingInput.toByteArray(StandardCharsets.US_ASCII))
            return "$signingInput.${CidV1.toBase64Url(sig)}"
        }

        private fun urlEnc(s: String): String = URLEncoder.encode(s, StandardCharsets.UTF_8)
    }

    suspend fun loginWithAppPassword(
        identifier: String,
        appPassword: String,
        pdsUrl: String = "https://bsky.social"
    ): AtprotoSession {
        val cleanPds = pdsUrl.trimEnd('/')
        val body = buildJsonObject {
            put("identifier", identifier)
            put("password", appPassword)
        }
        val res = sendJson("POST", "$cleanPds/xrpc/com.atproto.server.createSession", body, includeAuth = false)
        ensureSuccess(res, "createSession")
        val obj = OpenGamingJson.decodeFromString<JsonObject>(res.body)
        val created = AtprotoSession(
            did = obj["did"]?.jsonPrimitive?.content.orEmpty(),
            handle = obj["handle"]?.jsonPrimitive?.contentOrNull,
            pdsUrl = cleanPds,
            accessToken = obj["accessJwt"]?.jsonPrimitive?.content.orEmpty(),
            refreshToken = obj["refreshJwt"]?.jsonPrimitive?.contentOrNull,
            isDpopBound = false
        )
        session = created
        return created
    }

    suspend fun putRecord(
        collection: String,
        rkey: String,
        record: JsonObject
    ): Pair<String, String> {
        val s = requireNotNull(session) { "No active ATProto session." }
        val payload = buildJsonObject {
            put("repo", s.did)
            put("collection", collection)
            put("rkey", rkey)
            put("record", record)
        }
        val res = sendJson("POST", "${s.pdsUrl.trimEnd('/')}/xrpc/com.atproto.repo.putRecord", payload, includeAuth = true)
        ensureSuccess(res, "putRecord")
        val obj = OpenGamingJson.decodeFromString<JsonObject>(res.body)
        return (obj["uri"]?.jsonPrimitive?.content.orEmpty()) to (obj["cid"]?.jsonPrimitive?.content.orEmpty())
    }

    suspend fun createRecord(
        collection: String,
        record: JsonObject,
        rkey: String? = null
    ): Pair<String, String> {
        val s = requireNotNull(session) { "No active ATProto session." }
        val payload = buildJsonObject {
            put("repo", s.did)
            put("collection", collection)
            if (!rkey.isNullOrEmpty()) put("rkey", rkey)
            put("record", record)
        }
        val res = sendJson("POST", "${s.pdsUrl.trimEnd('/')}/xrpc/com.atproto.repo.createRecord", payload, includeAuth = true)
        ensureSuccess(res, "createRecord")
        val obj = OpenGamingJson.decodeFromString<JsonObject>(res.body)
        return (obj["uri"]?.jsonPrimitive?.content.orEmpty()) to (obj["cid"]?.jsonPrimitive?.content.orEmpty())
    }

    suspend fun uploadBlob(bytes: ByteArray, mimeType: String): BlobRef {
        val s = requireNotNull(session) { "No active ATProto session." }
        val url = "${s.pdsUrl.trimEnd('/')}/xrpc/com.atproto.repo.uploadBlob"
        val res = transport.send("POST", url, bytes, mimeType, buildAuthHeaders("POST", url))
        ensureSuccess(res, "uploadBlob")
        val root = OpenGamingJson.decodeFromString<JsonObject>(res.body)
        val blob = root["blob"]?.jsonObject ?: error("Missing blob in uploadBlob response.")
        val link = blob["ref"]?.jsonObject?.get("\$link")?.jsonPrimitive?.content.orEmpty()
        val size = blob["size"]?.jsonPrimitive?.longOrNull ?: bytes.size.toLong()
        return BlobRef(ref = CidLinkWrapper(link), mimeType = mimeType, size = size)
    }

    suspend fun requestAttestedRecordAndWrite(
        studioAttestationEndpoint: String,
        claimPayload: JsonObject,
        collection: String,
        writeMode: String = "putRecord",
        rkey: String? = null,
        studioAuthBearerToken: String? = null
    ): Triple<String, String, JsonObject> {
        val headers = if (!studioAuthBearerToken.isNullOrEmpty()) {
            mapOf("Authorization" to "Bearer $studioAuthBearerToken")
        } else emptyMap()

        val res = transport.send(
            "POST",
            studioAttestationEndpoint,
            OpenGamingJson.encodeToString(claimPayload).encodeToByteArray(),
            "application/json",
            headers
        )
        ensureSuccess(res, "studioAttestation")

        val parsed = OpenGamingJson.decodeFromString<JsonObject>(res.body)
        val signedRecord = (parsed["record"] as? JsonObject) ?: parsed
        val effectiveRkey = rkey ?: parsed["rkey"]?.jsonPrimitive?.contentOrNull

        val (uri, cid) = if (writeMode == "putRecord" && !effectiveRkey.isNullOrEmpty()) {
            putRecord(collection, effectiveRkey, signedRecord)
        } else {
            createRecord(collection, signedRecord, effectiveRkey)
        }
        return Triple(uri, cid, signedRecord)
    }

    suspend fun getActorProfile(actor: String): ActorProfileSummary {
        val url = "$appViewBase/xrpc/${OpenGamingConstants.Nsids.ACTOR_GET_PROFILE}?actor=${urlEnc(actor)}"
        val res = transport.send("GET", url, null, null, emptyMap())
        ensureSuccess(res, "actor.getProfile")
        return OpenGamingJson.decodeFromString(res.body)
    }

    suspend fun getLeaderboardScores(
        leaderboard: String,
        timeframe: String = "allTime",
        scope: String = "public",
        viewer: String? = null,
        player: String? = null,
        includeObsolete: Boolean = false,
        sortBy: String? = null,
        dimensions: Map<String, String>? = null,
        seed: String? = null,
        limit: Int = 25
    ): LeaderboardGetScoresResponse {
        val url = buildString {
            append("$appViewBase/xrpc/${OpenGamingConstants.Nsids.LEADERBOARD_GET_SCORES}")
            append("?leaderboard=").append(urlEnc(leaderboard))
            append("&timeframe=").append(urlEnc(timeframe))
            append("&scope=").append(urlEnc(scope))
            append("&limit=").append(limit)
            if (!viewer.isNullOrEmpty()) append("&viewer=").append(urlEnc(viewer))
            if (!player.isNullOrEmpty()) append("&player=").append(urlEnc(player))
            if (includeObsolete) append("&includeObsolete=true")
            if (!sortBy.isNullOrEmpty()) append("&sortBy=").append(urlEnc(sortBy))
            val dimStr = OpenGamingLeaderboards.serializeDimensionsFilter(dimensions)
            if (dimStr.isNotEmpty()) append("&dimensions=").append(urlEnc(dimStr))
            if (!seed.isNullOrEmpty()) append("&seed=").append(urlEnc(seed))
        }
        val res = transport.send("GET", url, null, null, emptyMap())
        ensureSuccess(res, "leaderboard.getScores")
        return OpenGamingJson.decodeFromString(res.body)
    }

    suspend fun getActorLibrary(actor: String, shelf: String? = null): ActorGameLibraryResponse {
        val url = buildString {
            append("$appViewBase/api/library?actor=").append(urlEnc(actor))
            if (!shelf.isNullOrEmpty()) append("&shelf=").append(urlEnc(shelf))
        }
        val res = transport.send("GET", url, null, null, emptyMap())
        ensureSuccess(res, "api/library")
        return OpenGamingJson.decodeFromString(res.body)
    }

    fun enqueueOfflineWrite(queueFile: File, item: QueuedPdsWrite) {
        val current = loadQueue(queueFile)
        saveQueue(queueFile, current + item)
    }

    suspend fun flushOfflineQueue(queueFile: File): Int {
        val current = loadQueue(queueFile)
        if (current.isEmpty()) return 0

        val remaining = mutableListOf<QueuedPdsWrite>()
        var flushed = 0
        for (item in current) {
            try {
                if (item.writeMode == "putRecord" && !item.rkey.isNullOrEmpty()) {
                    putRecord(item.collection, item.rkey, item.record)
                } else {
                    createRecord(item.collection, item.record, item.rkey)
                }
                flushed++
            } catch (_: Exception) {
                remaining.add(item)
            }
        }
        saveQueue(queueFile, remaining)
        return flushed
    }

    private fun loadQueue(file: File): List<QueuedPdsWrite> {
        if (!file.exists()) return emptyList()
        val raw = file.readText(StandardCharsets.UTF_8)
        if (raw.isBlank()) return emptyList()
        return runCatching { OpenGamingJson.decodeFromString<OfflineQueueEnvelope>(raw).items }.getOrDefault(emptyList())
    }

    private fun saveQueue(file: File, items: List<QueuedPdsWrite>) {
        file.parentFile?.mkdirs()
        file.writeText(OpenGamingJson.encodeToString(OfflineQueueEnvelope(items)), StandardCharsets.UTF_8)
    }

    private fun buildAuthHeaders(method: String, url: String): Map<String, String> {
        val s = session ?: return emptyMap()
        if (s.accessToken.isEmpty()) return emptyMap()
        return if (s.isDpopBound && dpopKey != null) {
            mapOf(
                "Authorization" to "DPoP ${s.accessToken}",
                "DPoP" to createDpopProofJwt(dpopKey, method, url, s.dpopNonce, s.accessToken)
            )
        } else {
            mapOf("Authorization" to "Bearer ${s.accessToken}")
        }
    }

    private suspend fun sendJson(
        method: String,
        url: String,
        payload: JsonObject,
        includeAuth: Boolean
    ): HttpResponseData {
        val bodyBytes = OpenGamingJson.encodeToString(payload).encodeToByteArray()
        val headers = if (includeAuth) buildAuthHeaders(method, url) else emptyMap()
        var res = transport.send(method, url, bodyBytes, "application/json", headers)

        val s = session
        val newNonce = res.headers.entries.firstOrNull { it.key.equals("DPoP-Nonce", ignoreCase = true) }?.value
        if (includeAuth && s != null && s.isDpopBound && dpopKey != null &&
            (res.statusCode == 400 || res.statusCode == 401) && !newNonce.isNullOrEmpty()
        ) {
            s.dpopNonce = newNonce
            res = transport.send(method, url, bodyBytes, "application/json", buildAuthHeaders(method, url))
        }
        return res
    }

    private fun ensureSuccess(res: HttpResponseData, op: String) {
        if (res.statusCode !in 200..299) {
            throw IllegalStateException("Open Gaming $op failed (HTTP ${res.statusCode}): ${res.body}")
        }
    }
}
