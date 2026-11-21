using System;
using System.Collections.Generic;
using System.Linq;

namespace OpenGaming.Sdk
{
    public static class OpenGamingProfile
    {
        public static Translation ResolveTranslation(
            AchievementDefinitionRecord definition,
            string? locale)
        {
            var baseTrans = new Translation
            {
                Title = definition.Title,
                Description = definition.Description,
                Requirement = definition.Requirement,
                Tooltip = definition.Tooltip
            };

            if (string.IsNullOrWhiteSpace(locale) || definition.Translations == null || definition.Translations.Count == 0)
                return baseTrans;

            string requested = locale!.Trim().ToLowerInvariant();
            Translation? matched = definition.Translations
                .FirstOrDefault(kv => kv.Key.ToLowerInvariant() == requested).Value;

            if (matched == null)
            {
                string primaryLang = requested.Split('-')[0];
                matched = definition.Translations
                    .FirstOrDefault(kv => kv.Key.ToLowerInvariant() == primaryLang).Value;
            }

            if (matched == null) return baseTrans;

            return new Translation
            {
                Title = matched.Title ?? baseTrans.Title,
                Name = matched.Name ?? baseTrans.Name,
                Description = matched.Description ?? baseTrans.Description,
                Requirement = matched.Requirement ?? baseTrans.Requirement,
                Tooltip = matched.Tooltip ?? baseTrans.Tooltip
            };
        }

        public static GameAchievementSummary CalculateGameCompletion(
            string gameUri,
            IEnumerable<AchievementUnlockRecord> verifiedUnlocks,
            IEnumerable<(string Uri, AchievementDefinitionRecord Record)> definitions)
        {
            var gameDefs = definitions.Where(d => d.Record.Game == gameUri).ToList();
            var baseDefs = gameDefs.Where(d => d.Record.CompletionOptional != true).ToList();
            var bonusMap = gameDefs
                .Where(d => d.Record.CompletionOptional == true)
                .ToDictionary(d => d.Uri, d => d.Record, StringComparer.Ordinal);
            var baseSet = new HashSet<string>(baseDefs.Select(d => d.Uri), StringComparer.Ordinal);
            var allSet = new HashSet<string>(gameDefs.Select(d => d.Uri), StringComparer.Ordinal);

            var unlockedBase = new HashSet<string>(StringComparer.Ordinal);
            var unlockedBonus = new HashSet<string>(StringComparer.Ordinal);
            int repeatableBonusExtra = 0;
            string? latestUnlockAt = null;
            DateTimeOffset latestTs = DateTimeOffset.MinValue;

            foreach (var unlock in verifiedUnlocks)
            {
                if (!allSet.Contains(unlock.Achievement)) continue;
                if (DateTimeOffset.TryParse(unlock.UnlockedAt, out var ts) && ts > latestTs)
                {
                    latestTs = ts;
                    latestUnlockAt = unlock.UnlockedAt;
                }

                if (baseSet.Contains(unlock.Achievement))
                {
                    unlockedBase.Add(unlock.Achievement);
                }
                else if (bonusMap.TryGetValue(unlock.Achievement, out var bonusDef))
                {
                    if (unlockedBonus.Contains(unlock.Achievement) && bonusDef.Repeatable == true)
                        repeatableBonusExtra++;
                    else
                        unlockedBonus.Add(unlock.Achievement);
                }
            }

            int total = baseDefs.Count;
            int unlocked = unlockedBase.Count;
            int bonusTotal = unlockedBonus.Count + repeatableBonusExtra;
            bool completed = total > 0 && unlocked == total;
            int percent = total == 0 ? 0 : Math.Min(100, (unlocked * 100) / total);

            return new GameAchievementSummary
            {
                Game = gameUri,
                UnlockedCount = unlocked,
                TotalAchievements = total,
                BonusUnlockedCount = bonusTotal > 0 ? bonusTotal : null,
                CompletionPercent = percent,
                Completed = completed,
                LatestUnlockAt = latestUnlockAt
            };
        }

        public static ActorProfileSummary SummarizeActorProfile(
            string playerDid,
            IEnumerable<AchievementUnlockRecord> verifiedUnlocks,
            IEnumerable<(string Uri, AchievementDefinitionRecord Record)> definitions,
            string? handle = null)
        {
            var unlockList = verifiedUnlocks.ToList();
            var defList = definitions.ToList();
            var defByUri = defList.ToDictionary(d => d.Uri, d => d.Record, StringComparer.Ordinal);
            var defsByGame = defList.GroupBy(d => d.Record.Game).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

            var tiers = new TierCounts();
            var seenNonRepeatable = new HashSet<string>(StringComparer.Ordinal);
            int totalUnlocks = 0;

            foreach (var u in unlockList)
            {
                if (!defByUri.TryGetValue(u.Achievement, out var def)) continue;
                if (def.Repeatable != true)
                {
                    if (!seenNonRepeatable.Add(u.Achievement)) continue;
                }
                totalUnlocks++;
                switch (def.Tier)
                {
                    case "platinum": tiers.Platinum++; break;
                    case "gold": tiers.Gold++; break;
                    case "silver": tiers.Silver++; break;
                    case "bronze": tiers.Bronze++; break;
                    case null:
                    case "":
                        tiers.Untiered++;
                        break;
                    default:
                        tiers.Custom = (tiers.Custom ?? 0) + 1;
                        break;
                }
            }

            var games = new List<GameAchievementSummary>();
            foreach (var kv in defsByGame)
            {
                var summary = CalculateGameCompletion(kv.Key, unlockList, kv.Value);
                if (summary.UnlockedCount > 0 || (summary.BonusUnlockedCount ?? 0) > 0)
                    games.Add(summary);
            }

            games.Sort((a, b) =>
            {
                DateTimeOffset ta = a.LatestUnlockAt != null && DateTimeOffset.TryParse(a.LatestUnlockAt, out var d1) ? d1 : DateTimeOffset.MinValue;
                DateTimeOffset tb = b.LatestUnlockAt != null && DateTimeOffset.TryParse(b.LatestUnlockAt, out var d2) ? d2 : DateTimeOffset.MinValue;
                int cmp = tb.CompareTo(ta);
                return cmp != 0 ? cmp : string.CompareOrdinal(a.Game, b.Game);
            });

            return new ActorProfileSummary
            {
                Did = playerDid,
                Handle = handle,
                GamesPlayed = games.Count,
                CompletedGames = games.Count(g => g.Completed),
                TotalUnlocks = totalUnlocks,
                Tiers = tiers,
                Games = games
            };
        }
    }
}
