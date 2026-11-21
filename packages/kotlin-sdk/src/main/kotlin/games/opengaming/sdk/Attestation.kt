package games.opengaming.sdk

import games.opengaming.sdk.cbor.CidV1
import games.opengaming.sdk.cbor.DagCbor
import games.opengaming.sdk.crypto.OpenGamingSigningKey
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.security.MessageDigest
import java.time.Instant

object OpenGamingAttestation {

    /**
     * Compute the deterministic repository-bound CIDv1 (`bafy...`) for an Open Gaming record,
     * matching `@opengaming/sdk` (TypeScript) and `com.opengaming.sdk` (Unity C#) byte-for-byte.
     */
    fun computeAttestationCid(
        record: JsonObject,
        signatureMetadata: JsonObject,
        repositoryDid: String
    ): CidV1 {
        require(repositoryDid.startsWith("did:")) {
            "Invalid repositoryDid: expected DID starting with 'did:', got '$repositoryDid'."
        }

        val sigPayload = buildJsonObject {
            for ((k, v) in signatureMetadata) {
                if (k == "signature" || k == "cid") continue
                put(k, v)
            }
            put("repository", repositoryDid)
        }

        val attestationPayload = buildJsonObject {
            for ((k, v) in record) {
                if (k == "signatures") continue
                put(k, v)
            }
            put("\$sig", sigPayload)
        }

        val cborBytes = DagCbor.encode(attestationPayload)
        return CidV1.fromDagCborBytes(cborBytes)
    }

    fun createInlineSignature(
        record: JsonObject,
        issuerDid: String,
        playerDid: String,
        signingKey: OpenGamingSigningKey,
        issuedAt: String = Instant.now().toString(),
        rkey: String? = null,
        keyId: String? = null
    ): Pair<InlineSignature, String> {
        require(issuerDid.startsWith("did:")) { "Invalid issuerDid: expected DID, got '$issuerDid'." }
        val resolvedKeyId = keyId ?: "$issuerDid${OpenGamingConstants.ATTESTATION_KEY_FRAGMENT}"

        val meta = buildJsonObject {
            put("\$type", "${OpenGamingConstants.Nsids.DEFS}#inlineSignature")
            put("key", resolvedKeyId)
            put("issuer", issuerDid)
            put("issuedAt", issuedAt)
            if (!rkey.isNullOrEmpty()) put("rkey", rkey)
        }

        val cid = computeAttestationCid(record, meta, playerDid)
        val sigBytes = signingKey.sign(cid.bytes)
        val cidStr = cid.value

        val inlineSig = InlineSignature(
            type = "${OpenGamingConstants.Nsids.DEFS}#inlineSignature",
            key = resolvedKeyId,
            issuer = issuerDid,
            issuedAt = issuedAt,
            rkey = rkey?.takeIf { it.isNotEmpty() },
            cid = cidStr,
            signature = BytesWrapper(CidV1.toBase64Unpadded(sigBytes))
        )
        return inlineSig to cidStr
    }

    fun createSignedUnlock(
        unlock: AchievementUnlockRecord,
        playerDid: String,
        issuerDid: String,
        signingKey: OpenGamingSigningKey,
        rkey: String? = null,
        keyId: String? = null
    ): Pair<AchievementUnlockRecord, String> {
        val unsigned = unlock.copy(player = playerDid, signatures = null)
        val jsonObj = OpenGamingJson.decodeFromString<JsonObject>(OpenGamingJson.encodeToString(unsigned))
        val (sig, cid) = createInlineSignature(
            record = jsonObj,
            issuerDid = issuerDid,
            playerDid = playerDid,
            signingKey = signingKey,
            issuedAt = unsigned.unlockedAt,
            rkey = rkey,
            keyId = keyId
        )
        return unsigned.copy(signatures = listOf(sig)) to cid
    }

    fun createSignedProgress(
        progress: AchievementProgressRecord,
        playerDid: String,
        issuerDid: String,
        signingKey: OpenGamingSigningKey,
        rkey: String? = null,
        keyId: String? = null
    ): Pair<AchievementProgressRecord, String> {
        val unsigned = progress.copy(signatures = null)
        val jsonObj = OpenGamingJson.decodeFromString<JsonObject>(OpenGamingJson.encodeToString(unsigned))
        val (sig, cid) = createInlineSignature(
            record = jsonObj,
            issuerDid = issuerDid,
            playerDid = playerDid,
            signingKey = signingKey,
            issuedAt = unsigned.updatedAt,
            rkey = rkey,
            keyId = keyId
        )
        return unsigned.copy(signatures = listOf(sig)) to cid
    }

