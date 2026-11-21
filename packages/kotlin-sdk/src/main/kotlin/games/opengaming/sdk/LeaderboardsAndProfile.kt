package games.opengaming.sdk

import java.security.MessageDigest
import java.text.NumberFormat
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters
import java.util.Currency
import java.util.Locale
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.pow

data class ScoreSubmissionDecision(
    val validBounds: Boolean,
    val shouldWrite: Boolean,
    val writeMode: String, // "putRecord" | "createRecord" | "none"
    val recommendedRkey: String? = null,
    val beatenTimeframes: List<String> = emptyList(),
    val reason: String? = null
)

object OpenGamingLeaderboards {
    private val SAFE_SLUG_REGEX = Regex("[^a-zA-Z0-9._~-]")
    private val RESERVED_KEYS = setOf(".", "..", "\$keyFormat", "\$valueType")

    fun getUnlockRkey(
        achievementDefinitionUri: String,
        repeatable: Boolean = false,
        uniqueToken: String? = null
    ): String {
        val suffix = if (repeatable && !uniqueToken.isNullOrEmpty()) ":$uniqueToken" else ""
        val hash = sha256Hex(achievementDefinitionUri + suffix).take(20)
        val slug = achievementDefinitionUri.substringAfterLast('/').ifEmpty { "ach" }
        val safeSlug = SAFE_SLUG_REGEX.replace(slug, "-").take(32)
        return "$safeSlug-$hash"
    }

    fun getOverwriteBestScoreRkey(
        leaderboardDefinitionUri: String,
        dimensions: Map<String, String>? = null,
        seed: String? = null
    ): String {
        val parts = mutableListOf<String>()
        if (!dimensions.isNullOrEmpty()) {
            for (k in dimensions.keys.filter { it !in RESERVED_KEYS }.sorted()) {
                parts.add("d:$k=${dimensions[k]}")
            }
        }
        if (!seed.isNullOrEmpty()) {
            parts.add("s:$seed")
        }
        val suffix = parts.joinToString("|")
        val input = if (suffix.isNotEmpty()) "$leaderboardDefinitionUri|$suffix" else leaderboardDefinitionUri
        val hash = sha256Hex(input).take(20)
        val slug = leaderboardDefinitionUri.substringAfterLast('/').ifEmpty { "lb" }
        val safeSlug = SAFE_SLUG_REGEX.replace(slug, "-").take(32)
        return "$safeSlug-best-$hash"
    }

    fun isBetterScore(candidate: Long, existing: Long, sortOrder: String = "largerIsBetter"): Boolean =
        if (sortOrder == "smallerIsBetter") candidate < existing else candidate > existing

    fun formatScore(
        rawScore: Long,
        format: ScoreFormat = ScoreFormat(),
        locale: Locale = Locale.US
    ): String {
        if (format.kind == "time") {
            val totalMs = if (format.timeUnit == "seconds") rawScore * 1000L else rawScore
            val sign = when {
                totalMs < 0 -> "-"
                format.signedPrefix == true && totalMs > 0 -> "+"
                else -> ""
            }
            val absMs = abs(totalMs)
            val hours = absMs / 3_600_000L
            val minutes = (absMs % 3_600_000L) / 60_000L
            val seconds = (absMs % 60_000L) / 1000L
            val hundredths = (absMs % 1000L) / 10L

            val secPadded = "%02d".format(Locale.ROOT, seconds)
            val frac = if (format.timeUnit == "seconds") "" else ".%02d".format(Locale.ROOT, hundredths)
            return if (hours > 0) {
                "$sign$hours:${"%02d".format(Locale.ROOT, minutes)}:$secPadded$frac"
            } else {
                "$sign$minutes:$secPadded$frac"
            }
        }

        val decimals = (format.decimalPlaces ?: 0).coerceIn(0, 6)
        val scaled = rawScore.toDouble() / 10.0.pow(decimals.toDouble())

        if (format.kind == "currency") {
            val nf = NumberFormat.getCurrencyInstance(locale)
            runCatching { nf.currency = Currency.getInstance(format.currencyCode ?: "USD") }
            val curDec = if (decimals == 6) 2 else decimals
            nf.minimumFractionDigits = curDec
            nf.maximumFractionDigits = curDec
            return nf.format(scaled)
        }

        val nf = NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = decimals
            maximumFractionDigits = decimals
        }
        val base = nf.format(scaled)
        val withSign = if (format.signedPrefix == true && scaled > 0 && !base.startsWith("+")) "+$base" else base

