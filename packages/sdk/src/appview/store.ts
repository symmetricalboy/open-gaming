import type {
  AchievementDefinitionRecord,
  AchievementProgressRecord,
  AchievementUnlockRecord,
  AtprotoLabel,
  ChallengeDefinitionRecord,
  LeaderboardDefinitionRecord,
  LeaderboardScoreRecord,
  MatchResultRecord,
} from '../types.js';
import type {
  AppViewStorageAdapter,
  StoredActor,
  StoredDefinitionRecord,
  StoredGameCatalogEntry,
  StoredLibraryItem,
  StoredRevocation,
  StoredVerifiedRecord,
} from './types.js';

function uriStartsWithAnyDid(uri: string | undefined, dids: Set<string>): boolean {
  if (!uri || !uri.startsWith('at://')) return false;
  const host = uri.slice('at://'.length).split('/')[0];
  return Boolean(host && dids.has(host));
}

/**
 * Zero-dependency in-memory `AppViewStorageAdapter` implementation.
 * Ideal for edge deployments, ephemeral caches, local development, and automated test suites.
 * Supports JSON snapshot export/import via `toSnapshot()` / `loadSnapshot()`.
 */
export class MemoryAppViewStore implements AppViewStorageAdapter {
  private cursors = new Map<string, string>();
  private actors = new Map<string, StoredActor>();
  private handles = new Map<string, string>();
  private follows = new Map<string, Set<string>>();
  private games = new Map<string, StoredGameCatalogEntry>();
  private libraryItems = new Map<string, StoredLibraryItem>();
  private achievementDefs = new Map<string, StoredDefinitionRecord<AchievementDefinitionRecord>>();
  private leaderboardDefs = new Map<string, StoredDefinitionRecord<LeaderboardDefinitionRecord>>();
  private challengeDefs = new Map<string, StoredDefinitionRecord<ChallengeDefinitionRecord>>();
  private unlocks = new Map<string, StoredVerifiedRecord<AchievementUnlockRecord>>();
  private progress = new Map<string, StoredVerifiedRecord<AchievementProgressRecord>>();
  private scores = new Map<string, StoredVerifiedRecord<LeaderboardScoreRecord>>();
  private matches = new Map<string, StoredVerifiedRecord<MatchResultRecord>>();
  private revocations = new Map<string, StoredRevocation>();
  private labelEvents: AtprotoLabel[] = [];

  getSyncCursor(key: string): string | undefined {
    return this.cursors.get(key);
  }

  setSyncCursor(key: string, value: string): void {
    this.cursors.set(key, value);
  }

  getActor(identifier: string): StoredActor | null {
    const clean = identifier.trim().replace(/^@/, '');
    if (clean.startsWith('did:')) {
      return this.actors.get(clean) ?? null;
    }
    const did = this.handles.get(clean.toLowerCase());
    return did ? (this.actors.get(did) ?? null) : null;
  }

  upsertActor(actor: StoredActor): void {
    const prev = this.actors.get(actor.did);
    const merged: StoredActor = {
      did: actor.did,
      handle: actor.handle ?? prev?.handle,
      displayName: actor.displayName ?? prev?.displayName,
      avatarUrl: actor.avatarUrl ?? prev?.avatarUrl,
      pdsUrl: actor.pdsUrl ?? prev?.pdsUrl,
      didDoc: actor.didDoc ?? prev?.didDoc,
      updatedAt: actor.updatedAt,
    };
    this.actors.set(actor.did, merged);
    if (merged.handle) {
      this.handles.set(merged.handle.toLowerCase(), actor.did);
    }
  }

  getFollows(followerDid: string): string[] {
    return [...(this.follows.get(followerDid) ?? [])];
  }

  setFollows(followerDid: string, subjectDids: string[]): void {
    this.follows.set(followerDid, new Set(subjectDids));
  }

  getGame(uri: string): StoredGameCatalogEntry | null {
    return this.games.get(uri) ?? null;
  }

