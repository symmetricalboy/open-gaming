package games.opengaming.sdk

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

@OptIn(ExperimentalSerializationApi::class)
val OpenGamingJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}

@Serializable
data class BytesWrapper(
    @SerialName("\$bytes") val bytes: String
)

@Serializable
data class CidLinkWrapper(
    @SerialName("\$link") val link: String
)

@Serializable
data class BlobRef(
    @SerialName("\$type") val type: String = "blob",
    val ref: CidLinkWrapper,
    val mimeType: String,
    val size: Long
)

@Serializable
data class InlineSignature(
    @SerialName("\$type") val type: String = "${OpenGamingConstants.Nsids.DEFS}#inlineSignature",
    val key: String,
    val issuer: String? = null,
    val issuedAt: String? = null,
    val rkey: String? = null,
    val cid: String? = null,
    val signature: BytesWrapper
)

@Serializable
data class ScoreFormat(
    val kind: String = "numeric",
    val decimalPlaces: Int? = null,
    val timeUnit: String? = null,
    val currencyCode: String? = null,
    val unitSingular: String? = null,
    val unitPlural: String? = null,
    val signedPrefix: Boolean? = null
)

@Serializable
data class OptionItem(
    val id: String,
    val name: String
)

@Serializable
data class Participant(
    val did: String? = null,
    val name: String? = null,
    val role: String? = null,
    val team: String? = null
)

@Serializable
data class Translation(
    val title: String? = null,
    val name: String? = null,
    val description: String? = null,
    val requirement: String? = null,
    val tooltip: String? = null
)

@Serializable
data class TimeRange(
    val from: String,
    val until: String,
    val recurrence: String? = null,
    val label: String? = null
)

@Serializable
data class ScoreComponentDef(
    @SerialName("\$type") val type: String,
    val name: String,
    val sortOrder: String? = null,
    val precision: Int? = null,
    val timeUnit: String? = null,
    val minimum: Long? = null,
    val maximum: Long? = null,
    val unitSingular: String? = null,
    val unitPlural: String? = null,
    val values: List<OptionItem>? = null,
    val maxGraphemes: Int? = null
)

@Serializable
data class ScoreComponentVal(
    @SerialName("\$type") val type: String,
    val value: JsonPrimitive
) {
    companion object {
        fun points(v: Long) = ScoreComponentVal(
            type = "${OpenGamingConstants.Nsids.LEADERBOARD_SCORE}#points",
            value = JsonPrimitive(v)
        )

        fun percentage(scaled: Long) = ScoreComponentVal(
            type = "${OpenGamingConstants.Nsids.LEADERBOARD_SCORE}#percentage",
            value = JsonPrimitive(scaled)
        )

        fun time(duration: Long) = ScoreComponentVal(
            type = "${OpenGamingConstants.Nsids.LEADERBOARD_SCORE}#time",
            value = JsonPrimitive(duration)
        )

        fun enumOption(id: String) = ScoreComponentVal(
            type = "${OpenGamingConstants.Nsids.LEADERBOARD_SCORE}#enum",
            value = JsonPrimitive(id)
        )

        fun text(str: String) = ScoreComponentVal(
            type = "${OpenGamingConstants.Nsids.LEADERBOARD_SCORE}#text",
            value = JsonPrimitive(str)
        )
    }
}

@Serializable
data class DimensionDef(
    val name: String,
    val values: List<OptionItem>? = null,
    val required: Boolean? = null,
    val allowCustomValues: Boolean? = null,
    val defaultValue: String? = null
)

@Serializable
data class AchievementDefinitionRecord(
    @SerialName("\$type") val type: String = OpenGamingConstants.Nsids.ACHIEVEMENT_DEFINITION,
    val game: String,
    val title: String? = null,
    val description: String? = null,
    val requirement: String? = null,
    val tooltip: String? = null,
    val translations: Map<String, Translation>? = null,
    val icon: BlobRef? = null,
    val iconAlt: String? = null,
    val lockedIcon: BlobRef? = null,
    val tier: String? = null,
    val hidden: Boolean? = null,
    val hiddenSpace: String? = null,
    val completionOptional: Boolean? = null,
    val repeatable: Boolean? = null,
    val timelocked: List<TimeRange>? = null,
    val retired: Boolean? = null,
    val stepsNeeded: Int? = null,
    val group: String? = null,
    val listOrder: Int? = null,
    val badge: String? = null,
    val trustedIssuers: List<String>? = null,
    val createdAt: String,
    val updatedAt: String? = null
)

