import { DidResolver, HandleResolver } from '@atproto/identity';
import type { AppDatabase } from './db.js';

export interface ResolvedActorInfo {
  did: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  pdsUrl?: string;
  didDoc?: Record<string, unknown>;
}

const BSKY_PUBLIC_API = 'https://public.api.bsky.app';

function extractPdsFromDidDoc(didDoc?: Record<string, unknown> | null): string | undefined {
  if (!didDoc) return undefined;
  const services = didDoc.service;
  if (Array.isArray(services)) {
    const match = services.find(
      (s: any) =>
        s?.id === '#atproto_pds' ||
        (typeof s?.id === 'string' && s.id.endsWith('#atproto_pds')) ||
        s?.type === 'AtprotoPersonalDataServer'
    ) as { serviceEndpoint?: string } | undefined;
    if (typeof match?.serviceEndpoint === 'string') {
      return match.serviceEndpoint.replace(/\/+$/, '');
    }
  }
  return undefined;
}

function extractHandleFromDidDoc(didDoc?: Record<string, unknown> | null): string | undefined {
  if (!didDoc) return undefined;
  const aka = didDoc.alsoKnownAs;
  if (Array.isArray(aka)) {
    const atEntry = aka.find((item) => typeof item === 'string' && item.startsWith('at://')) as string | undefined;
    if (atEntry) {
      return atEntry.slice('at://'.length);
    }
  }
  return undefined;
}

export class IdentityService {
  private didResolver: DidResolver;
  private handleResolver: HandleResolver;
  private followsCache = new Map<string, { expiresAt: number; dids: Set<string> }>();

  constructor(
    private db: AppDatabase,
    options?: { plcUrl?: string; enableNetwork?: boolean }
  ) {
    this.didResolver = new DidResolver({
      plcUrl: options?.plcUrl ?? process.env.PLC_DIRECTORY_URL ?? 'https://plc.directory',
    });
    this.handleResolver = new HandleResolver({});
    this.enableNetwork = options?.enableNetwork ?? process.env.DISABLE_NETWORK_IDENTITY !== 'true';
  }

  private enableNetwork: boolean;

  /**
   * Look up cached actor record from SQLite by DID or handle.
   */
  getCachedActor(identifier: string): ResolvedActorInfo | null {
    const normalized = identifier.trim().replace(/^@/, '');
    const row = normalized.startsWith('did:')
      ? (this.db.prepare('SELECT * FROM actors WHERE did = ?').get(normalized) as Record<string, any> | undefined)
      : (this.db
          .prepare('SELECT * FROM actors WHERE LOWER(handle) = LOWER(?)')
          .get(normalized) as Record<string, any> | undefined);

    if (!row) return null;
    return {
      did: String(row.did),
      handle: row.handle ? String(row.handle) : undefined,
      displayName: row.display_name ? String(row.display_name) : undefined,
      avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
      pdsUrl: row.pds_url ? String(row.pds_url) : undefined,
      didDoc: row.did_doc_json ? (JSON.parse(String(row.did_doc_json)) as Record<string, unknown>) : undefined,
    };
  }

  upsertActor(info: ResolvedActorInfo & { isDemo?: boolean }): void {
    const existing = this.getCachedActor(info.did);
    const merged: ResolvedActorInfo = {
      did: info.did,
      handle: info.handle ?? existing?.handle,
      displayName: info.displayName ?? existing?.displayName,
      avatarUrl: info.avatarUrl ?? existing?.avatarUrl,
      pdsUrl: info.pdsUrl ?? existing?.pdsUrl,
      didDoc: info.didDoc ?? existing?.didDoc,
    };

    this.db
      .prepare(
        `INSERT INTO actors (did, handle, display_name, avatar_url, pds_url, did_doc_json, is_demo, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(did) DO UPDATE SET
           handle = COALESCE(excluded.handle, actors.handle),
           display_name = COALESCE(excluded.display_name, actors.display_name),
           avatar_url = COALESCE(excluded.avatar_url, actors.avatar_url),
           pds_url = COALESCE(excluded.pds_url, actors.pds_url),
           did_doc_json = COALESCE(excluded.did_doc_json, actors.did_doc_json),
           updated_at = excluded.updated_at`
      )
      .run(
        merged.did,
        merged.handle ?? null,
        merged.displayName ?? null,
        merged.avatarUrl ?? null,
        merged.pdsUrl ?? null,
        merged.didDoc ? JSON.stringify(merged.didDoc) : null,
        info.isDemo ? 1 : 0,
        new Date().toISOString()
      );
  }

