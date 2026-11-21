using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace OpenGaming.Sdk
{
    public sealed class ScoreSubmissionDecision
    {
        public bool ValidBounds { get; set; }
        public bool ShouldWrite { get; set; }
        public string WriteMode { get; set; } = "none"; // "putRecord" | "createRecord" | "none"
        public string? RecommendedRkey { get; set; }
        public List<string> BeatenTimeframes { get; set; } = new List<string>();
        public string? Reason { get; set; }
    }

    public static class OpenGamingLeaderboards
    {
        private static readonly Regex SafeSlugRegex = new Regex("[^a-zA-Z0-9._~-]", RegexOptions.Compiled);
        private static readonly HashSet<string> ReservedKeys = new HashSet<string>(StringComparer.Ordinal)
        {
            ".", "..", "$keyFormat", "$valueType"
        };

        public static string GetUnlockRkey(string achievementDefinitionUri, bool repeatable = false, string? uniqueToken = null)
        {
            string suffix = repeatable && !string.IsNullOrEmpty(uniqueToken) ? ":" + uniqueToken : string.Empty;
            string hash = Sha256Hex(achievementDefinitionUri + suffix).Substring(0, 20);
            string slug = achievementDefinitionUri.Split('/').LastOrDefault() ?? "ach";
            string safeSlug = SafeSlugRegex.Replace(slug, "-");
            if (safeSlug.Length > 32) safeSlug = safeSlug.Substring(0, 32);
            return $"{safeSlug}-{hash}";
        }

        public static string GetOverwriteBestScoreRkey(
            string leaderboardDefinitionUri,
            IDictionary<string, string>? dimensions = null,
            string? seed = null)
        {
            var parts = new List<string>();
            if (dimensions != null && dimensions.Count > 0)
            {
                foreach (var key in dimensions.Keys.Where(k => !ReservedKeys.Contains(k)).OrderBy(k => k, StringComparer.Ordinal))
                {
                    parts.Add($"d:{key}={dimensions[key]}");
                }
            }
            if (!string.IsNullOrEmpty(seed))
            {
                parts.Add("s:" + seed);
            }

            string suffix = string.Join("|", parts);
            string input = suffix.Length > 0 ? $"{leaderboardDefinitionUri}|{suffix}" : leaderboardDefinitionUri;
            string hash = Sha256Hex(input).Substring(0, 20);
            string slug = leaderboardDefinitionUri.Split('/').LastOrDefault() ?? "lb";
            string safeSlug = SafeSlugRegex.Replace(slug, "-");
            if (safeSlug.Length > 32) safeSlug = safeSlug.Substring(0, 32);
            return $"{safeSlug}-best-{hash}";
        }

        public static bool IsBetterScore(long candidate, long existing, string sortOrder = "largerIsBetter") =>
            sortOrder == "smallerIsBetter" ? candidate < existing : candidate > existing;

        public static bool IsVersionLegal(string? version, IReadOnlyList<string>? rankedVersions)
        {
            if (rankedVersions == null || rankedVersions.Count == 0) return true;
            if (string.IsNullOrEmpty(version)) return false;
            return rankedVersions.Contains(version!);
        }

        public static bool IsWithinLeaderboardWindow(string timestampIso, string? startsAt, string? endsAt)
        {
            if (!DateTimeOffset.TryParse(timestampIso, out DateTimeOffset ts)) return false;
            if (!string.IsNullOrEmpty(startsAt) && DateTimeOffset.TryParse(startsAt, out DateTimeOffset start) && ts < start)
                return false;
            if (!string.IsNullOrEmpty(endsAt) && DateTimeOffset.TryParse(endsAt, out DateTimeOffset end) && ts > end)
                return false;
            return true;
        }

        public static string FormatScore(long rawScore, ScoreFormat? format = null, CultureInfo? culture = null)
        {
            var fmt = format ?? new ScoreFormat { Kind = "numeric" };
            var ci = culture ?? CultureInfo.GetCultureInfo("en-US");

            if (fmt.Kind == "time")
            {
                long totalMs = fmt.TimeUnit == "seconds" ? rawScore * 1000L : rawScore;
                string sign = totalMs < 0 ? "-" : (fmt.SignedPrefix == true && totalMs > 0 ? "+" : string.Empty);
                long absMs = Math.Abs(totalMs);
                long hours = absMs / 3_600_000L;
                long minutes = (absMs % 3_600_000L) / 60_000L;
                long seconds = (absMs % 60_000L) / 1000L;
                long hundredths = (absMs % 1000L) / 10L;

                string secPadded = seconds.ToString("00", CultureInfo.InvariantCulture);
                string frac = fmt.TimeUnit == "seconds" ? string.Empty : "." + hundredths.ToString("00", CultureInfo.InvariantCulture);
                return hours > 0
                    ? $"{sign}{hours}:{minutes.ToString("00", CultureInfo.InvariantCulture)}:{secPadded}{frac}"
                    : $"{sign}{minutes}:{secPadded}{frac}";
            }

            int decimals = Math.Max(0, Math.Min(6, fmt.DecimalPlaces ?? 0));
            double scaled = rawScore / Math.Pow(10, decimals);

            if (fmt.Kind == "currency")
            {
                int curDecimals = decimals == 6 ? 2 : decimals;
                string symbol = fmt.CurrencyCode == "EUR" ? "€" : fmt.CurrencyCode == "GBP" ? "£" : "$";
                return symbol + scaled.ToString("N" + curDecimals, ci);
            }

            string baseFormatted = scaled.ToString("N" + decimals, ci);
            string formattedNum = fmt.SignedPrefix == true && scaled > 0 && !baseFormatted.StartsWith("+", StringComparison.Ordinal)
                ? "+" + baseFormatted
                : baseFormatted;

            if (Math.Abs(scaled - 1.0) < 1e-9 && !string.IsNullOrEmpty(fmt.UnitSingular))
                return $"{formattedNum} {fmt.UnitSingular}";
            if (!string.IsNullOrEmpty(fmt.UnitPlural))
                return $"{formattedNum} {fmt.UnitPlural}";
            if (!string.IsNullOrEmpty(fmt.UnitSingular))
                return $"{formattedNum} {fmt.UnitSingular}";
            return formattedNum;
        }

        public static ScoreSubmissionDecision EvaluateScoreSubmission(
            string leaderboardUri,
            long score,
            LeaderboardDefinitionRecord definition,
            IEnumerable<LeaderboardScoreRecord>? existingPlayerScores = null,
            IDictionary<string, string>? dimensions = null,
            string? seed = null,
            string? version = null,
            DateTimeOffset? now = null)
        {
            var effectiveNow = now ?? DateTimeOffset.UtcNow;
            string nowIso = effectiveNow.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

            if (!IsWithinLeaderboardWindow(nowIso, definition.StartsAt, definition.EndsAt))
            {
                return new ScoreSubmissionDecision
                {
                    ValidBounds = false,
                    ShouldWrite = false,
                    WriteMode = "none",
                    Reason = "Submission timestamp is outside leaderboard active window."
                };
            }

            if (!IsVersionLegal(version, definition.RankedVersions))
            {
                return new ScoreSubmissionDecision
                {
                    ValidBounds = false,
                    ShouldWrite = false,
                    WriteMode = "none",
                    Reason = $"Version '{version ?? "none"}' is not in leaderboard rankedVersions."
                };
            }

            if (definition.ScoreMin.HasValue && score < definition.ScoreMin.Value)
            {
                return new ScoreSubmissionDecision
                {
                    ValidBounds = false,
                    ShouldWrite = false,
                    WriteMode = "none",
                    Reason = $"Score {score} is below scoreMin {definition.ScoreMin.Value}."
                };
            }

            if (definition.ScoreMax.HasValue && score > definition.ScoreMax.Value)
            {
                return new ScoreSubmissionDecision
                {
                    ValidBounds = false,
                    ShouldWrite = false,
                    WriteMode = "none",
                    Reason = $"Score {score} exceeds scoreMax {definition.ScoreMax.Value}."
                };
            }

            string sortOrder = definition.SortOrder ?? "largerIsBetter";
            var matchingExisting = (existingPlayerScores ?? Enumerable.Empty<LeaderboardScoreRecord>())
                .Where(s => s.Leaderboard == leaderboardUri && s.Score.HasValue && MatchesDimensions(s.Dimensions, dimensions) && (seed == null || s.Seed == seed))
                .ToList();

            var timeframes = definition.Timeframes != null && definition.Timeframes.Count > 0
                ? definition.Timeframes
                : new List<string> { "allTime" };

            var beaten = new List<string>();
            foreach (string tf in timeframes)
            {
                DateTimeOffset start = GetTimeframeStartUtc(tf, effectiveNow);
                var inWindow = matchingExisting.Where(s => DateTimeOffset.TryParse(s.RecordedAt, out var ts) && ts >= start).ToList();
                if (inWindow.Count == 0)
                {
                    beaten.Add(tf);
                }
                else
                {
                    long bestInWindow = sortOrder == "smallerIsBetter"
                        ? inWindow.Min(s => s.Score!.Value)
                        : inWindow.Max(s => s.Score!.Value);
                    if (IsBetterScore(score, bestInWindow, sortOrder))
                        beaten.Add(tf);
                }
            }

            string policy = definition.RecordPolicy ?? "overwriteBest";
            if (policy == "everyRun" || definition.RankingMode == "latest")
            {
                return new ScoreSubmissionDecision
                {
                    ValidBounds = true,
                    ShouldWrite = true,
                    WriteMode = "createRecord",
                    BeatenTimeframes = beaten
                };
            }

            if (policy == "overwriteBest" || policy == "bestOnly")
            {
                bool beatsAllTime = matchingExisting.Count == 0 || beaten.Contains("allTime");
                return new ScoreSubmissionDecision
                {
                    ValidBounds = true,
                    ShouldWrite = beatsAllTime,
                    WriteMode = beatsAllTime ? "putRecord" : "none",
                    RecommendedRkey = beatsAllTime ? GetOverwriteBestScoreRkey(leaderboardUri, dimensions, seed) : null,
                    BeatenTimeframes = beaten,
                    Reason = beatsAllTime ? null : "Did not beat existing personal best."
                };
            }

            if (policy == "personalBests")
            {
                bool beatsAllTime = matchingExisting.Count == 0 || beaten.Contains("allTime");
                return new ScoreSubmissionDecision
                {
                    ValidBounds = true,
                    ShouldWrite = beatsAllTime,
                    WriteMode = beatsAllTime ? "createRecord" : "none",
                    BeatenTimeframes = beaten,
                    Reason = beatsAllTime ? null : "Did not beat all-time personal best."
                };
            }

            // perWindowBest
            bool beatsAny = beaten.Count > 0;
            return new ScoreSubmissionDecision
            {
                ValidBounds = true,
                ShouldWrite = beatsAny,
                WriteMode = beatsAny ? "createRecord" : "none",
                BeatenTimeframes = beaten,
                Reason = beatsAny ? null : "Did not beat personal best in any active timeframe."
            };
        }

        public static string SerializeDimensionsFilter(IDictionary<string, string>? filter)
        {
            if (filter == null || filter.Count == 0) return string.Empty;
            return string.Join(",", filter.Where(kv => !ReservedKeys.Contains(kv.Key) && !string.IsNullOrEmpty(kv.Value)).Select(kv => $"{kv.Key}={kv.Value}"));
        }

        private static bool MatchesDimensions(IDictionary<string, string>? actual, IDictionary<string, string>? filter)
        {
            if (filter == null || filter.Count == 0) return true;
            if (actual == null) return false;
            foreach (var kv in filter)
            {
                if (!actual.TryGetValue(kv.Key, out string? val) || val != kv.Value)
                    return false;
            }
            return true;
        }

        private static DateTimeOffset GetTimeframeStartUtc(string timeframe, DateTimeOffset now)
        {
            var utc = now.UtcDateTime;
            return timeframe switch
            {
                "daily" => new DateTimeOffset(utc.Year, utc.Month, utc.Day, 0, 0, 0, TimeSpan.Zero),
                "monthly" => new DateTimeOffset(utc.Year, utc.Month, 1, 0, 0, 0, TimeSpan.Zero),
                "weekly" => new DateTimeOffset(utc.Year, utc.Month, utc.Day, 0, 0, 0, TimeSpan.Zero)
                    .AddDays(-(((int)utc.DayOfWeek + 6) % 7)),
                _ => DateTimeOffset.MinValue
            };
        }

        private static string Sha256Hex(string input)
        {
            using var sha = SHA256.Create();
            return OpenGamingAttestation.BytesToHex(sha.ComputeHash(Encoding.UTF8.GetBytes(input)));
        }
    }
}
