export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum' | (string & {});

export type LeaderboardSortOrder = 'largerIsBetter' | 'smallerIsBetter' | (string & {});

export type RankingMode = 'best' | 'latest' | (string & {});

export type ScoreFormatKind = 'numeric' | 'time' | 'currency' | (string & {});

export type Timeframe = 'daily' | 'weekly' | 'monthly' | 'allTime';

export type RecordPolicy =
  | 'overwriteBest'
  | 'personalBests'
  | 'perWindowBest'
  | 'everyRun'
  | 'bestOnly';

export type RevocationScope =
  | 'attestation'
  | 'achievement'
  | 'leaderboard'
  | 'match'
  | 'challenge'
  | 'game';

export type RevocationReason =
  | 'cheating'
  | 'exploit'
  | 'bug'
  | 'mistakenGrant'
  | 'accountCompromised'
  | 'requestedByPlayer'
  | 'other'
  | (string & {});

export type ChallengeCadence =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'seasonal'
  | 'event'
  | 'permanent'
  | (string & {});

export type MatchOutcome =
  | 'win'
  | 'loss'
  | 'draw'
  | 'forfeit'
  | 'dnf'
  | 'completed'
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
  rkey?: string;
  cid?: string;
}

export interface ScoreFormat {
  kind: ScoreFormatKind;
  decimalPlaces?: number;
  timeUnit?: 'milliseconds' | 'seconds' | (string & {});
  currencyCode?: string;
  unitSingular?: string;
  unitPlural?: string;
  signedPrefix?: boolean;
}

export interface OptionItem {
  id: string;
  name: string;
}

/** Alias retained for readability across enum component helpers. */
export type EnumOption = OptionItem;

export interface Participant {
  did?: string;
  name?: string;
  role?: string;
  team?: string;
}

export type StringMap = Record<string, string>;

export interface Translation {
  title?: string;
  name?: string;
  description?: string;
  requirement?: string;
}

export type TranslationMap = Record<string, Translation>;

export interface UnlockContext {
  $type: 'games.opengaming.defs#unlockContext';
  summary?: string;
  playtimeMs?: number;
  seed?: string;
  loadout?: string[];
  attributes?: StringMap;
}

export type UnlockDetails =
  | UnlockContext
  | ({
      $type: string;
      [key: string]: unknown;
    });

/* --- Local Multi-Component Leaderboard Schemas (`leaderboard.definition#*` & `leaderboard.score#*`) --- */

export interface PointsComponentDef {
  $type: 'games.opengaming.leaderboard.definition#points';
  name: string;
  sortOrder?: LeaderboardSortOrder;
  minimum?: number;
  maximum?: number;
  unitSingular?: string;
  unitPlural?: string;
}

export interface PercentageComponentDef {
  $type: 'games.opengaming.leaderboard.definition#percentage';
  name: string;
  sortOrder?: LeaderboardSortOrder;
  precision?: number;
  minimum?: number;
  maximum?: number;
}

export interface TimeComponentDef {
  $type: 'games.opengaming.leaderboard.definition#time';
  name: string;
  sortOrder?: LeaderboardSortOrder;
  timeUnit?: 'milliseconds' | 'seconds' | (string & {});
  minimum?: number;
  maximum?: number;
}

export interface EnumComponentDef {
  $type: 'games.opengaming.leaderboard.definition#enum';
  name: string;
  sortOrder?: LeaderboardSortOrder;
  values: OptionItem[];
}

export interface TextComponentDef {
  $type: 'games.opengaming.leaderboard.definition#text';
  name: string;
  maxGraphemes?: number;
}

export type ScoreComponentDef =
  | PointsComponentDef
  | PercentageComponentDef
  | TimeComponentDef
  | EnumComponentDef
  | TextComponentDef;

export type ScoreComponentDefMap = Record<string, ScoreComponentDef>;

export interface PointsComponentVal {
  $type: 'games.opengaming.leaderboard.score#points';
  value: number;
}

export interface PercentageComponentVal {
  $type: 'games.opengaming.leaderboard.score#percentage';
  value: number;
}

export interface TimeComponentVal {
  $type: 'games.opengaming.leaderboard.score#time';
  value: number;
}

export interface EnumComponentVal {
  $type: 'games.opengaming.leaderboard.score#enum';
  value: string;
}

export interface TextComponentVal {
  $type: 'games.opengaming.leaderboard.score#text';
  value: string;
}

export type ScoreComponentVal =
  | PointsComponentVal
  | PercentageComponentVal
  | TimeComponentVal
  | EnumComponentVal
  | TextComponentVal;

export type ScoreComponentValMap = Record<string, ScoreComponentVal>;

/* --- Parameterized Sub-Board Dimensions (`leaderboard.definition#dimension`) --- */

export interface DimensionDef {
  name: string;
  values?: OptionItem[];
  required?: boolean;
  allowCustomValues?: boolean;
  defaultValue?: string;
}

export type DimensionDefMap = Record<string, DimensionDef>;

export interface JudgmentEntry {
  total: number;
  early?: number;
  late?: number;
}

export type JudgmentMap = Record<string, JudgmentEntry>;

export interface JudgmentBreakdown {
  $type: 'games.opengaming.defs#judgmentBreakdown';
  judgments: JudgmentMap;
  judgmentOrder?: string[];
  maxCombo?: number;
  totalEarly?: number;
  totalLate?: number;
  mode?: string;
  inputMethod?: string;
}

