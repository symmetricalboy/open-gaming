export const OPENGAMING_NAMESPACE = 'games.opengaming' as const;
export const ATMOSPHERE_NAMESPACE = 'games.atmosphere' as const;

export const NSIDS = {
  Defs: 'games.opengaming.defs',
  AchievementDefinition: 'games.opengaming.achievement.definition',
  AchievementUnlock: 'games.opengaming.achievement.unlock',
  AchievementProgress: 'games.opengaming.achievement.progress',
  LeaderboardDefinition: 'games.opengaming.leaderboard.definition',
  LeaderboardScore: 'games.opengaming.leaderboard.score',
  LeaderboardGetScores: 'games.opengaming.leaderboard.getScores',
  ActorGetProfile: 'games.opengaming.actor.getProfile',
  MatchResult: 'games.opengaming.match.result',
  ChallengeDefinition: 'games.opengaming.challenge.definition',
  Revocation: 'games.opengaming.revocation',
} as const;

export const ATTESTATION_KEY_FRAGMENT = '#attestations' as const;

export const DEFAULT_INVALIDATING_LABELS = [
  '!cheat',
  'cheating',
  'exploit',
  'invalid-replay',
  'revoked',
] as const;

export const DEFAULT_VERIFICATION_LABELS = [
  'verified-replay',
  'community-verified',
] as const;
