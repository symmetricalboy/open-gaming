import type {
  AchievementDefinitionRecord,
  AchievementProgressRecord,
  AchievementUnlockRecord,
  ActorProfileSummary,
  AtprotoLabel,
  ChallengeDefinitionRecord,
  GameAchievementSummary,
  LeaderboardDefinitionRecord,
  LeaderboardScoreRecord,
  MatchParticipant,
  MatchResultRecord,
  Participant,
  RankingMode,
  RevocationRecord,
  ScoreComponentValMap,
  ScoreFormat,
  StringMap,
  TimeRange,
  Timeframe,
  VerificationErrorCode,
} from '../types.js';
import { NSIDS } from '../constants.js';

export type MaybePromise<T> = T | Promise<T>;

export const DEFAULT_CATALOG_COLLECTIONS = [
  'games.atmosphere.define',
  'games.gamesgamesgamesgames.game',
] as const;

export const DEFAULT_LIBRARY_COLLECTIONS = [
  'games.atmosphere.library.item',
  'games.atmosphere.library',
  'games.gamesgamesgamesgames.library.item',
  'games.gamesgamesgamesgames.collection.item',
] as const;

export const DEFAULT_APPVIEW_COLLECTIONS = [
  ...DEFAULT_CATALOG_COLLECTIONS,
  ...DEFAULT_LIBRARY_COLLECTIONS,
  NSIDS.AchievementDefinition,
  NSIDS.LeaderboardDefinition,
  NSIDS.ChallengeDefinition,
  NSIDS.Revocation,
  NSIDS.AchievementUnlock,
  NSIDS.AchievementProgress,
  NSIDS.LeaderboardScore,
  NSIDS.MatchResult,
] as const;

export type LibraryShelfStatus =
  | 'playing'
  | 'completed'
  | 'backlog'
  | 'wishlist'
  | 'shelved'
  | 'dropped'
  | 'owned'
  | (string & {});

export type LibraryItemSource = 'shelf' | 'achievements' | 'leaderboards' | 'matches';

export interface StoredActor {
  did: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  pdsUrl?: string;
  didDoc?: Record<string, unknown>;
  updatedAt: string;
}

export interface StoredGameCatalogEntry {
  uri: string;
  publisherDid: string;
  rkey: string;
  cid?: string;
  name: string;
  tagline?: string;
  description?: string;
  url?: string;
  category?: string;
  status?: string;
  iconCid?: string;
  iconMime?: string;
  iconUrl?: string;
  developerName?: string;
  developerDid?: string;
  rawRecord: Record<string, unknown>;
  indexedAt: string;
}

export interface StoredLibraryItem {
  uri: string;
  playerDid: string;
  collection: string;
  rkey: string;
  cid?: string;
  gameUri: string;
  status: LibraryShelfStatus;
  favorite?: boolean;
  rating?: number;
  playtimeMs?: number;
  note?: string;
  addedAt: string;
  rawRecord: Record<string, unknown>;
  indexedAt: string;
}

export interface StoredDefinitionRecord<T> {
  uri: string;
  publisherDid: string;
  rkey: string;
  cid?: string;
  gameUri: string;
  record: T;
  indexedAt: string;
}

export interface StoredVerifiedRecord<T> {
  uri: string;
  repositoryDid: string;
  rkey: string;
  cid?: string;
  gameUri?: string;
  record: T;
  verified: boolean;
  verificationMethod?: 'attestation' | 'community-label' | 'multi-participant';
  verificationError?: VerificationErrorCode;
  verificationMessage?: string;
  issuerDid?: string;
  keyId?: string;
  attestationCid?: string;
  coSigners?: string[];
  revoked: boolean;
  revocationReason?: string;
  labelInvalidated: boolean;
  activeLabels: string[];
  indexedAt: string;
}

export interface StoredRevocation {
  uri: string;
  publisherDid: string;
  rkey: string;
  cid?: string;
  record: RevocationRecord;
  indexedAt: string;
}

/**
 * Pluggable persistence interface for an Open Gaming AppView.
 * Supports both synchronous stores (in-memory, `node:sqlite`) and asynchronous stores
 * (PostgreSQL, Turso/libSQL, Cloudflare D1, Prisma, Drizzle, Redis).
 */
export interface AppViewStorageAdapter {
  getSyncCursor(key: string): MaybePromise<string | undefined>;
  setSyncCursor(key: string, value: string): MaybePromise<void>;

  getActor(identifier: string): MaybePromise<StoredActor | null>;
  upsertActor(actor: StoredActor): MaybePromise<void>;