    fun createSignedScore(
        score: LeaderboardScoreRecord,
        playerDid: String,
        issuerDid: String,
        signingKey: OpenGamingSigningKey,
        rkey: String? = null,
        keyId: String? = null
    ): Pair<LeaderboardScoreRecord, String> {
        val inferredScore = score.score ?: score.components?.values?.firstNotNullOfOrNull { it.value.longOrNull }
        require(inferredScore != null || !score.components.isNullOrEmpty()) {
            "createSignedScore requires either score or at least one entry in components."
        }
        val unsigned = score.copy(player = playerDid, score = inferredScore, signatures = null)
        val jsonObj = OpenGamingJson.decodeFromString<JsonObject>(OpenGamingJson.encodeToString(unsigned))
        val (sig, cid) = createInlineSignature(
            record = jsonObj,
            issuerDid = issuerDid,
            playerDid = playerDid,
            signingKey = signingKey,
            issuedAt = unsigned.recordedAt,
            rkey = rkey,
            keyId = keyId
        )
        return unsigned.copy(signatures = listOf(sig)) to cid
    }

    fun createSignedMatchResult(
        match: MatchResultRecord,
        repositoryDid: String,
        issuerDid: String,
        signingKey: OpenGamingSigningKey,
        rkey: String? = null,
        keyId: String? = null
    ): Pair<MatchResultRecord, String> {
        require(match.participants.size >= 2) { "createSignedMatchResult requires at least 2 participants." }
        val unsigned = match.copy(signatures = null)
        val jsonObj = OpenGamingJson.decodeFromString<JsonObject>(OpenGamingJson.encodeToString(unsigned))
        val (sig, cid) = createInlineSignature(
            record = jsonObj,
            issuerDid = issuerDid,
            playerDid = repositoryDid,
            signingKey = signingKey,
            issuedAt = unsigned.playedAt,
            rkey = rkey,
            keyId = keyId
        )
        return unsigned.copy(signatures = listOf(sig)) to cid
    }

    fun coSignMatchResult(
        match: MatchResultRecord,
        repositoryDid: String,
        signerDid: String,
        signingKey: OpenGamingSigningKey,
        issuedAt: String = Instant.now().toString(),
        rkey: String? = null,
        keyId: String? = null
    ): Triple<MatchResultRecord, InlineSignature, String> {
        val jsonObj = OpenGamingJson.decodeFromString<JsonObject>(OpenGamingJson.encodeToString(match))
        val (sig, cid) = createInlineSignature(
            record = jsonObj,
            issuerDid = signerDid,
            playerDid = repositoryDid,
            signingKey = signingKey,
            issuedAt = issuedAt,
            rkey = rkey,
            keyId = keyId
        )
        val kept = match.signatures.orEmpty().filter {
            it.issuer != signerDid && it.key.substringBefore('#') != signerDid
        }
        return Triple(match.copy(signatures = kept + sig), sig, cid)
    }

    fun extractDidFromAtUri(atUri: String?): String? {
        if (atUri.isNullOrEmpty() || !atUri.startsWith("at://")) return null
        val host = atUri.removePrefix("at://").substringBefore('/')
        return host.takeIf { it.startsWith("did:") }
    }

    fun extractRkeyFromAtUri(atUri: String?): String? {
        if (atUri.isNullOrEmpty() || !atUri.startsWith("at://")) return null
        val parts = atUri.removePrefix("at://").split('/')
        if (parts.size < 3) return null
        return parts.drop(2).joinToString("/").takeIf { it.isNotEmpty() }
    }