@Serializable
data class AchievementUnlockRecord(
    @SerialName("\$type") val type: String = OpenGamingConstants.Nsids.ACHIEVEMENT_UNLOCK,
    val achievement: String,
    val definitionCid: String? = null,
    val game: String? = null,
    val player: String? = null,
    val unlockedAt: String,
    val stepsCompleted: Int? = null,
    val participants: List<Participant>? = null,
    val runId: String? = null,
    val details: JsonObject? = null,
    val media: BlobRef? = null,
    val mediaAlt: String? = null,
    val note: String? = null,
    val signatures: List<InlineSignature>? = null
)

@Serializable
data class AchievementProgressRecord(
    @SerialName("\$type") val type: String = OpenGamingConstants.Nsids.ACHIEVEMENT_PROGRESS,
    val achievement: String,
    val definitionCid: String? = null,
    val game: String? = null,
    val currentSteps: Int,
    val stepsNeeded: Int? = null,
    val updatedAt: String,
    val signatures: List<InlineSignature>? = null
)

@Serializable
data class LeaderboardDefinitionRecord(
    @SerialName("\$type") val type: String = OpenGamingConstants.Nsids.LEADERBOARD_DEFINITION,
    val game: String,
    val name: String,
    val description: String? = null,
    val translations: Map<String, Translation>? = null,
    val icon: BlobRef? = null,
    val iconAlt: String? = null,
    val sortOrder: String? = null,
    val rankingMode: String? = null,
    val scoreFormat: ScoreFormat? = null,
    val components: Map<String, ScoreComponentDef>? = null,
    val componentOrder: List<String>? = null,
    val defaultComponent: String? = null,
    val dimensions: Map<String, DimensionDef>? = null,
    val dimensionOrder: List<String>? = null,
    val rankedVersions: List<String>? = null,
    val trustedIssuers: List<String>? = null,
    val timeframes: List<String> = listOf("allTime"),
    val startsAt: String? = null,
    val endsAt: String? = null,
    val recordPolicy: String = "overwriteBest",
    val scoreMin: Long? = null,
    val scoreMax: Long? = null,
    val listOrder: Int? = null,
    val createdAt: String = ""
)

@Serializable
data class LeaderboardScoreRecord(
    @SerialName("\$type") val type: String = OpenGamingConstants.Nsids.LEADERBOARD_SCORE,
    val leaderboard: String,
    val definitionCid: String? = null,
    val game: String? = null,
    val player: String? = null,
    val score: Long? = null,
    val displayScore: String? = null,
    val components: Map<String, ScoreComponentVal>? = null,
    val dimensions: Map<String, String>? = null,
    val seed: String? = null,
    val participants: List<Participant>? = null,
    val runId: String? = null,
    val details: JsonObject? = null,
    val version: String? = null,
    val replay: BlobRef? = null,
    val tag: String? = null,
    val recordedAt: String,
    val signatures: List<InlineSignature>? = null
)

@Serializable
data class ChallengeDefinitionRecord(
    @SerialName("\$type") val type: String = OpenGamingConstants.Nsids.CHALLENGE_DEFINITION,
    val game: String,
    val title: String,
    val description: String? = null,
    val translations: Map<String, Translation>? = null,
    val icon: BlobRef? = null,
    val cadence: String,
    val seed: String? = null,
    val targetSteps: Int? = null,
    val leaderboard: String? = null,
    val rewardAchievement: String? = null,
    val dimensions: Map<String, String>? = null,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val trustedIssuers: List<String>? = null,
    val createdAt: String
)

@Serializable
data class MatchParticipant(
    val did: String? = null,
    val name: String? = null,
    val team: String? = null,
    val role: String? = null,
    val character: String? = null,
    val outcome: String,
    val placement: Int? = null,
    val score: Long? = null,
    val scoreText: String? = null,
    val ratingBefore: Long? = null,
    val ratingAfter: Long? = null,
    val ratingDeviation: Long? = null
)