        return when {
            abs(scaled) == 1.0 && !format.unitSingular.isNullOrEmpty() -> "$withSign ${format.unitSingular}"
            !format.unitPlural.isNullOrEmpty() -> "$withSign ${format.unitPlural}"
            !format.unitSingular.isNullOrEmpty() -> "$withSign ${format.unitSingular}"
            else -> withSign
        }
    }

    fun evaluateScoreSubmission(
        leaderboardUri: String,
        score: Long,
        definition: LeaderboardDefinitionRecord,
        existingPlayerScores: List<LeaderboardScoreRecord> = emptyList(),
        dimensions: Map<String, String>? = null,
        seed: String? = null,
        version: String? = null,
        now: Instant = Instant.now()
    ): ScoreSubmissionDecision {
        if (!definition.startsAt.isNullOrEmpty()) {
            val s = runCatching { Instant.parse(definition.startsAt) }.getOrNull()
            if (s != null && now.isBefore(s)) {
                return ScoreSubmissionDecision(false, false, "none", reason = "Outside startsAt window.")
            }
        }
        if (!definition.endsAt.isNullOrEmpty()) {
            val e = runCatching { Instant.parse(definition.endsAt) }.getOrNull()
            if (e != null && now.isAfter(e)) {
                return ScoreSubmissionDecision(false, false, "none", reason = "Outside endsAt window.")
            }
        }
        if (!definition.rankedVersions.isNullOrEmpty() && (version == null || version !in definition.rankedVersions)) {
            return ScoreSubmissionDecision(false, false, "none", reason = "Version '$version' not in rankedVersions.")
        }
        if (definition.scoreMin != null && score < definition.scoreMin) {
            return ScoreSubmissionDecision(false, false, "none", reason = "Score below scoreMin.")
        }
        if (definition.scoreMax != null && score > definition.scoreMax) {
            return ScoreSubmissionDecision(false, false, "none", reason = "Score exceeds scoreMax.")
        }

        val sortOrder = definition.sortOrder ?: "largerIsBetter"
        val matching = existingPlayerScores.filter { s ->
            s.leaderboard == leaderboardUri &&
                s.score != null &&
                (dimensions == null || dimensions.all { (k, v) -> s.dimensions?.get(k) == v }) &&
                (seed == null || s.seed == seed)
        }

        val timeframes = definition.timeframes.ifEmpty { listOf("allTime") }
        val beaten = timeframes.filter { tf ->
            val start = getTimeframeStart(tf, now)
            val inWindow = matching.filter {
                val ts = runCatching { Instant.parse(it.recordedAt) }.getOrDefault(Instant.EPOCH)
                !ts.isBefore(start)
            }
            if (inWindow.isEmpty()) true
            else {
                val best = if (sortOrder == "smallerIsBetter") {
                    inWindow.minOf { it.score!! }
                } else {
                    inWindow.maxOf { it.score!! }
                }
                isBetterScore(score, best, sortOrder)
            }
        }

        return when {
            definition.recordPolicy == "everyRun" || definition.rankingMode == "latest" ->
                ScoreSubmissionDecision(true, true, "createRecord", beatenTimeframes = beaten)
            definition.recordPolicy == "overwriteBest" || definition.recordPolicy == "bestOnly" -> {
                val ok = matching.isEmpty() || "allTime" in beaten
                ScoreSubmissionDecision(
                    validBounds = true,
                    shouldWrite = ok,
                    writeMode = if (ok) "putRecord" else "none",
                    recommendedRkey = if (ok) getOverwriteBestScoreRkey(leaderboardUri, dimensions, seed) else null,
                    beatenTimeframes = beaten
                )
            }
            definition.recordPolicy == "personalBests" -> {
                val ok = matching.isEmpty() || "allTime" in beaten
                ScoreSubmissionDecision(true, ok, if (ok) "createRecord" else "none", beatenTimeframes = beaten)
            }
            else -> {
                val ok = beaten.isNotEmpty()
                ScoreSubmissionDecision(true, ok, if (ok) "createRecord" else "none", beatenTimeframes = beaten)
            }
        }
    }

    fun serializeDimensionsFilter(dimensions: Map<String, String>?): String {
        if (dimensions.isNullOrEmpty()) return ""
        return dimensions.entries
            .filter { it.key !in RESERVED_KEYS && it.value.isNotEmpty() }
            .joinToString(",") { "${it.key}=${it.value}" }
    }

    private fun getTimeframeStart(timeframe: String, now: Instant): Instant {
        val zdt = ZonedDateTime.ofInstant(now, ZoneOffset.UTC)
        return when (timeframe) {
            "daily" -> zdt.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant()
            "monthly" -> zdt.toLocalDate().withDayOfMonth(1).atStartOfDay(ZoneOffset.UTC).toInstant()
            "weekly" -> zdt.toLocalDate().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(ZoneOffset.UTC).toInstant()
            else -> Instant.MIN
        }
    }

    private fun sha256Hex(input: String): String =
        OpenGamingAttestation.bytesToHex(MessageDigest.getInstance("SHA-256").digest(input.encodeToByteArray()))
}