    fun extractDidKeyFromDidDoc(didDoc: JsonObject, issuerDid: String, keyId: String): String? {
        val fragment = if ('#' in keyId) "#" + keyId.substringAfter('#') else OpenGamingConstants.ATTESTATION_KEY_FRAGMENT
        val bareFragment = fragment.removePrefix("#")

        val vmList = didDoc["verificationMethod"] as? JsonArray
        if (vmList != null) {
            for (el in vmList) {
                val vm = el as? JsonObject ?: continue
                val id = vm["id"]?.jsonPrimitive?.contentOrNull
                val pk = vm["publicKeyMultibase"]?.jsonPrimitive?.contentOrNull
                if ((id == "$issuerDid$fragment" || id == fragment) && !pk.isNullOrEmpty()) {
                    return if (pk.startsWith("did:key:")) pk else "did:key:$pk"
                }
            }
        }

        val plcMethods = didDoc["verificationMethods"] as? JsonObject
        val methodVal = plcMethods?.get(bareFragment)?.jsonPrimitive?.contentOrNull
        if (!methodVal.isNullOrEmpty()) {
            return if (methodVal.startsWith("did:key:")) methodVal else "did:key:$methodVal"
        }
        return null
    }

    suspend fun verifyRecordAttestation(
        record: JsonObject,
        playerDid: String,
        recordUri: String? = null,
        recordCid: String? = null,
        expectedIssuerDid: String? = null,
        trustedIssuerDids: List<String> = emptyList(),
        allowAnyValidIssuer: Boolean = false,
        allowCommunityLabelVerification: Boolean = false,
        publicDidKey: String? = null,
        revocations: List<RevocationWithOrigin> = emptyList(),
        activeLabels: List<AtprotoLabel> = emptyList(),
        trustedLabelerDids: List<String>? = null,
        resolveDidDoc: (suspend (String) -> JsonObject?)? = null
    ): VerificationResult {
        val recPlayer = record["player"]?.jsonPrimitive?.contentOrNull
        if (!recPlayer.isNullOrEmpty() && recPlayer != playerDid) {
            return VerificationResult.Failed(
                error = "player_mismatch",
                message = "Record player '$recPlayer' does not match repository DID '$playerDid'."
            )
        }

        if (activeLabels.isNotEmpty()) {
            val blocking = findInvalidatingLabels(activeLabels, recordUri, recordCid, playerDid, trustedLabelerDids)
            if (blocking.isNotEmpty()) {
                return VerificationResult.Failed(
                    error = "label_invalidated",
                    message = "Record invalidated by moderation label: " +
                        blocking.joinToString(", ") { "${it.labelValue} (by ${it.src})" }
                )
            }
        }

        val targetUri = record["achievement"]?.jsonPrimitive?.contentOrNull
            ?: record["leaderboard"]?.jsonPrimitive?.contentOrNull
            ?: record["challenge"]?.jsonPrimitive?.contentOrNull
            ?: record["game"]?.jsonPrimitive?.contentOrNull
        val definitionPublisherDid = expectedIssuerDid ?: extractDidFromAtUri(targetUri)

        val allowedIssuers = linkedSetOf<String>()
        if (!definitionPublisherDid.isNullOrEmpty()) allowedIssuers.add(definitionPublisherDid)
        trustedIssuerDids.filter { it.isNotEmpty() }.forEach { allowedIssuers.add(it) }

        val sigsArray = (record["signatures"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
        if (sigsArray.isEmpty()) {
            if (allowCommunityLabelVerification && activeLabels.isNotEmpty() && !recordUri.isNullOrEmpty()) {
                val pos = findVerificationLabels(activeLabels, recordUri, recordCid, trustedLabelerDids)
                if (pos.isNotEmpty()) {
                    val labelerDid = pos[0].src
                    val unsignedCid = computeAttestationCid(
                        record = record,
                        signatureMetadata = buildJsonObject {
                            put("\$type", "${OpenGamingConstants.Nsids.DEFS}#inlineSignature")
                            put("key", "label:$labelerDid")
                            put("issuer", labelerDid)
                        },
                        repositoryDid = playerDid
                    ).value

                    val rev = isRecordRevoked(
                        attestationCid = unsignedCid,
                        playerDid = playerDid,
                        record = record,
                        recordUri = recordUri,
                        issuerDid = definitionPublisherDid ?: labelerDid,
                        definitionPublisherDid = definitionPublisherDid,
                        revocations = revocations
                    )
                    if (rev != null) {
                        return VerificationResult.Failed("revoked", "Record revoked (${rev.reason}).", labelerDid, unsignedCid, rev)
                    }
                    return VerificationResult.Verified(
                        issuerDid = labelerDid,
                        keyId = "label:$labelerDid#${pos[0].labelValue}",
                        attestationCid = unsignedCid,
                        verificationMethod = "community-label"
                    )
                }
            }
            return VerificationResult.Failed("missing_signatures", "Record contains no inline attestation signatures.")
        }

        val sig = sigsArray.firstOrNull { s ->
            val k = s["key"]?.jsonPrimitive?.contentOrNull ?: return@firstOrNull false
            if (allowAnyValidIssuer || allowedIssuers.isEmpty()) return@firstOrNull true
            val kDid = k.substringBefore('#')
            val iss = s["issuer"]?.jsonPrimitive?.contentOrNull
            kDid in allowedIssuers || (iss != null && iss in allowedIssuers)
        } ?: return VerificationResult.Failed(
            error = "issuer_mismatch",
            message = "No signature found from trusted authority (${allowedIssuers.joinToString(", ")}).",
            issuerDid = definitionPublisherDid
        )

        val sigKey = sig["key"]!!.jsonPrimitive.content
        val issuerDid = if (sigKey.startsWith("did:key:")) {
            sig["issuer"]?.jsonPrimitive?.contentOrNull ?: definitionPublisherDid ?: sigKey.substringBefore('#')
        } else {
            sigKey.substringBefore('#')
        }

        if (!allowAnyValidIssuer && allowedIssuers.isNotEmpty() && issuerDid !in allowedIssuers) {
            return VerificationResult.Failed("issuer_mismatch", "Issuer '$issuerDid' is not trusted.", issuerDid)
        }

        val sigRkey = sig["rkey"]?.jsonPrimitive?.contentOrNull
        if (!sigRkey.isNullOrEmpty() && !recordUri.isNullOrEmpty()) {
            val actualRkey = extractRkeyFromAtUri(recordUri)
            if (!actualRkey.isNullOrEmpty() && actualRkey != sigRkey) {
                return VerificationResult.Failed(
                    error = "rkey_mismatch",
                    message = "Signature bound to rkey '$sigRkey', found '$actualRkey'.",
                    issuerDid = issuerDid
                )
            }
        }

        val computedCid = computeAttestationCid(record, sig, playerDid)
        val attestationCid = computedCid.value
        val claimedCid = sig["cid"]?.jsonPrimitive?.contentOrNull
        if (!claimedCid.isNullOrEmpty() && claimedCid != attestationCid) {
            return VerificationResult.Failed("cid_mismatch", "Claimed CID mismatch.", issuerDid, attestationCid)
        }

        val resolvedDidKey = publicDidKey ?: if (sigKey.startsWith("did:key:")) {
            if (!allowAnyValidIssuer && allowedIssuers.isNotEmpty() && allowedIssuers.none { it.startsWith("did:key:") }) {
                return VerificationResult.Failed("invalid_key_format", "Bare did:key not bound to DID document.", issuerDid, attestationCid)
            }
            sigKey
        } else {
            val doc = resolveDidDoc?.invoke(issuerDid)
                ?: return VerificationResult.Failed("did_resolution_failed", "Failed resolving DID '$issuerDid'.", issuerDid, attestationCid)
            extractDidKeyFromDidDoc(doc, issuerDid, sigKey)
                ?: return VerificationResult.Failed("missing_attestation_key", "Missing '$sigKey' in DID doc.", issuerDid, attestationCid)
        }

        val sigBytes = extractSignatureBytes(sig)
            ?: return VerificationResult.Failed("invalid_signature", "Malformed signature field.", issuerDid, attestationCid)

        if (!OpenGamingSigningKey.verifyDidKeySignature(resolvedDidKey, computedCid.bytes, sigBytes)) {
            return VerificationResult.Failed("invalid_signature", "Cryptographic signature verification failed.", issuerDid, attestationCid)
        }

        val matchedRev = isRecordRevoked(attestationCid, playerDid, record, recordUri, issuerDid, definitionPublisherDid, revocations)
        if (matchedRev != null) {
            return VerificationResult.Failed("revoked", "Attestation revoked (${matchedRev.reason}).", issuerDid, attestationCid, matchedRev)
        }

        return VerificationResult.Verified(issuerDid = issuerDid, keyId = sigKey, attestationCid = attestationCid)
    }

    suspend fun verifyMatchResult(
        record: JsonObject,
        repositoryDid: String,
        recordUri: String? = null,
        recordCid: String? = null,
        expectedIssuerDid: String? = null,
        trustedIssuerDids: List<String> = emptyList(),
        allowParticipantCoSigning: Boolean = true,
        participantDidKeys: Map<String, String>? = null,
        revocations: List<RevocationWithOrigin> = emptyList(),
        activeLabels: List<AtprotoLabel> = emptyList(),
        trustedLabelerDids: List<String>? = null,
        resolveDidDoc: (suspend (String) -> JsonObject?)? = null
    ): VerificationResult {
        val publisherCheck = verifyRecordAttestation(
            record = record,
            playerDid = repositoryDid,
            recordUri = recordUri,
            recordCid = recordCid,
            expectedIssuerDid = expectedIssuerDid,
            trustedIssuerDids = trustedIssuerDids,
            revocations = revocations,
            activeLabels = activeLabels,
            trustedLabelerDids = trustedLabelerDids,
            resolveDidDoc = resolveDidDoc
        )
        if (publisherCheck is VerificationResult.Verified ||
            (publisherCheck is VerificationResult.Failed && (publisherCheck.error == "revoked" || publisherCheck.error == "label_invalidated"))
        ) {
            return publisherCheck
        }

        if (!allowParticipantCoSigning) return publisherCheck

        val participantDids = (record["participants"] as? JsonArray)
            ?.mapNotNull { (it as? JsonObject)?.get("did")?.jsonPrimitive?.contentOrNull }
            ?.filter { it.startsWith("did:") }
            ?.distinct()
            .orEmpty()

        if (participantDids.size < 2 || repositoryDid !in participantDids) return publisherCheck

        val sigsArray = (record["signatures"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
        if (sigsArray.size < participantDids.size) {
            return VerificationResult.Failed(
                error = "missing_participant_signatures",
                message = "Peer-to-peer match verification requires signatures from all ${participantDids.size} participant DIDs."
            )
        }

        val definitionPublisherDid = expectedIssuerDid ?: extractDidFromAtUri(
            record["leaderboard"]?.jsonPrimitive?.contentOrNull
                ?: record["challenge"]?.jsonPrimitive?.contentOrNull
                ?: record["game"]?.jsonPrimitive?.contentOrNull
        )

        var primaryCid = ""
        var primaryKeyId = ""

        for (participantDid in participantDids) {
            val sig = sigsArray.firstOrNull { s ->
                val k = s["key"]?.jsonPrimitive?.contentOrNull ?: return@firstOrNull false
                k.substringBefore('#') == participantDid || s["issuer"]?.jsonPrimitive?.contentOrNull == participantDid
            } ?: return VerificationResult.Failed(
                error = "missing_participant_signatures",
                message = "Missing co-signature from match participant '$participantDid'."
            )

            val sigKey = sig["key"]!!.jsonPrimitive.content
            val sigRkey = sig["rkey"]?.jsonPrimitive?.contentOrNull
            if (!sigRkey.isNullOrEmpty() && !recordUri.isNullOrEmpty()) {
                val actualRkey = extractRkeyFromAtUri(recordUri)
                if (!actualRkey.isNullOrEmpty() && actualRkey != sigRkey) {
                    return VerificationResult.Failed("rkey_mismatch", "Participant signature rkey mismatch.", participantDid)
                }
            }

            val computedCid = computeAttestationCid(record, sig, repositoryDid)
            val cidStr = computedCid.value
            val claimedCid = sig["cid"]?.jsonPrimitive?.contentOrNull
            if (!claimedCid.isNullOrEmpty() && claimedCid != cidStr) {
                return VerificationResult.Failed("cid_mismatch", "Participant CID mismatch.", participantDid, cidStr)
            }

            val didKey = participantDidKeys?.get(participantDid) ?: run {
                val doc = resolveDidDoc?.invoke(participantDid)
                    ?: return VerificationResult.Failed("did_resolution_failed", "Failed resolving '$participantDid'.", participantDid, cidStr)
                extractDidKeyFromDidDoc(doc, participantDid, sigKey)
                    ?: return VerificationResult.Failed("missing_attestation_key", "Missing '$sigKey' for '$participantDid'.", participantDid, cidStr)
            }

            val sigBytes = extractSignatureBytes(sig)
                ?: return VerificationResult.Failed("invalid_signature", "Malformed participant signature.", participantDid, cidStr)

            if (!OpenGamingSigningKey.verifyDidKeySignature(didKey, computedCid.bytes, sigBytes)) {
                return VerificationResult.Failed("invalid_signature", "Invalid co-signature from '$participantDid'.", participantDid, cidStr)
            }

            val rev = isRecordRevoked(cidStr, participantDid, record, recordUri, definitionPublisherDid ?: participantDid, definitionPublisherDid, revocations)
            if (rev != null) {
                return VerificationResult.Failed("revoked", "Match revoked (${rev.reason}).", participantDid, cidStr, rev)
            }

            if (participantDid == repositoryDid || primaryCid.isEmpty()) {
                primaryCid = cidStr
                primaryKeyId = sigKey
            }
        }

        return VerificationResult.Verified(
            issuerDid = repositoryDid,
            keyId = primaryKeyId,
            attestationCid = primaryCid,
            verificationMethod = "multi-participant",
            coSigners = participantDids
        )
    }

    fun createRevocationRecord(
        scope: String,
        playerDid: String,
        subjectUri: String,
        reason: String,
        attestationCid: String? = null,
        recordUri: String? = null,
        before: String? = null,
        note: String? = null,
        revokedAt: String = Instant.now().toString()
    ): Pair<String, RevocationRecord> {
        require(playerDid.startsWith("did:")) { "Invalid player DID: '$playerDid'." }
        require(subjectUri.startsWith("at://")) { "Invalid subject AT-URI: '$subjectUri'." }
        if (scope == "attestation") {
            require(!attestationCid.isNullOrBlank()) { "attestationCid is required when scope is 'attestation'." }
        }

        val record = RevocationRecord(
            scope = scope,
            attestationCid = attestationCid,
            player = playerDid,
            subject = subjectUri,
            recordUri = recordUri,
            before = before,
            reason = reason,
            note = note,
            revokedAt = revokedAt
        )

        val rkey = if (scope == "attestation") {
            attestationCid!!.trim()
        } else {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest("$scope:$playerDid:$subjectUri".encodeToByteArray())
            "rev-$scope-${bytesToHex(digest).take(24)}"
        }
        return rkey to record
    }

    fun isRecordRevoked(
        attestationCid: String,
        playerDid: String,
        record: JsonObject,
        recordUri: String?,
        issuerDid: String,
        definitionPublisherDid: String?,
        revocations: List<RevocationWithOrigin>
    ): RevocationRecord? {
        val achUri = record["achievement"]?.jsonPrimitive?.contentOrNull
        val lbUri = record["leaderboard"]?.jsonPrimitive?.contentOrNull
        val chUri = record["challenge"]?.jsonPrimitive?.contentOrNull
        val gameUri = record["game"]?.jsonPrimitive?.contentOrNull
        val tsStr = record["unlockedAt"]?.jsonPrimitive?.contentOrNull
            ?: record["recordedAt"]?.jsonPrimitive?.contentOrNull
            ?: record["playedAt"]?.jsonPrimitive?.contentOrNull
            ?: record["updatedAt"]?.jsonPrimitive?.contentOrNull
        val recordTime = tsStr?.let { runCatching { Instant.parse(it) }.getOrNull() }

        val authorized = linkedSetOf(issuerDid)
        if (!definitionPublisherDid.isNullOrEmpty()) authorized.add(definitionPublisherDid)
        extractDidFromAtUri(achUri ?: lbUri ?: chUri ?: gameUri)?.let { authorized.add(it) }

        for (entry in revocations) {
            val rev = entry.value
            if (entry.publisherDid !in authorized) continue
            val subjectOwner = extractDidFromAtUri(rev.subject)
            if (subjectOwner != null && subjectOwner !in authorized) continue
            if (rev.player != playerDid) continue

            if (rev.scope == "attestation") {
                if (!rev.attestationCid.isNullOrEmpty() && rev.attestationCid == attestationCid) return rev
                if (rev.attestationCid.isNullOrEmpty() && !recordUri.isNullOrEmpty() && rev.recordUri == recordUri) return rev
                continue
            }

            if (!rev.before.isNullOrEmpty() && recordTime != null) {
                val cutoff = runCatching { Instant.parse(rev.before) }.getOrNull()
                if (cutoff != null && recordTime.isAfter(cutoff)) continue
            }

            if (rev.scope == "achievement" && achUri != null && rev.subject == achUri) return rev
            if (rev.scope == "leaderboard" && lbUri != null && rev.subject == lbUri) return rev
            if (rev.scope == "challenge" && chUri != null && rev.subject == chUri) return rev
            if (rev.scope == "match" && record["\$type"]?.jsonPrimitive?.contentOrNull == OpenGamingConstants.Nsids.MATCH_RESULT) {
                if (rev.subject == gameUri || rev.subject == lbUri || rev.subject == chUri) return rev
            }
            if (rev.scope == "game" && (rev.subject == gameUri || (gameUri == null && rev.subject.contains("/games.atmosphere.define/")))) {
                return rev
            }
        }
        return null
    }

    fun resolveActiveLabels(events: List<AtprotoLabel>, now: Instant = Instant.now()): List<AtprotoLabel> {
        val sorted = events.sortedBy { runCatching { Instant.parse(it.cts) }.getOrDefault(Instant.EPOCH) }
        val active = linkedMapOf<String, AtprotoLabel>()
        for (ev in sorted) {
            val key = "${ev.src}|${ev.uri}|${ev.cid.orEmpty()}|${ev.labelValue}"
            if (ev.neg == true) active.remove(key) else active[key] = ev
        }
        return active.values.filter { lbl ->
            if (lbl.exp.isNullOrEmpty()) true
            else runCatching { Instant.parse(lbl.exp).isAfter(now) }.getOrDefault(true)
        }
    }

    fun findInvalidatingLabels(
        activeLabels: List<AtprotoLabel>,
        recordUri: String?,
        recordCid: String?,
        playerDid: String?,
        trustedLabelerDids: List<String>? = null
    ): List<AtprotoLabel> {
        val trusted = trustedLabelerDids?.toSet()
        val invalidSet = OpenGamingConstants.DEFAULT_INVALIDATING_LABELS.toSet()
        return activeLabels.filter { lbl ->
            if (lbl.neg == true) return@filter false
            if (trusted != null && lbl.src !in trusted) return@filter false
            if (lbl.labelValue !in invalidSet) return@filter false
            if (!recordUri.isNullOrEmpty() && lbl.uri == recordUri) {
                if (!lbl.cid.isNullOrEmpty() && !recordCid.isNullOrEmpty() && lbl.cid != recordCid) return@filter false
                return@filter true
            }
            !playerDid.isNullOrEmpty() && lbl.uri == playerDid
        }
    }

    fun findVerificationLabels(
        activeLabels: List<AtprotoLabel>,
        recordUri: String?,
        recordCid: String?,
        trustedLabelerDids: List<String>? = null
    ): List<AtprotoLabel> {
        if (recordUri.isNullOrEmpty()) return emptyList()
        val trusted = trustedLabelerDids?.toSet()
        val verifySet = OpenGamingConstants.DEFAULT_VERIFICATION_LABELS.toSet()
        return activeLabels.filter { lbl ->
            if (lbl.neg == true) return@filter false
            if (trusted != null && lbl.src !in trusted) return@filter false
            if (lbl.labelValue !in verifySet) return@filter false
            if (lbl.uri != recordUri) return@filter false
            if (!lbl.cid.isNullOrEmpty() && !recordCid.isNullOrEmpty() && lbl.cid != recordCid) return@filter false
            true
        }
    }

    private fun extractSignatureBytes(sigMap: JsonObject): ByteArray? {
        val sigObj = sigMap["signature"] as? JsonObject ?: return null
        val b64 = sigObj["\$bytes"]?.jsonPrimitive?.contentOrNull ?: return null
        return runCatching { CidV1.fromBase64Flexible(b64) }.getOrNull()
    }

    internal fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }
}
