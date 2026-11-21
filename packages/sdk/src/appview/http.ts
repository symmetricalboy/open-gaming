import type { Timeframe } from '../types.js';
import type { OpenGamingAppViewEngine } from './engine.js';
import type { LibraryShelfStatus } from './types.js';

const DEFAULT_ALLOWED_BLOB_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);

export interface SafeBlobProxyOptions {
  allowedMimeTypes?: ReadonlySet<string>;
  maxBytes?: number;
  defaultPdsUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Safely proxy an image blob from an actor's PDS (`com.atproto.sync.getBlob`) with strict MIME
 * allowlisting, byte-size enforcement, immutable caching, and `Content-Security-Policy: default-src 'none'`.
 */
export async function fetchSafePdsBlob(
  engine: OpenGamingAppViewEngine,
  params: { did: string; cid: string },
  options?: SafeBlobProxyOptions
): Promise<Response> {
  const { did, cid } = params;
  if (!did || !cid || !did.startsWith('did:')) {
    return new Response('Invalid did or cid', { status: 400 });
  }

  const allowedMimes = options?.allowedMimeTypes ?? DEFAULT_ALLOWED_BLOB_MIMES;
  const maxBytes = options?.maxBytes ?? 2_100_000;
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;

  const actor = await engine.identity.resolveActor(did);
  const pdsUrl = (actor?.pdsUrl ?? options?.defaultPdsUrl ?? 'https://bsky.social').replace(/\/+$/, '');
  const blobUrl = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;

  const upstream = await fetchFn(blobUrl);
  if (!upstream.ok) {
    return new Response('Blob not found on PDS', { status: 404 });
  }

  const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!allowedMimes.has(contentType)) {
    return new Response(`Unsupported blob MIME type: ${contentType}`, { status: 415 });
  }

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    return new Response('Blob exceeds maximum allowed size', { status: 413 });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export interface AppViewFetchHandlerOptions {
  /** Optional base path prefix to strip when mounted under a sub-route (e.g. `'/api/opengaming'`). */
  basePath?: string;
  /** Enable `POST /api/sync-repo` on-demand PDS backfill endpoint (default `true`). */
  enableSyncEndpoint?: boolean;
  /** CORS `Access-Control-Allow-Origin` header value (default `'*'`). */
  corsOrigin?: string;
  blobOptions?: SafeBlobProxyOptions;
}

function jsonResponse(payload: unknown, status = 200, corsOrigin = '*'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': corsOrigin,
    },
  });
}

/**
 * Create a runtime-agnostic Web Fetch `(request: Request) => Promise<Response>` handler exposing
 * standard Open Gaming XRPC endpoints (`actor.getProfile`, `leaderboard.getScores`) and rich viewer
 * endpoints (`/api/games`, `/api/game`, `/api/library`, `/api/matches`, `/api/blob`, `/api/sync-repo`).
 *
 * Mounts directly into Next.js App Router, Astro, Hono, Cloudflare Workers, Deno, Bun, or Node `http`.
 */