export type ScoreDetails =
  | JudgmentBreakdown
  | ({
      $type: string;
      [key: string]: unknown;
    });

/* --- Record Interfaces --- */

export interface AchievementDefinitionRecord {
  $type: 'games.opengaming.achievement.definition';
  game: string;
  title?: string;
  description?: string;
  requirement?: string;
  translations?: TranslationMap;
  icon?: BlobRef;
  iconAlt?: string;
  lockedIcon?: BlobRef;
  tier?: AchievementTier;
  hidden?: boolean;
  hiddenSpace?: string;
  countsTowardCompletion?: boolean;
  repeatable?: boolean;
  availableFrom?: string;
  availableUntil?: string;
  retired?: boolean;
  stepsNeeded?: number;
  group?: string;
  listOrder?: number;
  badge?: string;
  trustedIssuers?: string[];
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
  participants?: Participant[];
  runId?: string;
  details?: UnlockDetails;
  media?: BlobRef;
  mediaAlt?: string;
  note?: string;
  signatures?: InlineSignature[];
}

export interface AchievementProgressRecord {
  $type: 'games.opengaming.achievement.progress';
  achievement: string;
  definitionCid?: string;
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
  translations?: TranslationMap;
  icon: BlobRef;
  iconAlt?: string;
  sortOrder?: LeaderboardSortOrder;
  rankingMode?: RankingMode;
  scoreFormat?: ScoreFormat;
  components?: ScoreComponentDefMap;
  componentOrder?: string[];
  defaultComponent?: string;
  dimensions?: DimensionDefMap;
  dimensionOrder?: string[];
  detailsSchema?: string;
  rankedVersions?: string[];
  trustedIssuers?: string[];
  timeframes: Timeframe[];
  startsAt?: string;
  endsAt?: string;
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
  score?: number;
  displayScore?: string;
  components?: ScoreComponentValMap;
  dimensions?: StringMap;
  seed?: string;
  participants?: Participant[];
  runId?: string;
  details?: ScoreDetails;
  version?: string;
  replay?: BlobRef;
  tag?: string;
  recordedAt: string;
  signatures?: InlineSignature[];
}

export interface ChallengeDefinitionRecord {
  $type: 'games.opengaming.challenge.definition';
  game: string;
  title: string;
  description?: string;
  translations?: TranslationMap;
  icon?: BlobRef;
  iconAlt?: string;
  cadence: ChallengeCadence;
  seed?: string;
  targetSteps?: number;
  leaderboard?: string;
  rewardAchievement?: string;
  dimensions?: StringMap;
  startsAt?: string;
  endsAt?: string;
  trustedIssuers?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface MatchParticipant {
  did?: string;
  name?: string;
  team?: string;
  role?: string;
  character?: string;
  outcome: MatchOutcome;
  placement?: number;
  score?: number;
  scoreText?: string;
  ratingBefore?: number;
  ratingAfter?: number;
  ratingDeviation?: number;
}

export interface MatchRoundResult {
  index: number;
  stage?: string;
  winnerDid?: string;
  winnerTeam?: string;
  summary?: string;
}

export interface MatchSetBreakdown {
  $type: 'games.opengaming.match.result#setBreakdown';
  rounds: MatchRoundResult[];
  notation?: string;
}

export type MatchDetails =
  | MatchSetBreakdown
  | ({
      $type: string;
      [key: string]: unknown;
    });

export interface MatchResultRecord {
  $type: 'games.opengaming.match.result';
  game: string;
  matchId?: string;
  leaderboard?: string;
  challenge?: string;
  mode?: string;
  bestOf?: number;
  durationMs?: number;
  participants: MatchParticipant[];
  dimensions?: StringMap;
  details?: MatchDetails;
  version?: string;
  replay?: BlobRef;
  playedAt: string;
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

/* --- ATProto Labeler Moderation (`com.atproto.label.defs#label`) --- */

export interface AtprotoLabel {
  /** Labeler DID that published the label. */
  src: string;
  /** Target AT-URI (`at://...` record) or actor DID (`did:...`). */
  uri: string;
  /** Optional version CID of the target record. */
  cid?: string;
  /** Label token (e.g. `!cheat`, `exploit`, `invalid-replay`, `verified-replay`). */
  val: string;
  /** If true, negates (removes) a previously applied label with the same `(src, uri, cid, val)`. */
  neg?: boolean;
  /** Timestamp when the label was created. */
  cts: string;
  /** Optional timestamp when the label expires. */
  exp?: string;
}

export type VerificationErrorCode =
  | 'missing_signatures'
  | 'missing_participant_signatures'
  | 'player_mismatch'
  | 'issuer_mismatch'
  | 'rkey_mismatch'
  | 'invalid_key_format'
  | 'did_resolution_failed'
  | 'missing_attestation_key'
  | 'cid_mismatch'
  | 'invalid_signature'
  | 'revoked'
  | 'label_invalidated';

export type VerificationResult =
  | {
      verified: true;
      issuerDid: string;
      keyId: string;
      attestationCid: string;
      verificationMethod?: 'attestation' | 'community-label' | 'multi-participant';
      coSigners?: string[];
    }
  | {
      verified: false;
      error: VerificationErrorCode;
      message: string;
      issuerDid?: string;
      attestationCid?: string;
      revocation?: RevocationRecord;
      labels?: AtprotoLabel[];
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
  bonusUnlockedCount?: number;
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
