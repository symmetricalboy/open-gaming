import { getOrderedComponentIds, serializeDimensionsFilter } from '../leaderboards.js';
import { isCompletionOptional, isWithinTimelock, resolveTranslation } from '../profile.js';
import type {
  AchievementDefinitionRecord,
  ActorProfileSummary,
  LeaderboardDefinitionRecord,
  StringMap,
  Timeframe,
} from '../types.js';
import { OpenGamingAppViewEngine, parseAtUri } from './engine.js';
import type { AppViewIdentityOptions } from './identity.js';
import type {
  ActorGameLibraryItem,
  ActorGameLibraryResponse,
  GameHubView,
  LeaderboardGetScoresResponse,
  LibraryShelfStatus,
  MatchHistoryResponse,
  ViewerAchievementCard,
} from './types.js';

export interface OpenGamingViewerClientOptions {
  /** Base URL of the target Open Gaming AppView (e.g. `'https://opengaming.games'` or `''` for same-origin). */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  defaultLocale?: string;
}

/**
 * Typed frontend & SSR client for web apps consuming an Open Gaming AppView
 * (achievements, gamercards, leaderboards, game catalogs, player game libraries, and PvP matches).
 */
export class OpenGamingViewerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultLocale?: string;

  constructor(options: OpenGamingViewerClientOptions | string) {
    if (typeof options === 'string') {
      this.baseUrl = options.replace(/\/+$/, '');
      this.fetchImpl = globalThis.fetch;
    } else {
      this.baseUrl = options.baseUrl.replace(/\/+$/, '');
      this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
      this.defaultLocale = options.defaultLocale;
    }
  }

  private buildUrl(pathname: string, params?: Record<string, string | number | boolean | undefined>): string {
    const prefix = this.baseUrl ? `${this.baseUrl}${pathname}` : pathname;
    const search = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') {
          search.set(k, String(v));
        }
      }
    }
    const qs = search.toString();
    return qs ? `${prefix}?${qs}` : prefix;
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(url, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      const message = body.message ?? body.error ?? `AppView request failed (${res.status})`;
      throw Object.assign(new Error(message), { status: res.status });
    }
    return (await res.json()) as T;
  }

  /**
   * Fetch a player's XP-free Gamercard (`GET /xrpc/games.opengaming.actor.getProfile`).
   */
  async getActorProfile(actor: string): Promise<ActorProfileSummary> {
    return this.requestJson<ActorProfileSummary>(
      this.buildUrl('/xrpc/games.opengaming.actor.getProfile', { actor })
    );
  }

  /**
   * Fetch ranked leaderboard standings or player PB history (`GET /xrpc/games.opengaming.leaderboard.getScores`).
   */
  async getLeaderboardScores(params: {
    leaderboard: string;
    timeframe?: Timeframe;
    scope?: 'public' | 'social';
    viewer?: string;
    player?: string;
    includeObsolete?: boolean;
    sortBy?: string;
    dimensions?: StringMap | string;
    seed?: string;
    version?: string;
    limit?: number;
    cursor?: string;
    locale?: string;
  }): Promise<LeaderboardGetScoresResponse> {
    const serializedDims =
      typeof params.dimensions === 'string'
        ? params.dimensions
        : serializeDimensionsFilter(params.dimensions);

    return this.requestJson<LeaderboardGetScoresResponse>(
      this.buildUrl('/xrpc/games.opengaming.leaderboard.getScores', {
        leaderboard: params.leaderboard,
        timeframe: params.timeframe,
        scope: params.scope,
        viewer: params.viewer,
        player: params.player,
        includeObsolete: params.includeObsolete ? 'true' : undefined,
        sortBy: params.sortBy,
        dimensions: serializedDims || undefined,
        seed: params.seed,
        version: params.version,
        limit: params.limit,
        cursor: params.cursor,
        locale: params.locale ?? this.defaultLocale,
      })
    );
  }

  /**
   * Fetch a player's unified Game Library & Shelves (`GET /api/library`).
   */
  async getActorLibrary(params: {
    actor: string;
    shelf?: LibraryShelfStatus;
    sortBy?: 'recentActivity' | 'completion' | 'title';
    locale?: string;
  }): Promise<ActorGameLibraryResponse> {
    return this.requestJson<ActorGameLibraryResponse>(
      this.buildUrl('/api/library', {
        actor: params.actor,
        shelf: params.shelf,
        sortBy: params.sortBy,
        locale: params.locale ?? this.defaultLocale,
      })
    );
  }

  /**
   * Fetch all indexed games in the AppView catalog (`GET /api/games`).
   */
  async getGamesCatalog(): Promise<{
    games: Array<{
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
      achievementCount: number;
      leaderboardCount: number;
      activePlayersCount: number;
    }>;
  }> {
    return this.requestJson(this.buildUrl('/api/games'));
  }

  /**
   * Fetch a full Game Hub (`GET /api/game`) including global achievement rarity `%`,
   * spoiler-safe hidden achievement masking, active challenges, leaderboards, and matches.
   */
  async getGameDetail(params: {
    uri: string;
    viewer?: string;
    locale?: string;
  }): Promise<GameHubView> {
    return this.requestJson<GameHubView>(
      this.buildUrl('/api/game', {
        uri: params.uri,
        viewer: params.viewer,
        locale: params.locale ?? this.defaultLocale,
      })
    );
  }

  /**
   * Fetch verified PvP / competitive match history (`GET /api/matches`).
   */
  async getMatchHistory(params?: {
    game?: string;
    actor?: string;
    leaderboard?: string;
    limit?: number;
    cursor?: string;
  }): Promise<MatchHistoryResponse> {
    return this.requestJson<MatchHistoryResponse>(this.buildUrl('/api/matches', params));
  }

  /**
   * Trigger an on-demand PDS backfill on the AppView (`POST /api/sync-repo`).
   */
  async syncRepository(actor: string): Promise<{
    did: string;
    handle?: string;
    pdsUrl: string;
    indexedCounts: Record<string, number>;
    totalIndexed: number;
  }> {
    return this.requestJson(this.buildUrl('/api/sync-repo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor }),
    });
  }

  /**
   * Build a safe AppView blob proxy URL (`/api/blob?did=...&cid=...`) for rendering icons or unlock media.
   */
  getBlobUrl(did: string, cid: string): string {
    return this.buildUrl('/api/blob', { did, cid });
  }
}

