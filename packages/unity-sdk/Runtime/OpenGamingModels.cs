using System;
using System.Collections.Generic;

namespace OpenGaming.Sdk
{
    public sealed class BytesWrapper
    {
        public string BytesBase64 { get; set; } = string.Empty;
    }

    public sealed class BlobRef
    {
        public string CidLink { get; set; } = string.Empty;
        public string MimeType { get; set; } = string.Empty;
        public long Size { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            return new Dictionary<string, object?>
            {
                ["$type"] = "blob",
                ["ref"] = new Dictionary<string, object?> { ["$link"] = CidLink },
                ["mimeType"] = MimeType,
                ["size"] = Size
            };
        }
    }

    public sealed class InlineSignature
    {
        public string Type { get; set; } = OpenGamingConstants.Nsids.Defs + "#inlineSignature";
        public string Key { get; set; } = string.Empty;
        public string? Issuer { get; set; }
        public string? IssuedAt { get; set; }
        public string? Rkey { get; set; }
        public string? Cid { get; set; }
        public string SignatureBase64 { get; set; } = string.Empty;

        public Dictionary<string, object?> ToMetadataMapWithoutSigOrCid()
        {
            var map = new Dictionary<string, object?>
            {
                ["$type"] = Type,
                ["key"] = Key
            };
            if (Issuer != null) map["issuer"] = Issuer;
            if (IssuedAt != null) map["issuedAt"] = IssuedAt;
            if (Rkey != null) map["rkey"] = Rkey;
            return map;
        }

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = ToMetadataMapWithoutSigOrCid();
            if (Cid != null) map["cid"] = Cid;
            map["signature"] = new Dictionary<string, object?> { ["$bytes"] = SignatureBase64 };
            return map;
        }
    }

    public sealed class ScoreFormat
    {
        public string Kind { get; set; } = "numeric";
        public int? DecimalPlaces { get; set; }
        public string? TimeUnit { get; set; }
        public string? CurrencyCode { get; set; }
        public string? UnitSingular { get; set; }
        public string? UnitPlural { get; set; }
        public bool? SignedPrefix { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = new Dictionary<string, object?> { ["kind"] = Kind };
            if (DecimalPlaces.HasValue) map["decimalPlaces"] = (long)DecimalPlaces.Value;
            if (TimeUnit != null) map["timeUnit"] = TimeUnit;
            if (CurrencyCode != null) map["currencyCode"] = CurrencyCode;
            if (UnitSingular != null) map["unitSingular"] = UnitSingular;
            if (UnitPlural != null) map["unitPlural"] = UnitPlural;
            if (SignedPrefix.HasValue) map["signedPrefix"] = SignedPrefix.Value;
            return map;
        }
    }

    public sealed class OptionItem
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
    }

    public sealed class Participant
    {
        public string? Did { get; set; }
        public string? Name { get; set; }
        public string? Role { get; set; }
        public string? Team { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = new Dictionary<string, object?>();
            if (Did != null) map["did"] = Did;
            if (Name != null) map["name"] = Name;
            if (Role != null) map["role"] = Role;
            if (Team != null) map["team"] = Team;
            return map;
        }
    }

    public sealed class Translation
    {
        public string? Title { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public string? Requirement { get; set; }
        public string? Tooltip { get; set; }
    }

    public sealed class TimeRange
    {
        public string From { get; set; } = string.Empty;
        public string Until { get; set; } = string.Empty;
        public string? Recurrence { get; set; }
        public string? Label { get; set; }
    }

    public sealed class ScoreComponentDef
    {
        public string Type { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? SortOrder { get; set; }
        public int? Precision { get; set; }
        public string? TimeUnit { get; set; }
        public long? Minimum { get; set; }
        public long? Maximum { get; set; }
        public string? UnitSingular { get; set; }
        public string? UnitPlural { get; set; }
        public List<OptionItem>? Values { get; set; }
        public int? MaxGraphemes { get; set; }
    }

    public sealed class ScoreComponentVal
    {
        public string Type { get; set; } = string.Empty;
        public long? IntValue { get; set; }
        public string? StringValue { get; set; }

        public static ScoreComponentVal Points(long value) => new ScoreComponentVal
        {
            Type = OpenGamingConstants.Nsids.LeaderboardScore + "#points",
            IntValue = value
        };

        public static ScoreComponentVal Percentage(long scaledValue) => new ScoreComponentVal
        {
            Type = OpenGamingConstants.Nsids.LeaderboardScore + "#percentage",
            IntValue = scaledValue
        };

        public static ScoreComponentVal Time(long duration) => new ScoreComponentVal
        {
            Type = OpenGamingConstants.Nsids.LeaderboardScore + "#time",
            IntValue = duration
        };

        public static ScoreComponentVal Enum(string optionId) => new ScoreComponentVal
        {
            Type = OpenGamingConstants.Nsids.LeaderboardScore + "#enum",
            StringValue = optionId
        };

        public static ScoreComponentVal Text(string text) => new ScoreComponentVal
        {
            Type = OpenGamingConstants.Nsids.LeaderboardScore + "#text",
            StringValue = text
        };

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = new Dictionary<string, object?> { ["$type"] = Type };
            if (IntValue.HasValue) map["value"] = IntValue.Value;
            else if (StringValue != null) map["value"] = StringValue;
            return map;
        }
    }

    public sealed class DimensionDef
    {
        public string Name { get; set; } = string.Empty;
        public List<OptionItem>? Values { get; set; }
        public bool? Required { get; set; }
        public bool? AllowCustomValues { get; set; }
        public string? DefaultValue { get; set; }
    }

    public sealed class AchievementDefinitionRecord
    {
        public string Game { get; set; } = string.Empty;
        public string? Title { get; set; }
        public string? Description { get; set; }
        public string? Requirement { get; set; }
        public string? Tooltip { get; set; }
        public Dictionary<string, Translation>? Translations { get; set; }
        public BlobRef? Icon { get; set; }
        public string? IconAlt { get; set; }
        public BlobRef? LockedIcon { get; set; }
        public string? Tier { get; set; }
        public bool? Hidden { get; set; }
        public string? HiddenSpace { get; set; }
        public bool? CompletionOptional { get; set; }
        public bool? Repeatable { get; set; }
        public List<TimeRange>? Timelocked { get; set; }
        public bool? Retired { get; set; }
        public int? StepsNeeded { get; set; }
        public string? Group { get; set; }
        public int? ListOrder { get; set; }
        public string? Badge { get; set; }
        public List<string>? TrustedIssuers { get; set; }
        public string CreatedAt { get; set; } = string.Empty;
        public string? UpdatedAt { get; set; }
    }

    public sealed class AchievementUnlockRecord
    {
        public string Achievement { get; set; } = string.Empty;
        public string? DefinitionCid { get; set; }
        public string? Game { get; set; }
        public string? Player { get; set; }
        public string UnlockedAt { get; set; } = string.Empty;
        public int? StepsCompleted { get; set; }
        public List<Participant>? Participants { get; set; }
        public string? RunId { get; set; }
        public Dictionary<string, object?>? Details { get; set; }
        public BlobRef? Media { get; set; }
        public string? MediaAlt { get; set; }
        public string? Note { get; set; }
        public List<InlineSignature>? Signatures { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = new Dictionary<string, object?>
            {
                ["$type"] = OpenGamingConstants.Nsids.AchievementUnlock,
                ["achievement"] = Achievement,
                ["unlockedAt"] = UnlockedAt
            };
            if (DefinitionCid != null) map["definitionCid"] = DefinitionCid;
            if (Game != null) map["game"] = Game;
            if (Player != null) map["player"] = Player;
            if (StepsCompleted.HasValue) map["stepsCompleted"] = (long)StepsCompleted.Value;
            if (Participants != null)
            {
                var pList = new List<object?>();
                foreach (var p in Participants) pList.Add(p.ToRecordMap());
                map["participants"] = pList;
            }
            if (RunId != null) map["runId"] = RunId;
            if (Details != null) map["details"] = Details;
            if (Media != null) map["media"] = Media.ToRecordMap();
            if (MediaAlt != null) map["mediaAlt"] = MediaAlt;
            if (Note != null) map["note"] = Note;
            if (Signatures != null)
            {
                var sList = new List<object?>();
                foreach (var s in Signatures) sList.Add(s.ToRecordMap());
                map["signatures"] = sList;
            }
            return map;
        }
    }

    public sealed class AchievementProgressRecord
    {
        public string Achievement { get; set; } = string.Empty;
        public string? DefinitionCid { get; set; }
        public string? Game { get; set; }
        public int CurrentSteps { get; set; }
        public int? StepsNeeded { get; set; }
        public string UpdatedAt { get; set; } = string.Empty;
        public List<InlineSignature>? Signatures { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = new Dictionary<string, object?>
            {
                ["$type"] = OpenGamingConstants.Nsids.AchievementProgress,
                ["achievement"] = Achievement,
                ["currentSteps"] = (long)CurrentSteps,
                ["updatedAt"] = UpdatedAt
            };
            if (DefinitionCid != null) map["definitionCid"] = DefinitionCid;
            if (Game != null) map["game"] = Game;
            if (StepsNeeded.HasValue) map["stepsNeeded"] = (long)StepsNeeded.Value;
            if (Signatures != null)
            {
                var sList = new List<object?>();
                foreach (var s in Signatures) sList.Add(s.ToRecordMap());
                map["signatures"] = sList;
            }
            return map;
        }
    }

    public sealed class LeaderboardDefinitionRecord
    {
        public string Game { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public Dictionary<string, Translation>? Translations { get; set; }
        public BlobRef? Icon { get; set; }
        public string? IconAlt { get; set; }
        public string? SortOrder { get; set; }
        public string? RankingMode { get; set; }
        public ScoreFormat? ScoreFormat { get; set; }
        public Dictionary<string, ScoreComponentDef>? Components { get; set; }
        public List<string>? ComponentOrder { get; set; }
        public string? DefaultComponent { get; set; }
        public Dictionary<string, DimensionDef>? Dimensions { get; set; }
        public List<string>? DimensionOrder { get; set; }
        public List<string>? RankedVersions { get; set; }
        public List<string>? TrustedIssuers { get; set; }
        public List<string> Timeframes { get; set; } = new List<string> { "allTime" };
        public string? StartsAt { get; set; }
        public string? EndsAt { get; set; }
        public string RecordPolicy { get; set; } = "overwriteBest";
        public long? ScoreMin { get; set; }
        public long? ScoreMax { get; set; }
        public int? ListOrder { get; set; }
        public string CreatedAt { get; set; } = string.Empty;
    }

    public sealed class LeaderboardScoreRecord
    {
        public string Leaderboard { get; set; } = string.Empty;
        public string? DefinitionCid { get; set; }
        public string? Game { get; set; }
        public string? Player { get; set; }
        public long? Score { get; set; }
        public string? DisplayScore { get; set; }
        public Dictionary<string, ScoreComponentVal>? Components { get; set; }
        public Dictionary<string, string>? Dimensions { get; set; }
        public string? Seed { get; set; }
        public List<Participant>? Participants { get; set; }
        public string? RunId { get; set; }
        public Dictionary<string, object?>? Details { get; set; }
        public string? Version { get; set; }
        public BlobRef? Replay { get; set; }
        public string? Tag { get; set; }
        public string RecordedAt { get; set; } = string.Empty;
        public List<InlineSignature>? Signatures { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = new Dictionary<string, object?>
            {
                ["$type"] = OpenGamingConstants.Nsids.LeaderboardScore,
                ["leaderboard"] = Leaderboard,
                ["recordedAt"] = RecordedAt
            };
            if (DefinitionCid != null) map["definitionCid"] = DefinitionCid;
            if (Game != null) map["game"] = Game;
            if (Player != null) map["player"] = Player;
            if (Score.HasValue) map["score"] = Score.Value;
            if (DisplayScore != null) map["displayScore"] = DisplayScore;
            if (Components != null && Components.Count > 0)
            {
                var cMap = new Dictionary<string, object?>();
                foreach (var kv in Components) cMap[kv.Key] = kv.Value.ToRecordMap();
                map["components"] = cMap;
            }
            if (Dimensions != null && Dimensions.Count > 0)
            {
                var dMap = new Dictionary<string, object?>();
                foreach (var kv in Dimensions) dMap[kv.Key] = kv.Value;
                map["dimensions"] = dMap;
            }
            if (Seed != null) map["seed"] = Seed;
            if (Participants != null)
            {
                var pList = new List<object?>();
                foreach (var p in Participants) pList.Add(p.ToRecordMap());
                map["participants"] = pList;
            }
            if (RunId != null) map["runId"] = RunId;
            if (Details != null) map["details"] = Details;
            if (Version != null) map["version"] = Version;
            if (Replay != null) map["replay"] = Replay.ToRecordMap();
            if (Tag != null) map["tag"] = Tag;
            if (Signatures != null)
            {
                var sList = new List<object?>();
                foreach (var s in Signatures) sList.Add(s.ToRecordMap());
                map["signatures"] = sList;
            }
            return map;
        }
    }

    public sealed class MatchParticipant
    {
        public string? Did { get; set; }
        public string? Name { get; set; }
        public string? Team { get; set; }
        public string? Role { get; set; }
        public string? Character { get; set; }
        public string Outcome { get; set; } = "completed";
        public int? Placement { get; set; }
        public long? Score { get; set; }
        public string? ScoreText { get; set; }
        public long? RatingBefore { get; set; }
        public long? RatingAfter { get; set; }
        public long? RatingDeviation { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = new Dictionary<string, object?> { ["outcome"] = Outcome };
            if (Did != null) map["did"] = Did;
            if (Name != null) map["name"] = Name;
            if (Team != null) map["team"] = Team;
            if (Role != null) map["role"] = Role;
            if (Character != null) map["character"] = Character;
            if (Placement.HasValue) map["placement"] = (long)Placement.Value;
            if (Score.HasValue) map["score"] = Score.Value;
            if (ScoreText != null) map["scoreText"] = ScoreText;
            if (RatingBefore.HasValue) map["ratingBefore"] = RatingBefore.Value;
            if (RatingAfter.HasValue) map["ratingAfter"] = RatingAfter.Value;
            if (RatingDeviation.HasValue) map["ratingDeviation"] = RatingDeviation.Value;
            return map;
        }
    }

    public sealed class MatchResultRecord
    {
        public string Game { get; set; } = string.Empty;
        public string? MatchId { get; set; }
        public string? Leaderboard { get; set; }
        public string? Challenge { get; set; }
        public string? Mode { get; set; }
        public int? BestOf { get; set; }
        public long? DurationMs { get; set; }
        public List<MatchParticipant> Participants { get; set; } = new List<MatchParticipant>();
        public Dictionary<string, string>? Dimensions { get; set; }
        public Dictionary<string, object?>? Details { get; set; }
        public string? Version { get; set; }
        public BlobRef? Replay { get; set; }
        public string PlayedAt { get; set; } = string.Empty;
        public List<InlineSignature>? Signatures { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            var pList = new List<object?>();
            foreach (var p in Participants) pList.Add(p.ToRecordMap());

            var map = new Dictionary<string, object?>
            {
                ["$type"] = OpenGamingConstants.Nsids.MatchResult,
                ["game"] = Game,
                ["participants"] = pList,
                ["playedAt"] = PlayedAt
            };
            if (MatchId != null) map["matchId"] = MatchId;
            if (Leaderboard != null) map["leaderboard"] = Leaderboard;
            if (Challenge != null) map["challenge"] = Challenge;
            if (Mode != null) map["mode"] = Mode;
            if (BestOf.HasValue) map["bestOf"] = (long)BestOf.Value;
            if (DurationMs.HasValue) map["durationMs"] = DurationMs.Value;
            if (Dimensions != null && Dimensions.Count > 0)
            {
                var dMap = new Dictionary<string, object?>();
                foreach (var kv in Dimensions) dMap[kv.Key] = kv.Value;
                map["dimensions"] = dMap;
            }
            if (Details != null) map["details"] = Details;
            if (Version != null) map["version"] = Version;
            if (Replay != null) map["replay"] = Replay.ToRecordMap();
            if (Signatures != null)
            {
                var sList = new List<object?>();
                foreach (var s in Signatures) sList.Add(s.ToRecordMap());
                map["signatures"] = sList;
            }
            return map;
        }
    }

    public sealed class RevocationRecord
    {
        public string Scope { get; set; } = "attestation";
        public string? AttestationCid { get; set; }
        public string Player { get; set; } = string.Empty;
        public string Subject { get; set; } = string.Empty;
        public string? RecordUri { get; set; }
        public string? Before { get; set; }
        public string Reason { get; set; } = "other";
        public string? Note { get; set; }
        public string RevokedAt { get; set; } = string.Empty;
        public string? OriginPublisherDid { get; set; }

        public Dictionary<string, object?> ToRecordMap()
        {
            var map = new Dictionary<string, object?>
            {
                ["$type"] = OpenGamingConstants.Nsids.Revocation,
                ["scope"] = Scope,
                ["player"] = Player,
                ["subject"] = Subject,
                ["reason"] = Reason,
                ["revokedAt"] = RevokedAt
            };
            if (AttestationCid != null) map["attestationCid"] = AttestationCid;
            if (RecordUri != null) map["recordUri"] = RecordUri;
            if (Before != null) map["before"] = Before;
            if (Note != null) map["note"] = Note;
            return map;
        }
    }

    public sealed class AtprotoLabel
    {
        public string Src { get; set; } = string.Empty;
        public string Uri { get; set; } = string.Empty;
        public string? Cid { get; set; }
        public string Val { get; set; } = string.Empty;
        public bool Neg { get; set; }
        public string Cts { get; set; } = string.Empty;
        public string? Exp { get; set; }
    }

    public sealed class VerificationResult
    {
        public bool Verified { get; set; }
        public string? IssuerDid { get; set; }
        public string? KeyId { get; set; }
        public string? AttestationCid { get; set; }
        public string? VerificationMethod { get; set; }
        public List<string>? CoSigners { get; set; }
        public string? Error { get; set; }
        public string? Message { get; set; }
        public RevocationRecord? Revocation { get; set; }

        public static VerificationResult Ok(
            string issuerDid,
            string keyId,
            string attestationCid,
            string verificationMethod = "attestation",
            List<string>? coSigners = null) =>
            new VerificationResult
            {
                Verified = true,
                IssuerDid = issuerDid,
                KeyId = keyId,
                AttestationCid = attestationCid,
                VerificationMethod = verificationMethod,
                CoSigners = coSigners
            };

        public static VerificationResult Fail(
            string error,
            string message,
            string? issuerDid = null,
            string? attestationCid = null,
            RevocationRecord? revocation = null) =>
            new VerificationResult
            {
                Verified = false,
                Error = error,
                Message = message,
                IssuerDid = issuerDid,
                AttestationCid = attestationCid,
                Revocation = revocation
            };
    }

    public sealed class TierCounts
    {
        public int Platinum { get; set; }
        public int Gold { get; set; }
        public int Silver { get; set; }
        public int Bronze { get; set; }
        public int? Custom { get; set; }
        public int Untiered { get; set; }
    }

    public sealed class GameAchievementSummary
    {
        public string Game { get; set; } = string.Empty;
        public int UnlockedCount { get; set; }
        public int TotalAchievements { get; set; }
        public int? BonusUnlockedCount { get; set; }
        public int CompletionPercent { get; set; }
        public bool Completed { get; set; }
        public string? LatestUnlockAt { get; set; }
    }

    public sealed class ActorProfileSummary
    {
        public string Did { get; set; } = string.Empty;
        public string? Handle { get; set; }
        public int GamesPlayed { get; set; }
        public int CompletedGames { get; set; }
        public int TotalUnlocks { get; set; }
        public TierCounts Tiers { get; set; } = new TierCounts();
        public List<GameAchievementSummary> Games { get; set; } = new List<GameAchievementSummary>();
    }
}