  getFollows(followerDid: string): MaybePromise<string[]>;
  setFollows(followerDid: string, subjectDids: string[]): MaybePromise<void>;

  getGame(uri: string): MaybePromise<StoredGameCatalogEntry | null>;
  listGames(): MaybePromise<StoredGameCatalogEntry[]>;
  upsertGame(game: StoredGameCatalogEntry): MaybePromise<void>;
  deleteGame(uri: string): MaybePromise<boolean>;

  listLibraryItemsByPlayer(playerDid: string): MaybePromise<StoredLibraryItem[]>;
  listLibraryItemsByGame(gameUri: string): MaybePromise<StoredLibraryItem[]>;
  upsertLibraryItem(item: StoredLibraryItem): MaybePromise<void>;
  deleteLibraryItem(uri: string): MaybePromise<boolean>;

  getAchievementDefinition(uri: string): MaybePromise<StoredDefinitionRecord<AchievementDefinitionRecord> | null>;
  listAchievementDefinitions(gameUri?: string): MaybePromise<StoredDefinitionRecord<AchievementDefinitionRecord>[]>;
  upsertAchievementDefinition(def: StoredDefinitionRecord<AchievementDefinitionRecord>): MaybePromise<void>;
  deleteAchievementDefinition(uri: string): MaybePromise<boolean>;

  getLeaderboardDefinition(uri: string): MaybePromise<StoredDefinitionRecord<LeaderboardDefinitionRecord> | null>;
  listLeaderboardDefinitions(gameUri?: string): MaybePromise<StoredDefinitionRecord<LeaderboardDefinitionRecord>[]>;
  upsertLeaderboardDefinition(def: StoredDefinitionRecord<LeaderboardDefinitionRecord>): MaybePromise<void>;
  deleteLeaderboardDefinition(uri: string): MaybePromise<boolean>;

  getChallengeDefinition(uri: string): MaybePromise<StoredDefinitionRecord<ChallengeDefinitionRecord> | null>;
  listChallengeDefinitions(gameUri?: string): MaybePromise<StoredDefinitionRecord<ChallengeDefinitionRecord>[]>;
  upsertChallengeDefinition(def: StoredDefinitionRecord<ChallengeDefinitionRecord>): MaybePromise<void>;
  deleteChallengeDefinition(uri: string): MaybePromise<boolean>;

  getUnlock(uri: string): MaybePromise<StoredVerifiedRecord<AchievementUnlockRecord> | null>;
  listUnlocks(filter?: {
    playerDid?: string;
    achievementUri?: string;
    gameUri?: string;
    publisherDids?: string[];
    verifiedOnly?: boolean;
  }): MaybePromise<StoredVerifiedRecord<AchievementUnlockRecord>[]>;
  upsertUnlock(unlock: StoredVerifiedRecord<AchievementUnlockRecord>): MaybePromise<void>;
  deleteUnlock(uri: string): MaybePromise<boolean>;

  listProgress(filter?: {
    playerDid?: string;
    achievementUri?: string;
    gameUri?: string;
  }): MaybePromise<StoredVerifiedRecord<AchievementProgressRecord>[]>;
  upsertProgress(progress: StoredVerifiedRecord<AchievementProgressRecord>): MaybePromise<void>;
  deleteProgress(uri: string): MaybePromise<boolean>;

  getScore(uri: string): MaybePromise<StoredVerifiedRecord<LeaderboardScoreRecord> | null>;
  listScores(filter?: {
    leaderboardUri?: string;
    playerDid?: string;
    gameUri?: string;
    publisherDids?: string[];
    verifiedOnly?: boolean;
  }): MaybePromise<StoredVerifiedRecord<LeaderboardScoreRecord>[]>;
  upsertScore(score: StoredVerifiedRecord<LeaderboardScoreRecord>): MaybePromise<void>;
  deleteScore(uri: string): MaybePromise<boolean>;

  getMatch(uri: string): MaybePromise<StoredVerifiedRecord<MatchResultRecord> | null>;
  listMatches(filter?: {
    gameUri?: string;
    actorDid?: string;
    leaderboardUri?: string;
    publisherDids?: string[];
    verifiedOnly?: boolean;
  }): MaybePromise<StoredVerifiedRecord<MatchResultRecord>[]>;
  upsertMatch(match: StoredVerifiedRecord<MatchResultRecord>): MaybePromise<void>;
  deleteMatch(uri: string): MaybePromise<boolean>;

  getRevocation(uri: string): MaybePromise<StoredRevocation | null>;
  listRevocations(publisherDids?: string[]): MaybePromise<StoredRevocation[]>;
  upsertRevocation(revocation: StoredRevocation): MaybePromise<void>;
  deleteRevocation(uri: string): MaybePromise<boolean>;