@Serializable
data class MatchResultRecord(
    @SerialName("\$type") val type: String = OpenGamingConstants.Nsids.MATCH_RESULT,
    val game: String,
    val matchId: String? = null,
    val leaderboard: String? = null,
    val challenge: String? = null,
    val mode: String? = null,
    val bestOf: Int? = null,
    val durationMs: Long? = null,
    val participants: List<MatchParticipant>,
    val dimensions: Map<String, String>? = null,
    val details: JsonObject? = null,
    val version: String? = null,
    val replay: BlobRef? = null,
    val playedAt: String,
    val signatures: List<InlineSignature>? = null
)

@Serializable
data class RevocationRecord(
    @SerialName("\$type") val type: String = OpenGamingConstants.Nsids.REVOCATION,
    val scope: String,
    val attestationCid: String? = null,
    val player: String,
    val subject: String,
    val recordUri: String? = null,
    val before: String? = null,
    val reason: String,
    val note: String? = null,
    val revokedAt: String
)

data class RevocationWithOrigin(
    val uri: String? = null,
    val publisherDid: String,
    val value: RevocationRecord
)

@Serializable
data class AtprotoLabel(
    val src: String,
    val uri: String,
    val cid: String? = null,
    val valToken: String = "",
    @SerialName("val") val rawVal: String = "",
    val neg: Boolean? = null,
    val cts: String,
    val exp: String? = null
) {
    val labelValue: String get() = rawVal.ifEmpty { valToken }
}

sealed interface VerificationResult {
    val verified: Boolean

    data class Verified(
        val issuerDid: String,
        val keyId: String,
        val attestationCid: String,
        val verificationMethod: String = "attestation",
        val coSigners: List<String>? = null
    ) : VerificationResult {
        override val verified: Boolean get() = true
    }

    data class Failed(
        val error: String,
        val message: String,
        val issuerDid: String? = null,
        val attestationCid: String? = null,
        val revocation: RevocationRecord? = null
    ) : VerificationResult {
        override val verified: Boolean get() = false
    }
}

@Serializable
data class TierCounts(
    val platinum: Int = 0,
    val gold: Int = 0,
    val silver: Int = 0,
    val bronze: Int = 0,
    val custom: Int? = null,
    val untiered: Int = 0
)

@Serializable
data class GameAchievementSummary(
    val game: String,
    val unlockedCount: Int,
    val totalAchievements: Int,
    val bonusUnlockedCount: Int? = null,
    val completionPercent: Int,
    val completed: Boolean,
    val latestUnlockAt: String? = null
)

@Serializable
data class ActorProfileSummary(
    val did: String,
    val handle: String? = null,
    val gamesPlayed: Int,
    val completedGames: Int,
    val totalUnlocks: Int,
    val tiers: TierCounts,
    val games: List<GameAchievementSummary>
)

@Serializable
data class ScoreEntryView(
    val rank: Int,
    val player: String,
    val handle: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
    val uri: String,
    val attestationCid: String? = null,
    val issuer: String? = null,
    val score: Long,
    val displayScore: String? = null,
    val components: Map<String, ScoreComponentVal>? = null,
    val dimensions: Map<String, String>? = null,
    val seed: String? = null,
    val participants: List<Participant>? = null,
    val runId: String? = null,
    val version: String? = null,
    val hasReplay: Boolean? = null,
    val replayCid: String? = null,
    val tag: String? = null,
    val recordedAt: String,
    val verified: Boolean,
    val obsolete: Boolean? = null
)

@Serializable
data class LeaderboardGetScoresResponse(
    val leaderboard: String,
    val sortedBy: String? = null,
    val rankingMode: String? = null,
    val entries: List<ScoreEntryView>,
    val viewerEntry: ScoreEntryView? = null,
    val cursor: String? = null
)

@Serializable
data class ActorGameLibraryResponse(
    val did: String,
    val handle: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
    val totalGames: Int,
    val shelves: Map<String, Int>,
    val items: List<JsonElement>
)
