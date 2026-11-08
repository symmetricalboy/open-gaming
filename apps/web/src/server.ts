import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOpenGamingLexiconDocs, type Timeframe } from '@opengaming/sdk';
import { createDatabase, type AppDatabase } from './db.js';
import { IdentityService } from './identity.js';
import { OpenGamingIndexer } from './indexer.js';
import { AppViewQueries } from './queries.js';
import { JetstreamConsumer } from './jetstream.js';
import { getBuiltInIconSvg } from './icons.js';
import { seedShowcaseData } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const ALLOWED_BLOB_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface AppViewInstance {
  server: Server;
  db: AppDatabase;
  identity: IdentityService;
  indexer: OpenGamingIndexer;
  queries: AppViewQueries;
  jetstream: JetstreamConsumer;
  close: () => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown, cacheControl = 'no-store'): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage, maxBytes = 65_536): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw Object.assign(new Error('Request body too large'), { status: 413 });
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function createAppViewServer(options?: {
  dbPath?: string;
  enableJetstream?: boolean;
  enableNetworkIdentity?: boolean;
  seedDemoData?: boolean;
}): Promise<AppViewInstance> {
  const db = createDatabase(options?.dbPath ?? process.env.DATABASE_PATH ?? ':memory:');
  const identity = new IdentityService(db, {
    enableNetwork: options?.enableNetworkIdentity ?? process.env.DISABLE_NETWORK_IDENTITY !== 'true',
  });
  const indexer = new OpenGamingIndexer(db, identity);
  const queries = new AppViewQueries(db, identity);
  const jetstream = new JetstreamConsumer(db, indexer);

  const shouldSeed = options?.seedDemoData ?? process.env.SEED_DEMO_DATA !== 'false';
  if (shouldSeed) {
    await seedShowcaseData({ db, identity, indexer });
  }

  const enableJetstream = options?.enableJetstream ?? process.env.ENABLE_JETSTREAM !== 'false';
  if (enableJetstream) {
    jetstream.start();
  }

  const lexiconDocs = loadOpenGamingLexiconDocs();
  const blobCache = new Map<string, { mimeType: string; bytes: Buffer }>();

  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(url.pathname);

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      if (pathname === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          service: 'opengaming.games',
          jetstream: jetstream.getStatus(),
        });
        return;
      }

      if (pathname === '/.well-known/atproto-did') {
        const domainDid = process.env.OPENGAMING_DID ?? 'did:plc:33d7gnwiagm6cimpiepefp72';
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(domainDid);
        return;
      }

      // Built-in SVG icons
      if (pathname.startsWith('/assets/icons/')) {
        const iconName = path.basename(pathname);
        const svg = getBuiltInIconSvg(iconName);
        if (!svg) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Icon not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        });
        res.end(method === 'HEAD' ? undefined : svg);
        return;
      }

      // XRPC: games.opengaming.actor.getProfile
      if (pathname === '/xrpc/games.opengaming.actor.getProfile' && method === 'GET') {
        const actor = url.searchParams.get('actor')?.trim();
        if (!actor) {
          sendJson(res, 400, { error: 'InvalidRequest', message: 'Missing required `actor` parameter.' });
          return;
        }
        const profile = await queries.getXrpcActorProfile(actor);
        sendJson(res, 200, profile);
        return;
      }

      // XRPC: games.opengaming.leaderboard.getScores
      if (pathname === '/xrpc/games.opengaming.leaderboard.getScores' && method === 'GET') {
        const leaderboard = url.searchParams.get('leaderboard')?.trim();
        if (!leaderboard) {
          sendJson(res, 400, { error: 'InvalidRequest', message: 'Missing required `leaderboard` AT-URI parameter.' });
          return;
        }
        const timeframe = (url.searchParams.get('timeframe') ?? 'allTime') as Timeframe;
        const scope = (url.searchParams.get('scope') ?? 'public') as 'public' | 'social';
        const viewer = url.searchParams.get('viewer')?.trim() || undefined;
        const verifiedOnlyParam = url.searchParams.get('verifiedOnly');
        const verifiedOnly = verifiedOnlyParam === null ? true : verifiedOnlyParam !== 'false';
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25;
        const cursor = url.searchParams.get('cursor') ?? undefined;

        const out = await queries.getXrpcLeaderboardScores({
          leaderboard,
          timeframe,
          scope,
          viewer,
          verifiedOnly,
          limit,
          cursor,
        });
        sendJson(res, 200, out);
        return;
      }

      // AppView REST APIs
      if (pathname === '/api/overview' && method === 'GET') {
        sendJson(res, 200, queries.getOverviewData(jetstream.getStatus()));
        return;
      }

      if (pathname === '/api/games' && method === 'GET') {
        sendJson(res, 200, { games: queries.getGamesCatalog() });
        return;
      }

      if (pathname === '/api/game' && method === 'GET') {
        const uri = url.searchParams.get('uri')?.trim();
        if (!uri) {
          sendJson(res, 400, { error: 'Missing `uri` parameter.' });
          return;
        }
        const viewer = url.searchParams.get('viewer')?.trim() || undefined;
        sendJson(res, 200, await queries.getGameDetail(uri, viewer));
        return;
      }

      if (pathname === '/api/leaderboards' && method === 'GET') {
        sendJson(res, 200, { leaderboards: queries.getLeaderboardsDirectory() });
        return;
      }

      if (pathname === '/api/leaderboard' && method === 'GET') {
        const leaderboard = url.searchParams.get('leaderboard')?.trim();
        if (!leaderboard) {
          sendJson(res, 400, { error: 'Missing `leaderboard` AT-URI parameter.' });
          return;
        }
        const timeframe = (url.searchParams.get('timeframe') ?? 'allTime') as Timeframe;
        const scope = (url.searchParams.get('scope') ?? 'public') as 'public' | 'social';
        const viewer = url.searchParams.get('viewer')?.trim() || undefined;
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;

        sendJson(
          res,
          200,
          await queries.getRichLeaderboard({
            leaderboard,
            timeframe,
            scope,
            viewer,
            limit,
          })
        );
        return;
      }

      if (pathname === '/api/actor' && method === 'GET') {
        const actor = url.searchParams.get('actor')?.trim();
        if (!actor) {
          sendJson(res, 400, { error: 'Missing `actor` parameter.' });
          return;
        }
        sendJson(res, 200, await queries.getActorGamercard(actor));
        return;
      }

      if (pathname === '/api/proof' && method === 'GET') {
        const uri = url.searchParams.get('uri')?.trim();
        if (!uri) {
          sendJson(res, 400, { error: 'Missing `uri` parameter.' });
          return;
        }
        sendJson(res, 200, queries.getProofDetail(uri));
        return;
      }

      if (pathname === '/api/audit' && method === 'GET') {
        sendJson(res, 200, queries.getAuditLedger());
        return;
      }

      if (pathname === '/api/lexicons' && method === 'GET') {
        sendJson(res, 200, { lexicons: lexiconDocs }, 'public, max-age=300');
        return;
      }

      if (pathname === '/api/sync-repo' && method === 'POST') {
        const body = await readJsonBody(req);
        const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
        if (!actor) {
          sendJson(res, 400, { error: 'Provide `{ "actor": "<handle-or-did>" }` to sync from PDS.' });
          return;
        }
        const syncResult = await indexer.syncActorRepository(actor);
        sendJson(res, 200, syncResult);
        return;
      }

      // Safe PDS Blob Mirroring Proxy (`com.atproto.sync.getBlob`)
      if (pathname === '/api/blob' && method === 'GET') {
        const did = url.searchParams.get('did')?.trim();
        const cid = url.searchParams.get('cid')?.trim();
        if (!did || !cid || !did.startsWith('did:')) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Invalid did or cid');
          return;
        }

        const cacheKey = `${did}:${cid}`;
        const hit = blobCache.get(cacheKey);
        if (hit) {
          res.writeHead(200, {
            'Content-Type': hit.mimeType,
            'Cache-Control': 'public, max-age=86400, immutable',
            'Content-Security-Policy': "default-src 'none'",
          });
          res.end(hit.bytes);
          return;
        }

        const actor = await identity.resolveActor(did);
        const pdsUrl = actor?.pdsUrl ?? 'https://bsky.social';
        const blobUrl = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
        const upstream = await fetch(blobUrl);
        if (!upstream.ok) {
          // Fallback to locked crest SVG if blob unavailable
          const fallbackSvg = getBuiltInIconSvg('locked')!;
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=300',
            'Content-Security-Policy': "default-src 'none'",
          });
          res.end(fallbackSvg);
          return;
        }

        const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (!ALLOWED_BLOB_MIMES.has(contentType)) {
          res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Unsupported blob MIME type');
          return;
        }

        const arrBuf = await upstream.arrayBuffer();
        if (arrBuf.byteLength > 1_500_000) {
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Blob exceeds size limit');
          return;
        }

        const bytes = Buffer.from(arrBuf);
        if (blobCache.size > 250) {
          const oldest = blobCache.keys().next().value;
          if (oldest) blobCache.delete(oldest);
        }
        blobCache.set(cacheKey, { mimeType: contentType, bytes });

        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, immutable',
          'Content-Security-Policy': "default-src 'none'",
        });
        res.end(bytes);
        return;
      }

      if (pathname.startsWith('/api/') || pathname.startsWith('/xrpc/')) {
        sendJson(res, 404, { error: 'NotFound', message: `Unknown endpoint: ${pathname}` });
        return;
      }

      // Static files & SPA fallback
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
      }

      const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
      const candidatePath = path.resolve(path.join(PUBLIC_DIR, safeRel === '/' ? 'index.html' : safeRel));

      if (!candidatePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let servePath = candidatePath;
      try {
        const st = await stat(servePath);
        if (!st.isFile()) {
          servePath = path.join(PUBLIC_DIR, 'index.html');
        }
      } catch {
        // If path has no file extension, serve SPA shell index.html
        if (!path.extname(pathname)) {
          servePath = path.join(PUBLIC_DIR, 'index.html');
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not Found');
          return;
        }
      }

      const ext = path.extname(servePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      const content = method === 'HEAD' ? undefined : await readFile(servePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      });
      res.end(content);
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500;
      sendJson(res, status, {
        error: status === 404 ? 'NotFound' : status === 400 ? 'InvalidRequest' : 'InternalServerError',
        message: err instanceof Error ? err.message : 'Unexpected server error',
      });
    }
  });

  const close = async () => {
    jetstream.stop();
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    try {
      db.close();
    } catch {
      // Ignore already closed
    }
  };

  return {
    server,
    db,
    identity,
    indexer,
    queries,
    jetstream,
    close,
  };
}
