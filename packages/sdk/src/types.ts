export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum' | (string & {});

export type LeaderboardSortOrder = 'largerIsBetter' | 'smallerIsBetter' | (string & {});

export type ScoreFormatKind = 'numeric' | 'time' | 'currency' | (string & {});

export type Timeframe = 'daily' | 'weekly' | 'allTime';

export type RecordPolicy = 'bestOnly' | 'perWindowBest' | 'everyRun';

export type RevocationScope = 'attestation' | 'achievement' | 'leaderboard' | 'game';

export type RevocationReason =
  | 'cheating'
  | 'exploit'
  | 'bug'
  | 'mistakenGrant'
  | 'accountCompromised'
  | 'requestedByPlayer'
  | 'other'
  | (string & {});

export interface BytesWrapper {
  $bytes: string;
}

export interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface InlineSignature {
  $type: 'games.opengaming.defs#inlineSignature' | (string & {});
  key: string;
  signature: BytesWrapper | Uint8Array;
  issuer?: string;
  issuedAt?: string;
  cid?: string;
}

export interface ScoreFormat {
  kind: ScoreFormatKind;
  decimalPlaces?: number;
  timeUnit?: 'milliseconds' | 'seconds' | (string & {});
  currencyCode?: string;
  unitSingular?: string;
  unitPlural?: string;
}

export interface AchievementDefinitionRecord {
  $type: 'games.opengaming.achievement.definition';
  game: string;
  title: string;
  description: string;
  requirement?: string;
  icon: BlobRef;
  iconAlt?: string;
  lockedIcon?: BlobRef;
  tier?: AchievementTier;
  hidden?: boolean;
  stepsNeeded?: number;
  group?: string;
  listOrder?: number;
  badge?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AchievementUnlockRecord {
  $type: 'games.opengaming.achievement.unlock';
  achievement: string;
  definitionCid?: string;
  game?: string;
  player?: string;
  unlockedAt: string;
  stepsCompleted?: number;
  signatures?: InlineSignature[];
}

export interface AchievementProgressRecord {
  $type: 'games.opengaming.achievement.progress';
  achievement: string;
  game?: string;
  currentSteps: number;
  stepsNeeded?: number;
  updatedAt: string;
  signatures?: InlineSignature[];
}

export interface LeaderboardDefinitionRecord {
  $type: 'games.opengaming.leaderboard.definition';
  game: string;
  name: string;
  description?: string;
  icon: BlobRef;
  iconAlt?: string;
  sortOrder: LeaderboardSortOrder;
  scoreFormat: ScoreFormat;
  timeframes: Timeframe[];
  recordPolicy: RecordPolicy;
  scoreMin?: number;
  scoreMax?: number;
  listOrder?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface LeaderboardScoreRecord {
  $type: 'games.opengaming.leaderboard.score';
  leaderboard: string;
  definitionCid?: string;
  game?: string;
  player?: string;
  score: number;
  displayScore?: string;
  tag?: string;
  recordedAt: string;
  signatures?: InlineSignature[];
}

export interface RevocationRecord {
  $type: 'games.opengaming.revocation';
  scope: RevocationScope;
  attestationCid?: string;
  player: string;
  subject: string;
  recordUri?: string;
  before?: string;
  reason: RevocationReason;
  note?: string;
  revokedAt: string;
}

export interface RevocationWithOrigin {
  uri?: string;
  publisherDid: string;
  value: RevocationRecord;
}

export type VerificationErrorCode =
  | 'missing_signatures'
  | 'player_mismatch'
  | 'issuer_mismatch'
  | 'invalid_key_format'
  | 'did_resolution_failed'
  | 'missing_attestation_key'
  | 'cid_mismatch'
  | 'invalid_signature'
  | 'revoked';

export type VerificationResult =
  | {
      verified: true;
      issuerDid: string;
      keyId: string;
      attestationCid: string;
    }
  | {
      verified: false;
      error: VerificationErrorCode;
      message: string;
      issuerDid?: string;
      attestationCid?: string;
      revocation?: RevocationRecord;
    };

export interface TierCounts {
  platinum: number;
  gold: number;
  silver: number;
  bronze: number;
  untiered: number;
}

export interface GameAchievementSummary {
  game: string;
  unlockedCount: number;
  totalAchievements: number;
  completionPercent: number;
  completed: boolean;
  latestUnlockAt?: string;
}

export interface ActorProfileSummary {
  did: string;
  handle?: string;
  gamesPlayed: number;
  completedGames: number;
  totalUnlocks: number;
  tiers: TierCounts;
  games: GameAchievementSummary[];
}
