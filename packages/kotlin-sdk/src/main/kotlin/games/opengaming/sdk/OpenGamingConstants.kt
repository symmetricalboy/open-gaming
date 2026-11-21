package games.opengaming.sdk

object OpenGamingConstants {
    const val OPENGAMING_NAMESPACE = "games.opengaming"
    const val ATMOSPHERE_NAMESPACE = "games.atmosphere"
    const val ATTESTATION_KEY_FRAGMENT = "#attestations"

    object Nsids {
        const val DEFS = "games.opengaming.defs"
        const val ACHIEVEMENT_DEFINITION = "games.opengaming.achievement.definition"
        const val ACHIEVEMENT_UNLOCK = "games.opengaming.achievement.unlock"
        const val ACHIEVEMENT_PROGRESS = "games.opengaming.achievement.progress"
        const val LEADERBOARD_DEFINITION = "games.opengaming.leaderboard.definition"
        const val LEADERBOARD_SCORE = "games.opengaming.leaderboard.score"
        const val LEADERBOARD_GET_SCORES = "games.opengaming.leaderboard.getScores"
        const val ACTOR_GET_PROFILE = "games.opengaming.actor.getProfile"
        const val MATCH_RESULT = "games.opengaming.match.result"
        const val CHALLENGE_DEFINITION = "games.opengaming.challenge.definition"
        const val REVOCATION = "games.opengaming.revocation"
    }

    val DEFAULT_INVALIDATING_LABELS: List<String> = listOf(
        "!cheat",
        "cheating",
        "exploit",
        "invalid-replay",
        "revoked"
    )

    val DEFAULT_VERIFICATION_LABELS: List<String> = listOf(
        "verified-replay",
        "community-verified"
    )

    const val RECOMMENDED_OAUTH_SCOPES: String =
        "atproto " +
            "repo:games.opengaming.achievement.unlock " +
            "repo:games.opengaming.achievement.progress " +
            "repo:games.opengaming.leaderboard.score " +
            "repo:games.opengaming.match.result " +
            "blob:image/* blob:application/octet-stream"
}