  /**
   * Resolve a DID document (checking local SQLite cache first so seeded/offline keys work instantaneously,
   * then resolving via PLC/did:web over the network).
   */
  async resolveDidDocument(did: string): Promise<Record<string, unknown> | null> {
    const cached = this.getCachedActor(did);
    if (cached?.didDoc) {
      return cached.didDoc;
    }
    if (!this.enableNetwork) {
      return null;
    }
    try {
      const doc = (await this.didResolver.resolve(did)) as Record<string, unknown> | null;
      if (doc) {
        const pdsUrl = extractPdsFromDidDoc(doc);
        const handle = extractHandleFromDidDoc(doc);
        this.upsertActor({ did, handle, pdsUrl, didDoc: doc });
      }
      return doc;
    } catch {
      return null;
    }
  }

  /**
   * Resolve a handle or DID to full actor metadata (DID, handle, display name, avatar, PDS URL).
   */
  async resolveActor(identifier: string, forceRefresh = false): Promise<ResolvedActorInfo | null> {
    const clean = identifier.trim().replace(/^@/, '');
    if (!clean) return null;

    const cached = this.getCachedActor(clean);
    if (cached && !forceRefresh && (cached.didDoc || !this.enableNetwork)) {
      return cached;
    }

    if (!this.enableNetwork) {
      if (clean.startsWith('did:')) {
        return cached ?? { did: clean };
      }
      return cached;
    }

    let did = clean.startsWith('did:') ? clean : cached?.did;
    if (!did) {
      try {
        did = await this.handleResolver.resolve(clean);
      } catch {
        // Fallback to Bluesky public XRPC resolveHandle
      }
      if (!did) {
        try {
          const res = await fetch(
            `${BSKY_PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(clean)}`
          );
          if (res.ok) {
            const data = (await res.json()) as { did?: string };
            did = data.did;
          }
        } catch {
          // Ignore network error
        }
      }
    }

    if (!did) return cached;

    const didDoc = await this.resolveDidDocument(did);
    const pdsUrl = extractPdsFromDidDoc(didDoc) ?? cached?.pdsUrl;
    let handle = extractHandleFromDidDoc(didDoc) ?? (clean.startsWith('did:') ? cached?.handle : clean);
    let displayName = cached?.displayName;
    let avatarUrl = cached?.avatarUrl;

    try {
      const profileRes = await fetch(
        `${BSKY_PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
      );
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as {
          handle?: string;
          displayName?: string;
          avatar?: string;
        };
        if (profile.handle) handle = profile.handle;
        if (profile.displayName) displayName = profile.displayName;
        if (profile.avatar) avatarUrl = profile.avatar;
      }
    } catch {
      // Optional public profile enrichment
    }

    const resolved: ResolvedActorInfo = {
      did,
      handle,
      displayName,
      avatarUrl,
      pdsUrl,
      didDoc: didDoc ?? undefined,
    };
    this.upsertActor(resolved);
    return resolved;
  }

  /**
   * Resolve the set of DIDs followed by `viewerDid` (always including `viewerDid` itself)
   * for Social Leaderboards (`scope: "social"`). Combines local SQLite `follows` rows with
   * live `app.bsky.graph.getFollows` when network access is enabled.
   */
  async getSocialGraphDids(viewerDid: string): Promise<Set<string>> {
    const now = Date.now();
    const cached = this.followsCache.get(viewerDid);
    if (cached && cached.expiresAt > now) {
      return cached.dids;
    }

    const dids = new Set<string>([viewerDid]);
    const localRows = this.db
      .prepare('SELECT subject_did FROM follows WHERE follower_did = ?')
      .all(viewerDid) as Array<{ subject_did: string }>;
    for (const row of localRows) {
      dids.add(row.subject_did);
    }

    if (this.enableNetwork) {
      try {
        let cursor: string | undefined;
        // Fetch up to 3 pages (300 follows) rapidly for social filtering
        for (let page = 0; page < 3; page++) {
          const url = new URL(`${BSKY_PUBLIC_API}/xrpc/app.bsky.graph.getFollows`);
          url.searchParams.set('actor', viewerDid);
          url.searchParams.set('limit', '100');
          if (cursor) url.searchParams.set('cursor', cursor);

          const res = await fetch(url);
          if (!res.ok) break;
          const body = (await res.json()) as {
            follows?: Array<{ did: string; handle?: string; displayName?: string; avatar?: string }>;
            cursor?: string;
          };
          for (const f of body.follows ?? []) {
            dids.add(f.did);
            this.upsertActor({
              did: f.did,
              handle: f.handle,
              displayName: f.displayName,
              avatarUrl: f.avatar,
            });
          }
          if (!body.cursor) break;
          cursor = body.cursor;
        }
      } catch {
        // Gracefully use local follows + viewerDid if offline
      }
    }

    this.followsCache.set(viewerDid, { expiresAt: now + 60_000, dids });
    return dids;
  }
}