object OpenGamingProfile {
    fun resolveTranslation(def: AchievementDefinitionRecord, locale: String?): Translation {
        val base = Translation(
            title = def.title,
            description = def.description,
            requirement = def.requirement,
            tooltip = def.tooltip
        )
        if (locale.isNullOrBlank() || def.translations.isNullOrEmpty()) return base
        val req = locale.trim().lowercase(Locale.ROOT)
        val exact = def.translations.entries.firstOrNull { it.key.lowercase(Locale.ROOT) == req }?.value
        val matched = exact ?: run {
            val lang = req.substringBefore('-')
            def.translations.entries.firstOrNull { it.key.lowercase(Locale.ROOT) == lang }?.value
        } ?: return base

        return Translation(
            title = matched.title ?: base.title,
            name = matched.name ?: base.name,
            description = matched.description ?: base.description,
            requirement = matched.requirement ?: base.requirement,
            tooltip = matched.tooltip ?: base.tooltip
        )
    }

    fun calculateGameCompletion(
        gameUri: String,
        verifiedUnlocks: List<AchievementUnlockRecord>,
        definitions: List<Pair<String, AchievementDefinitionRecord>>
    ): GameAchievementSummary {
        val gameDefs = definitions.filter { it.second.game == gameUri }
        val baseDefs = gameDefs.filter { it.second.completionOptional != true }
        val bonusMap = gameDefs.filter { it.second.completionOptional == true }.toMap()
        val baseUris = baseDefs.map { it.first }.toSet()
        val allUris = gameDefs.map { it.first }.toSet()

        val unlockedBase = linkedSetOf<String>()
        val unlockedBonus = linkedSetOf<String>()
        var extraBonus = 0
        var latestUnlockAt: String? = null
        var latestInstant = Instant.MIN

        for (u in verifiedUnlocks) {
            if (u.achievement !in allUris) continue
            val ts = runCatching { Instant.parse(u.unlockedAt) }.getOrNull()
            if (ts != null && ts.isAfter(latestInstant)) {
                latestInstant = ts
                latestUnlockAt = u.unlockedAt
            }
            when {
                u.achievement in baseUris -> unlockedBase.add(u.achievement)
                u.achievement in bonusMap -> {
                    val bDef = bonusMap.getValue(u.achievement)
                    if (u.achievement in unlockedBonus && bDef.repeatable == true) extraBonus++
                    else unlockedBonus.add(u.achievement)
                }
            }
        }

        val total = baseDefs.size
        val unlocked = unlockedBase.size
        val bonusCount = unlockedBonus.size + extraBonus
        val completed = total > 0 && unlocked == total
        val pct = if (total == 0) 0 else min(100, (unlocked * 100) / total)

        return GameAchievementSummary(
            game = gameUri,
            unlockedCount = unlocked,
            totalAchievements = total,
            bonusUnlockedCount = bonusCount.takeIf { it > 0 },
            completionPercent = pct,
            completed = completed,
            latestUnlockAt = latestUnlockAt
        )
    }

    fun summarizeActorProfile(
        playerDid: String,
        verifiedUnlocks: List<AchievementUnlockRecord>,
        definitions: List<Pair<String, AchievementDefinitionRecord>>,
        handle: String? = null
    ): ActorProfileSummary {
        val defMap = definitions.toMap()
        val defsByGame = definitions.groupBy { it.second.game }

        var plat = 0
        var gold = 0
        var silver = 0
        var bronze = 0
        var custom = 0
        var untiered = 0
        var totalUnlocks = 0
        val seenNonRepeatable = hashSetOf<String>()

        for (u in verifiedUnlocks) {
            val def = defMap[u.achievement] ?: continue
            if (def.repeatable != true && !seenNonRepeatable.add(u.achievement)) continue
            totalUnlocks++
            when (def.tier) {
                "platinum" -> plat++
                "gold" -> gold++
                "silver" -> silver++
                "bronze" -> bronze++
                null, "" -> untiered++
                else -> custom++
            }
        }

        val games = defsByGame.map { (gUri, gDefs) ->
            calculateGameCompletion(gUri, verifiedUnlocks, gDefs)
        }.filter { it.unlockedCount > 0 || (it.bonusUnlockedCount ?: 0) > 0 }
            .sortedWith(
                compareByDescending<GameAchievementSummary> {
                    it.latestUnlockAt?.let { ts -> runCatching { Instant.parse(ts) }.getOrNull() } ?: Instant.EPOCH
                }.thenBy { it.game }
            )

        return ActorProfileSummary(
            did = playerDid,
            handle = handle,
            gamesPlayed = games.size,
            completedGames = games.count { it.completed },
            totalUnlocks = totalUnlocks,
            tiers = TierCounts(
                platinum = plat,
                gold = gold,
                silver = silver,
                bronze = bronze,
                custom = custom.takeIf { it > 0 },
                untiered = untiered
            ),
            games = games
        )
    }
}