  listLabelEvents(targetUris?: string[]): MaybePromise<AtprotoLabel[]>;
  appendLabelEvent(label: AtprotoLabel): MaybePromise<void>;
}

/* --- XRPC & Rich Viewer Response Schemas --- */

export interface LeaderboardScoreViewEntry {
  rank: number;
  player: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  uri: string;
  attestationCid?: string;
  issuer?: string;
  score: number;
  displayScore?: string;
  components?: ScoreComponentValMap;
  dimensions?: StringMap;
  seed?: string;
  participants?: Participant[];
  runId?: string;
  version?: string;
  hasReplay?: boolean;
  replayCid?: string;
  tag?: string;
  labels?: string[];
  recordedAt: string;
  verified: boolean;
  obsolete?: boolean;
  revoked?: boolean;
}

export interface LeaderboardGetScoresResponse {
  leaderboard: string;
  sortedBy?: string;
  rankingMode?: RankingMode;
  entries: LeaderboardScoreViewEntry[];
  viewerEntry?: LeaderboardScoreViewEntry;
  cursor?: string;
}

export interface ActorLibraryPersonalBest {
  leaderboardUri: string;
  leaderboardName: string;
  score: number;
  displayScore: string;
  recordedAt: string;
}

export interface ActorGameLibraryItem {
  gameUri: string;
  name: string;
  tagline?: string;
  description?: string;
  iconUrl?: string;
  url?: string;
  developerName?: string;
  shelfStatus: LibraryShelfStatus;
  favorite?: boolean;
  rating?: number;
  playtimeMs?: number;
  shelfNote?: string;
  shelfRecordUri?: string;
  sources: LibraryItemSource[];
  achievements: GameAchievementSummary;
  personalBests: ActorLibraryPersonalBest[];
  matchesPlayed: number;
  matchWins: number;
  lastActivityAt?: string;
}

export interface ActorGameLibraryResponse {
  did: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  totalGames: number;
  shelves: Record<string, number>;
  items: ActorGameLibraryItem[];
}

export interface ViewerAchievementCard {
  uri: string;
  game: string;
  title: string;
  description: string;
  requirement?: string;
  tooltip?: string;
  iconUrl?: string;
  iconAlt?: string;
  tier?: string;
  hidden: boolean;
  hiddenSpace?: string;
  isMaskedSpoiler: boolean;
  completionOptional: boolean;
  repeatable: boolean;
  retired: boolean;
  timelocked?: TimeRange[];
  timelockActive: boolean;
  stepsNeeded?: number;
  group?: string;
  listOrder?: number;
  unlockedPlayersCount: number;
  rarityPercent: number;
  viewerUnlocked: boolean;
  viewerUnlockedAt?: string;
  viewerUnlockUri?: string;
  viewerCurrentSteps?: number;
}

export interface GameHubLeaderboardSummary {
  uri: string;
  name: string;
  description?: string;
  iconUrl?: string;
  sortOrder: string;
  rankingMode: RankingMode;
  scoreFormat?: ScoreFormat;
  timeframes: Timeframe[];
  recordPolicy: string;
  totalVerifiedEntries: number;
}

export interface GameHubView {
  game: {
    uri: string;
    publisherDid: string;
    name: string;
    tagline?: string;
    description?: string;
    url?: string;
    category?: string;
    status?: string;
    iconUrl?: string;
    developerName?: string;
    totalPlayers: number;
  };
  viewerCompletion?: GameAchievementSummary;
  achievements: ViewerAchievementCard[];
  leaderboards: GameHubLeaderboardSummary[];
  challenges: Array<{
    uri: string;
    title: string;
    description?: string;
    cadence: string;
    seed?: string;
    leaderboard?: string;
    rewardAchievement?: string;
    startsAt?: string;
    endsAt?: string;
    active: boolean;
  }>;
  recentMatches: MatchHistoryEntry[];
}

export interface MatchHistoryEntry {
  uri: string;
  gameUri: string;
  gameName?: string;
  matchId?: string;
  mode?: string;
  leaderboardUri?: string;
  participants: Array<
    MatchParticipant & {
      handle?: string;
      displayName?: string;
      avatarUrl?: string;
    }
  >;
  playedAt: string;
  verified: boolean;
  verificationMethod?: 'attestation' | 'community-label' | 'multi-participant';
  attestationCid?: string;
}

export interface MatchHistoryResponse {
  matches: MatchHistoryEntry[];
  cursor?: string;
}

export type { ActorProfileSummary };