  listGames(): StoredGameCatalogEntry[] {
    return [...this.games.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  upsertGame(game: StoredGameCatalogEntry): void {
    this.games.set(game.uri, game);
  }

  deleteGame(uri: string): boolean {
    return this.games.delete(uri);
  }

  listLibraryItemsByPlayer(playerDid: string): StoredLibraryItem[] {
    return [...this.libraryItems.values()].filter((i) => i.playerDid === playerDid);
  }

  listLibraryItemsByGame(gameUri: string): StoredLibraryItem[] {
    return [...this.libraryItems.values()].filter((i) => i.gameUri === gameUri);
  }

  upsertLibraryItem(item: StoredLibraryItem): void {
    this.libraryItems.set(item.uri, item);
  }

  deleteLibraryItem(uri: string): boolean {
    return this.libraryItems.delete(uri);
  }

  getAchievementDefinition(uri: string): StoredDefinitionRecord<AchievementDefinitionRecord> | null {
    return this.achievementDefs.get(uri) ?? null;
  }

  listAchievementDefinitions(gameUri?: string): StoredDefinitionRecord<AchievementDefinitionRecord>[] {
    const all = [...this.achievementDefs.values()];
    return gameUri ? all.filter((d) => d.gameUri === gameUri) : all;
  }

  upsertAchievementDefinition(def: StoredDefinitionRecord<AchievementDefinitionRecord>): void {
    this.achievementDefs.set(def.uri, def);
  }

  deleteAchievementDefinition(uri: string): boolean {
    return this.achievementDefs.delete(uri);
  }

  getLeaderboardDefinition(uri: string): StoredDefinitionRecord<LeaderboardDefinitionRecord> | null {
    return this.leaderboardDefs.get(uri) ?? null;
  }

  listLeaderboardDefinitions(gameUri?: string): StoredDefinitionRecord<LeaderboardDefinitionRecord>[] {
    const all = [...this.leaderboardDefs.values()];
    return gameUri ? all.filter((d) => d.gameUri === gameUri) : all;
  }

  upsertLeaderboardDefinition(def: StoredDefinitionRecord<LeaderboardDefinitionRecord>): void {
    this.leaderboardDefs.set(def.uri, def);
  }

  deleteLeaderboardDefinition(uri: string): boolean {
    return this.leaderboardDefs.delete(uri);
  }

  getChallengeDefinition(uri: string): StoredDefinitionRecord<ChallengeDefinitionRecord> | null {
    return this.challengeDefs.get(uri) ?? null;
  }

  listChallengeDefinitions(gameUri?: string): StoredDefinitionRecord<ChallengeDefinitionRecord>[] {
    const all = [...this.challengeDefs.values()];
    return gameUri ? all.filter((d) => d.gameUri === gameUri) : all;
  }

  upsertChallengeDefinition(def: StoredDefinitionRecord<ChallengeDefinitionRecord>): void {
    this.challengeDefs.set(def.uri, def);
  }

  deleteChallengeDefinition(uri: string): boolean {
    return this.challengeDefs.delete(uri);
  }

  getUnlock(uri: string): StoredVerifiedRecord<AchievementUnlockRecord> | null {
    return this.unlocks.get(uri) ?? null;
  }

  listUnlocks(filter?: {
    playerDid?: string;
    achievementUri?: string;
    gameUri?: string;
    publisherDids?: string[];
    verifiedOnly?: boolean;
  }): StoredVerifiedRecord<AchievementUnlockRecord>[] {
    let items = [...this.unlocks.values()];
    if (!filter) return items;
    if (filter.playerDid) {
      items = items.filter((u) => u.repositoryDid === filter.playerDid);
    }
    if (filter.achievementUri) {
      items = items.filter((u) => u.record.achievement === filter.achievementUri);
    }
    if (filter.gameUri) {
      items = items.filter((u) => u.gameUri === filter.gameUri || u.record.game === filter.gameUri);
    }
    if (filter.publisherDids && filter.publisherDids.length > 0) {
      const pubSet = new Set(filter.publisherDids);
      items = items.filter(
        (u) =>
          (u.issuerDid && pubSet.has(u.issuerDid)) ||
          uriStartsWithAnyDid(u.record.achievement, pubSet)
      );
    }
    if (filter.verifiedOnly) {
      items = items.filter((u) => u.verified && !u.revoked);
    }
    return items;
  }

  upsertUnlock(unlock: StoredVerifiedRecord<AchievementUnlockRecord>): void {
    this.unlocks.set(unlock.uri, unlock);
  }

  deleteUnlock(uri: string): boolean {
    return this.unlocks.delete(uri);
  }

  listProgress(filter?: {
    playerDid?: string;
    achievementUri?: string;
    gameUri?: string;
  }): StoredVerifiedRecord<AchievementProgressRecord>[] {
    let items = [...this.progress.values()];
    if (!filter) return items;
    if (filter.playerDid) {
      items = items.filter((p) => p.repositoryDid === filter.playerDid);
    }
    if (filter.achievementUri) {
      items = items.filter((p) => p.record.achievement === filter.achievementUri);
    }
    if (filter.gameUri) {
      items = items.filter((p) => p.gameUri === filter.gameUri || p.record.game === filter.gameUri);
    }
    return items;
  }

  upsertProgress(progress: StoredVerifiedRecord<AchievementProgressRecord>): void {
    this.progress.set(progress.uri, progress);
  }

  deleteProgress(uri: string): boolean {
    return this.progress.delete(uri);
  }

  getScore(uri: string): StoredVerifiedRecord<LeaderboardScoreRecord> | null {
    return this.scores.get(uri) ?? null;
  }

  listScores(filter?: {
    leaderboardUri?: string;
    playerDid?: string;
    gameUri?: string;
    publisherDids?: string[];
    verifiedOnly?: boolean;
  }): StoredVerifiedRecord<LeaderboardScoreRecord>[] {
    let items = [...this.scores.values()];
    if (!filter) return items;
    if (filter.leaderboardUri) {
      items = items.filter((s) => s.record.leaderboard === filter.leaderboardUri);
    }
    if (filter.playerDid) {
      items = items.filter(
        (s) =>
          s.repositoryDid === filter.playerDid ||
          Boolean(s.record.participants?.some((p) => p.did === filter.playerDid))
      );
    }
    if (filter.gameUri) {
      items = items.filter((s) => s.gameUri === filter.gameUri || s.record.game === filter.gameUri);
    }
    if (filter.publisherDids && filter.publisherDids.length > 0) {
      const pubSet = new Set(filter.publisherDids);
      items = items.filter(
        (s) =>
          (s.issuerDid && pubSet.has(s.issuerDid)) ||
          uriStartsWithAnyDid(s.record.leaderboard, pubSet)
      );
    }
    if (filter.verifiedOnly) {
      items = items.filter((s) => s.verified && !s.revoked);
    }
    return items;
  }

  upsertScore(score: StoredVerifiedRecord<LeaderboardScoreRecord>): void {
    this.scores.set(score.uri, score);
  }

  deleteScore(uri: string): boolean {
    return this.scores.delete(uri);
  }

  getMatch(uri: string): StoredVerifiedRecord<MatchResultRecord> | null {
    return this.matches.get(uri) ?? null;
  }

  listMatches(filter?: {
    gameUri?: string;
    actorDid?: string;
    leaderboardUri?: string;
    publisherDids?: string[];
    verifiedOnly?: boolean;
  }): StoredVerifiedRecord<MatchResultRecord>[] {
    let items = [...this.matches.values()];
    if (!filter) return items;
    if (filter.gameUri) {
      items = items.filter((m) => m.record.game === filter.gameUri);
    }
    if (filter.leaderboardUri) {
      items = items.filter((m) => m.record.leaderboard === filter.leaderboardUri);
    }
    if (filter.actorDid) {
      items = items.filter(
        (m) =>
          m.repositoryDid === filter.actorDid ||
          m.record.participants.some((p) => p.did === filter.actorDid)
      );
    }
    if (filter.publisherDids && filter.publisherDids.length > 0) {
      const pubSet = new Set(filter.publisherDids);
      items = items.filter(
        (m) =>
          (m.issuerDid && pubSet.has(m.issuerDid)) ||
          uriStartsWithAnyDid(m.record.game, pubSet)
      );
    }
    if (filter.verifiedOnly) {
      items = items.filter((m) => m.verified && !m.revoked);
    }
    return items;
  }

  upsertMatch(match: StoredVerifiedRecord<MatchResultRecord>): void {
    this.matches.set(match.uri, match);
  }

  deleteMatch(uri: string): boolean {
    return this.matches.delete(uri);
  }

  getRevocation(uri: string): StoredRevocation | null {
    return this.revocations.get(uri) ?? null;
  }

  listRevocations(publisherDids?: string[]): StoredRevocation[] {
    const all = [...this.revocations.values()];
    if (!publisherDids || publisherDids.length === 0) return all;
    const pubSet = new Set(publisherDids);
    return all.filter((r) => pubSet.has(r.publisherDid));
  }

  upsertRevocation(revocation: StoredRevocation): void {
    this.revocations.set(revocation.uri, revocation);
  }

  deleteRevocation(uri: string): boolean {
    return this.revocations.delete(uri);
  }

  listLabelEvents(targetUris?: string[]): AtprotoLabel[] {
    if (!targetUris || targetUris.length === 0) {
      return [...this.labelEvents];
    }
    const uriSet = new Set(targetUris);
    return this.labelEvents.filter((l) => uriSet.has(l.uri));
  }

  appendLabelEvent(label: AtprotoLabel): void {
    this.labelEvents.push(label);
  }
}
