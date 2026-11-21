namespace OpenGaming.Sdk
{
    public static class OpenGamingConstants
    {
        public const string OpenGamingNamespace = "games.opengaming";
        public const string AtmosphereNamespace = "games.atmosphere";
        public const string AttestationKeyFragment = "#attestations";

        public static class Nsids
        {
            public const string Defs = "games.opengaming.defs";
            public const string AchievementDefinition = "games.opengaming.achievement.definition";
            public const string AchievementUnlock = "games.opengaming.achievement.unlock";
            public const string AchievementProgress = "games.opengaming.achievement.progress";
            public const string LeaderboardDefinition = "games.opengaming.leaderboard.definition";
            public const string LeaderboardScore = "games.opengaming.leaderboard.score";
            public const string LeaderboardGetScores = "games.opengaming.leaderboard.getScores";
            public const string ActorGetProfile = "games.opengaming.actor.getProfile";
            public const string MatchResult = "games.opengaming.match.result";
            public const string ChallengeDefinition = "games.opengaming.challenge.definition";
            public const string Revocation = "games.opengaming.revocation";
        }

        public static readonly string[] DefaultInvalidatingLabels =
        {
            "!cheat",
            "cheating",
            "exploit",
            "invalid-replay",
            "revoked"
        };

        public static readonly string[] DefaultVerificationLabels =
        {
            "verified-replay",
            "community-verified"
        };

        public const string RecommendedOAuthScopes =
            "atproto " +
            "repo:games.opengaming.achievement.unlock " +
            "repo:games.opengaming.achievement.progress " +
            "repo:games.opengaming.leaderboard.score " +
            "repo:games.opengaming.match.result " +
            "blob:image/* blob:application/octet-stream";
    }
}