/* ============================================================================
 * Serverless Direct-from-PDS Viewer Helper & Headless UI Presentation Helpers
 * ============================================================================ */

/**
 * Serverless viewer helper: resolves `actor` directly against their `#atproto_pds`, discovers all
 * referenced game publisher DIDs, syncs their definitions, cryptographically verifies every record
 * in-memory, and returns both the player's `ActorProfileSummary` and `ActorGameLibraryResponse`
 * — with zero backend server required!
 */
export async function verifyActorDirectFromPds(
  actor: string,
  options?: {
    extraPublisherActors?: string[];
    locale?: string;
    fetchImpl?: typeof fetch;
    identityOptions?: AppViewIdentityOptions;
  }
): Promise<{
  profile: ActorProfileSummary;
  library: ActorGameLibraryResponse;
  engine: OpenGamingAppViewEngine;
}> {
  const engine = new OpenGamingAppViewEngine({
    fetchImpl: options?.fetchImpl,
    identityOptions: options?.identityOptions,
  });

  // 1. Sync player's own PDS repository first to discover referenced publisher DIDs
  const playerSync = await engine.syncActorRepository(actor);
  const publisherDids = new Set<string>(options?.extraPublisherActors ?? []);

  const [unlocks, scores, matches, shelfItems] = await Promise.all([
    engine.store.listUnlocks({ playerDid: playerSync.did }),
    engine.store.listScores({ playerDid: playerSync.did }),
    engine.store.listMatches({ actorDid: playerSync.did }),
    engine.store.listLibraryItemsByPlayer(playerSync.did),
  ]);

  for (const u of unlocks) {
    const owner = parseAtUri(u.record.achievement)?.did;
    if (owner) publisherDids.add(owner);
  }
  for (const s of scores) {
    const owner = parseAtUri(s.record.leaderboard)?.did;
    if (owner) publisherDids.add(owner);
  }
  for (const m of matches) {
    const owner = parseAtUri(m.record.game)?.did;
    if (owner) publisherDids.add(owner);
  }
  for (const item of shelfItems) {
    const owner = parseAtUri(item.gameUri)?.did;
    if (owner) publisherDids.add(owner);
  }

  // 2. Sync discovered game publishers so definitions, bounds, and revocations are loaded
  for (const pubDid of publisherDids) {
    if (pubDid !== playerSync.did) {
      await engine.syncActorRepository(pubDid);
    }
  }

  // 3. Re-index player records now that publisher definitions & trustedIssuers are cached
  for (const u of unlocks) {
    await engine.indexRecord({ uri: u.uri, cid: u.cid, record: u.record });
  }
  for (const s of scores) {
    await engine.indexRecord({ uri: s.uri, cid: s.cid, record: s.record });
  }

  const [profile, library] = await Promise.all([
    engine.getActorProfile(playerSync.did),
    engine.getActorLibrary({ actor: playerSync.did, locale: options?.locale }),
  ]);

  return { profile, library, engine };
}

