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
}

/* --- Multi-Component Leaderboard Definitions & Values (Forward-Compatible Lexicon Map Convention) --- */

export interface EnumOption {
  id: string;
  name: string;
}

export interface PointsComponentDef {
  $type: 'games.opengaming.defs#pointsComponentDef';
  name: string;
  sortOrder?: LeaderboardSortOrder;
  minimum?: number;
  maximum?: number;
  unitSingular?: string;
  unitPlural?: string;
}

export interface PercentageComponentDef {
  $type: 'games.opengaming.defs#percentageComponentDef';
  name: string;
  sortOrder?: LeaderboardSortOrder;
  precision?: number;
  minimum?: number;
  maximum?: number;
}

export interface TimeComponentDef {
  $type: 'games.opengaming.defs#timeComponentDef';
  name: string;
  sortOrder?: LeaderboardSortOrder;
  timeUnit?: 'milliseconds' | 'seconds' | (string & {});
  minimum?: number;
  maximum?: number;
}

export interface EnumComponentDef {
  $type: 'games.opengaming.defs#enumComponentDef';
  name: string;
  sortOrder?: LeaderboardSortOrder;
  values: EnumOption[];
}

export interface TextComponentDef {
  $type: 'games.opengaming.defs#textComponentDef';
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
  $type: 'games.opengaming.defs#pointsComponentVal';
  value: number;
}

export interface PercentageComponentVal {
  $type: 'games.opengaming.defs#percentageComponentVal';
  value: number;
}

export interface TimeComponentVal {
  $type: 'games.opengaming.defs#timeComponentVal';
  value: number;
}

export interface EnumComponentVal {
  $type: 'games.opengaming.defs#enumComponentVal';
  value: string;
}

export interface TextComponentVal {
  $type: 'games.opengaming.defs#textComponentVal';
  value: string;
}

export type ScoreComponentVal =
  | PointsComponentVal
  | PercentageComponentVal
  | TimeComponentVal
  | EnumComponentVal
  | TextComponentVal;

export type ScoreComponentValMap = Record<string, ScoreComponentVal>;

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
  icon?: BlobRef;
  iconAlt?: string;
  lockedIcon?: BlobRef;
  tier?: AchievementTier;
  hidden?: boolean;
  hiddenSpace?: string;
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
  icon: BlobRef;
  iconAlt?: string;
  sortOrder?: LeaderboardSortOrder;
  scoreFormat?: ScoreFormat;
  components?: ScoreComponentDefMap;
  componentOrder?: string[];
  defaultComponent?: string;
  detailsSchema?: string;
  rankedVersions?: string[];
  trustedIssuers?: string[];
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
  score?: number;
  displayScore?: string;
  components?: ScoreComponentValMap;
  details?: ScoreDetails;
  version?: string;
  replay?: BlobRef;
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
      verificationMethod?: 'attestation' | 'community-label';
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