export function createAppViewFetchHandler(
  engine: OpenGamingAppViewEngine,
  options?: AppViewFetchHandlerOptions
): (request: Request) => Promise<Response> {
  const basePath = (options?.basePath ?? '').replace(/\/+$/, '');
  const enableSync = options?.enableSyncEndpoint ?? true;
  const corsOrigin = options?.corsOrigin ?? '*';

  return async (request: Request): Promise<Response> => {
    try {
      const method = request.method.toUpperCase();
      if (method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': corsOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        });
      }

      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (basePath && pathname.startsWith(basePath)) {
        pathname = pathname.slice(basePath.length) || '/';
      }

      // 1. Standard XRPC: games.opengaming.actor.getProfile
      if (pathname === '/xrpc/games.opengaming.actor.getProfile' && method === 'GET') {
        const actor = url.searchParams.get('actor')?.trim();
        if (!actor) {
          return jsonResponse(
            { error: 'InvalidRequest', message: 'Missing required `actor` parameter.' },
            400,
            corsOrigin
          );
        }
        const profile = await engine.getActorProfile(actor);
        return jsonResponse(profile, 200, corsOrigin);
      }

      // 2. Standard XRPC: games.opengaming.leaderboard.getScores
      if (pathname === '/xrpc/games.opengaming.leaderboard.getScores' && method === 'GET') {
        const leaderboard = url.searchParams.get('leaderboard')?.trim();
        if (!leaderboard) {
          return jsonResponse(
            { error: 'InvalidRequest', message: 'Missing required `leaderboard` AT-URI parameter.' },
            400,
            corsOrigin
          );
        }
        const timeframe = (url.searchParams.get('timeframe') ?? 'allTime') as Timeframe;
        const scope = (url.searchParams.get('scope') ?? 'public') as 'public' | 'social';
        const viewer = url.searchParams.get('viewer')?.trim() || undefined;
        const player = url.searchParams.get('player')?.trim() || undefined;
        const includeObsolete = url.searchParams.get('includeObsolete') === 'true';
        const sortBy = url.searchParams.get('sortBy')?.trim() || undefined;
        const dimensions = url.searchParams.get('dimensions')?.trim() || undefined;
        const seed = url.searchParams.get('seed')?.trim() || undefined;
        const version = url.searchParams.get('version')?.trim() || undefined;
        const verifiedOnlyParam = url.searchParams.get('verifiedOnly');
        const verifiedOnly = verifiedOnlyParam === null ? true : verifiedOnlyParam !== 'false';
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25;
        const cursor = url.searchParams.get('cursor') ?? undefined;
        const locale = url.searchParams.get('locale') ?? undefined;

        const scores = await engine.getLeaderboardScores({
          leaderboard,
          timeframe,
          scope,
          viewer,
          player,
          includeObsolete,
          sortBy,
          dimensions,
          seed,
          version,
          verifiedOnly,
          limit,
          cursor,
          locale,
        });
        return jsonResponse(scores, 200, corsOrigin);
      }

      // 3. Viewer API: Games Catalog
      if (pathname === '/api/games' && method === 'GET') {
        const games = await engine.getGamesCatalog();
        return jsonResponse({ games }, 200, corsOrigin);
      }

      // 4. Viewer API: Game Hub Detail (Achievements + Rarity + Leaderboards + Challenges + Matches)
      if (pathname === '/api/game' && method === 'GET') {
        const uri = url.searchParams.get('uri')?.trim();
        if (!uri) {
          return jsonResponse({ error: 'InvalidRequest', message: 'Missing `uri` parameter.' }, 400, corsOrigin);
        }
        const viewer = url.searchParams.get('viewer')?.trim() || undefined;
        const locale = url.searchParams.get('locale')?.trim() || undefined;
        const detail = await engine.getGameDetail({ gameUri: uri, viewer, locale });
        return jsonResponse(detail, 200, corsOrigin);
      }

      // 5. Viewer API: Player Game Library & Shelves
      if (pathname === '/api/library' && method === 'GET') {
        const actor = url.searchParams.get('actor')?.trim();
        if (!actor) {
          return jsonResponse(
            { error: 'InvalidRequest', message: 'Missing required `actor` parameter.' },
            400,
            corsOrigin
          );
        }
        const shelf = (url.searchParams.get('shelf')?.trim() || undefined) as
          | LibraryShelfStatus
          | undefined;
        const sortBy = (url.searchParams.get('sortBy')?.trim() || 'recentActivity') as
          | 'recentActivity'
          | 'completion'
          | 'title';
        const locale = url.searchParams.get('locale')?.trim() || undefined;
        const library = await engine.getActorLibrary({ actor, shelf, sortBy, locale });
        return jsonResponse(library, 200, corsOrigin);
      }

      // 6. Viewer API: Match History
      if (pathname === '/api/matches' && method === 'GET') {
        const gameUri = url.searchParams.get('game')?.trim() || undefined;
        const actor = url.searchParams.get('actor')?.trim() || undefined;
        const leaderboardUri = url.searchParams.get('leaderboard')?.trim() || undefined;
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25;
        const cursor = url.searchParams.get('cursor') ?? undefined;
        const history = await engine.getMatchHistory({
          gameUri,
          actor,
          leaderboardUri,
          limit,
          cursor,
        });
        return jsonResponse(history, 200, corsOrigin);
      }

      // 7. Safe PDS Blob Proxy
      if (pathname === '/api/blob' && method === 'GET') {
        const did = url.searchParams.get('did')?.trim() ?? '';
        const cid = url.searchParams.get('cid')?.trim() ?? '';
        return fetchSafePdsBlob(engine, { did, cid }, options?.blobOptions);
      }

      // 8. On-Demand PDS Sync
      if (enableSync && pathname === '/api/sync-repo' && method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { actor?: string };
        const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
        if (!actor) {
          return jsonResponse(
            { error: 'InvalidRequest', message: 'Provide `{ "actor": "<handle-or-did>" }`.' },
            400,
            corsOrigin
          );
        }
        const result = await engine.syncActorRepository(actor);
        return jsonResponse(result, 200, corsOrigin);
      }

      return jsonResponse({ error: 'NotFound', message: `Unknown endpoint: ${pathname}` }, 404, corsOrigin);
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500;
      const code = status === 404 ? 'NotFound' : status === 400 ? 'InvalidRequest' : 'InternalServerError';
      return jsonResponse(
        { error: code, message: err instanceof Error ? err.message : 'Unexpected AppView error' },
        status,
        corsOrigin
      );
    }
  };
}
