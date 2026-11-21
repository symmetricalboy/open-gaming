import { DidResolver, HandleResolver } from '@atproto/identity';
import type { AppViewStorageAdapter, StoredActor } from './types.js';

const DEFAULT_PLC_URL = 'https://plc.directory';
const DEFAULT_BSKY_PUBLIC_API = 'https://public.api.bsky.app';

export function extractPdsFromDidDoc(didDoc?: Record<string, unknown> | null): string | undefined {
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

export function extractHandleFromDidDoc(didDoc?: Record<string, unknown> | null): string | undefined {
  if (!didDoc) return undefined;
  const aka = didDoc.alsoKnownAs;
  if (Array.isArray(aka)) {
    const atEntry = aka.find((item) => typeof item === 'string' && item.startsWith('at://')) as
      | string
      | undefined;
    if (atEntry) {
      return atEntry.slice('at://'.length);
    }
  }
  return undefined;
}

export interface AppViewIdentityOptions {
  plcDirectoryUrl?: string;
  bskyPublicApiUrl?: string;
  enableNetwork?: boolean;
  followsCacheTtlMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Identity, DID document (`#attestations` & `#atproto_pds`), actor profile, and social graph
 * resolver backed by an `AppViewStorageAdapter`.
 */
export class AppViewIdentityResolver {
  private didResolver: DidResolver;
  private handleResolver: HandleResolver;
  private enableNetwork: boolean;
  private bskyPublicApiUrl: string;
  private followsCacheTtlMs: number;
  private fetchImpl: typeof fetch;
  private followsExpiry = new Map<string, number>();

  constructor(
    private store: AppViewStorageAdapter,
    options?: AppViewIdentityOptions
  ) {
    this.didResolver = new DidResolver({
      plcUrl: options?.plcDirectoryUrl ?? DEFAULT_PLC_URL,
    });
    this.handleResolver = new HandleResolver({});
    this.enableNetwork = options?.enableNetwork ?? true;
    this.bskyPublicApiUrl = (options?.bskyPublicApiUrl ?? DEFAULT_BSKY_PUBLIC_API).replace(/\/+$/, '');
    this.followsCacheTtlMs = options?.followsCacheTtlMs ?? 5 * 60 * 1000;
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  }

  async resolveDidDocument(did: string, forceRefresh = false): Promise<Record<string, unknown> | null> {
    const cached = await this.store.getActor(did);
    if (!forceRefresh && cached?.didDoc) {
      return cached.didDoc;
    }
    if (!this.enableNetwork) {
      return cached?.didDoc ?? null;
    }
    try {
      const doc = (await this.didResolver.resolve(did, forceRefresh)) as Record<string, unknown> | null;
      if (doc) {
        await this.store.upsertActor({
          did,
          handle: extractHandleFromDidDoc(doc) ?? cached?.handle,
          displayName: cached?.displayName,
          avatarUrl: cached?.avatarUrl,
          pdsUrl: extractPdsFromDidDoc(doc) ?? cached?.pdsUrl,
          didDoc: doc,
          updatedAt: new Date().toISOString(),
        });
      }
      return doc;
    } catch {
      return cached?.didDoc ?? null;
    }
  }

  async resolveActor(identifier: string, forceRefresh = false): Promise<StoredActor | null> {
    const clean = identifier.trim().replace(/^@/, '');
    if (!clean) return null;

    const cached = await this.store.getActor(clean);
    if (cached && !forceRefresh && (cached.didDoc || !this.enableNetwork)) {
      return cached;
    }

    if (!this.enableNetwork) {
      if (clean.startsWith('did:')) {
        return cached ?? { did: clean, updatedAt: new Date().toISOString() };
      }
      return cached;
    }

    let did = clean.startsWith('did:') ? clean : cached?.did;
    if (!did) {
      try {
        did = await this.handleResolver.resolve(clean);
      } catch {
        // Fallback to public XRPC resolveHandle
      }
      if (!did && typeof this.fetchImpl === 'function') {
        try {
          const res = await this.fetchImpl(
            `${this.bskyPublicApiUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(clean)}`
          );
          if (res.ok) {
            const data = (await res.json()) as { did?: string };
            did = data.did;
          }
        } catch {
          // Ignore network failure
        }
      }
    }

    if (!did) return cached;

    const didDoc = await this.resolveDidDocument(did, forceRefresh);
    const pdsUrl = extractPdsFromDidDoc(didDoc) ?? cached?.pdsUrl;
    let handle = extractHandleFromDidDoc(didDoc) ?? (clean.startsWith('did:') ? cached?.handle : clean);
    let displayName = cached?.displayName;
    let avatarUrl = cached?.avatarUrl;

    if (typeof this.fetchImpl === 'function') {
      try {
        const res = await this.fetchImpl(
          `${this.bskyPublicApiUrl}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
        );
        if (res.ok) {
          const profile = (await res.json()) as {
            handle?: string;
            displayName?: string;
            avatar?: string;
          };
          if (profile.handle) handle = profile.handle;
          if (profile.displayName) displayName = profile.displayName;
          if (profile.avatar) avatarUrl = profile.avatar;
        }
      } catch {
        // Optional Bluesky profile enrichment
      }
    }

    const actor: StoredActor = {
      did,
      handle,
      displayName,
      avatarUrl,
      pdsUrl,
      didDoc: didDoc ?? undefined,
      updatedAt: new Date().toISOString(),
    };
    await this.store.upsertActor(actor);
    return actor;
  }

  /**
   * Resolve the social follow graph (`viewerDid` + accounts `viewerDid` follows) for `scope: "social"` leaderboards.
   */
  async getSocialGraphDids(viewerDid: string): Promise<Set<string>> {
    const now = Date.now();
    const stored = await this.store.getFollows(viewerDid);
    const expiresAt = this.followsExpiry.get(viewerDid) ?? 0;

    if (stored.length > 0 && (expiresAt > now || !this.enableNetwork)) {
      return new Set([viewerDid, ...stored]);
    }

    const dids = new Set<string>([viewerDid, ...stored]);
    if (this.enableNetwork && typeof this.fetchImpl === 'function') {
      try {
        let cursor: string | undefined;
        for (let page = 0; page < 3; page++) {
          const url = new URL(`${this.bskyPublicApiUrl}/xrpc/app.bsky.graph.getFollows`);
          url.searchParams.set('actor', viewerDid);
          url.searchParams.set('limit', '100');
          if (cursor) url.searchParams.set('cursor', cursor);

          const res = await this.fetchImpl(url);
          if (!res.ok) break;
          const data = (await res.json()) as {
            follows?: Array<{ did?: string }>;
            cursor?: string;
          };
          const list = data.follows ?? [];
          for (const f of list) {
            if (f.did) dids.add(f.did);
          }
          if (!data.cursor || list.length === 0) break;
          cursor = data.cursor;
        }
        await this.store.setFollows(viewerDid, [...dids]);
        this.followsExpiry.set(viewerDid, now + this.followsCacheTtlMs);
      } catch {
        // Return local stored set on network failure
      }
    }

    return dids;
  }
}