/**
 * Headless UI helper: mask spoiler-sensitive fields (`title`, `description`, `requirement`, `tooltip`)
 * on a raw `AchievementDefinitionRecord` unless unlocked by the viewing player.
 */
export function maskAchievementForViewer(
  uri: string,
  definition: AchievementDefinitionRecord,
  options?: {
    viewerUnlocked?: boolean;
    locale?: string;
    now?: Date;
  }
): Pick<
  ViewerAchievementCard,
  | 'uri'
  | 'title'
  | 'description'
  | 'requirement'
  | 'tooltip'
  | 'isMaskedSpoiler'
  | 'completionOptional'
  | 'timelockActive'
> {
  const viewerUnlocked = Boolean(options?.viewerUnlocked);
  const isMaskedSpoiler = Boolean(definition.hidden && !viewerUnlocked);
  const localized = resolveTranslation(definition, options?.locale);
  const nowIso = (options?.now ?? new Date()).toISOString();

  if (isMaskedSpoiler) {
    return {
      uri,
      title: 'Hidden Achievement',
      description: definition.hiddenSpace
        ? 'Spoiler-protected stub — unlock in-game to reveal details.'
        : 'Keep playing to discover and unlock this hidden milestone.',
      isMaskedSpoiler: true,
      completionOptional: isCompletionOptional(definition),
      timelockActive: isWithinTimelock(nowIso, definition.timelocked),
    };
  }

  return {
    uri,
    title: localized.title ?? definition.title ?? 'Hidden Achievement',
    description: localized.description ?? definition.description ?? '',
    ...(localized.requirement ? { requirement: localized.requirement } : {}),
    ...(localized.tooltip ? { tooltip: localized.tooltip } : {}),
    isMaskedSpoiler: false,
    completionOptional: isCompletionOptional(definition),
    timelockActive: isWithinTimelock(nowIso, definition.timelocked),
  };
}

/**
 * Headless UI helper: group `ActorGameLibraryItem[]` into ordered shelves for rendering library tabs or sections.
 */
export function groupLibraryByShelf(
  items: ActorGameLibraryItem[]
): Array<{ shelf: LibraryShelfStatus; items: ActorGameLibraryItem[] }> {
  const preferredOrder: LibraryShelfStatus[] = [
    'playing',
    'completed',
    'backlog',
    'wishlist',
    'owned',
    'shelved',
    'dropped',
  ];
  const buckets = new Map<string, ActorGameLibraryItem[]>();
  for (const item of items) {
    const list = buckets.get(item.shelfStatus) ?? [];
    list.push(item);
    buckets.set(item.shelfStatus, list);
  }

  const ordered: Array<{ shelf: LibraryShelfStatus; items: ActorGameLibraryItem[] }> = [];
  for (const s of preferredOrder) {
    const list = buckets.get(s);
    if (list && list.length > 0) {
      ordered.push({ shelf: s, items: list });
      buckets.delete(s);
    }
  }
  for (const [s, list] of buckets.entries()) {
    if (list.length > 0) {
      ordered.push({ shelf: s, items: list });
    }
  }
  return ordered;
}

/**
 * Headless UI helper: build ordered table column descriptors for either a classic single-integer
 * leaderboard or a local multi-component (`#points`, `#percentage`, `#time`, `#enum`, `#text`) leaderboard.
 */
export function buildLeaderboardColumns(definition: LeaderboardDefinitionRecord): Array<{
  id: string;
  label: string;
  sortable: boolean;
  isDefaultSort: boolean;
}> {
  const orderedIds = getOrderedComponentIds(definition);
  if (orderedIds.length === 0 || !definition.components) {
    return [
      {
        id: 'score',
        label: 'Score',
        sortable: true,
        isDefaultSort: true,
      },
    ];
  }

  const defaultSortId = definition.defaultComponent ?? orderedIds[0];
  return orderedIds.map((id) => {
    const def = definition.components![id];
    const sortable = def.$type !== 'games.opengaming.leaderboard.definition#text';
    return {
      id,
      label: def.name,
      sortable,
      isDefaultSort: id === defaultSortId && sortable,
    };
  });
}
