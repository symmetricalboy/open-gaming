import type { AppDatabase } from './db.js';
import { WATCHED_COLLECTIONS, type OpenGamingIndexer } from './indexer.js';

interface JetstreamCommitEvent {
  did: string;
  time_us: number;
  kind: 'commit' | 'identity' | 'account';
  commit?: {
    rev: string;
    operation: 'create' | 'update' | 'delete';
    collection: string;
    rkey: string;
    record?: Record<string, unknown>;
    cid?: string;
  };
  identity?: {
    did: string;
    handle?: string;
  };
}

export class JetstreamConsumer {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 2000;
  private connected = false;
  private eventsProcessed = 0;
  private lastEventAt?: string;

  constructor(
    private db: AppDatabase,
    private indexer: OpenGamingIndexer,
    private baseUrl = process.env.JETSTREAM_URL ?? 'wss://jetstream2.us-east.bsky.network/subscribe'
  ) {}

  getStatus() {
    return {
      connected: this.connected,
      eventsProcessed: this.eventsProcessed,
      lastEventAt: this.lastEventAt,
    };
  }

  private getSavedCursor(): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM sync_state WHERE key = ?')
      .get('jetstream_cursor') as { value: string } | undefined;
    return row?.value;
  }

  private saveCursor(timeUs: number): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (key, value) VALUES ('jetstream_cursor', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(String(timeUs));
  }

  start(): void {
    if (this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close error
      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.stopped || typeof WebSocket === 'undefined') return;

    try {
      const url = new URL(this.baseUrl);
      for (const col of WATCHED_COLLECTIONS) {
        url.searchParams.append('wantedCollections', col);
      }
      const savedCursor = this.getSavedCursor();
      if (savedCursor) {
        // Rewind 5 seconds (5_000_000 us) for safe overlap on reconnect
        const rewound = Math.max(0, Number(savedCursor) - 5_000_000);
        if (rewound > 0) {
          url.searchParams.set('cursor', String(rewound));
        }
      }

      const ws = new WebSocket(url.toString());
      this.ws = ws;

      ws.addEventListener('open', () => {
        this.connected = true;
        this.backoffMs = 2000;
        console.log(`[jetstream] Connected to ${url.origin}${url.pathname}`);
      });

      ws.addEventListener('message', (event) => {
        const raw = typeof event.data === 'string' ? event.data : String(event.data);
        void this.handleMessage(raw);
      });

      ws.addEventListener('close', () => {
        this.connected = false;
        this.ws = null;
        this.scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        this.connected = false;
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(30_000, Math.floor(this.backoffMs * 1.8));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async handleMessage(rawJson: string): Promise<void> {
    let evt: JetstreamCommitEvent;
    try {
      evt = JSON.parse(rawJson) as JetstreamCommitEvent;
    } catch {
      return;
    }

    if (typeof evt.time_us === 'number') {
      this.eventsProcessed += 1;
      this.lastEventAt = new Date().toISOString();
      if (this.eventsProcessed % 20 === 0 || evt.kind === 'commit') {
        this.saveCursor(evt.time_us);
      }
    }

    if (evt.kind !== 'commit' || !evt.commit || !evt.did) return;

    const { operation, collection, rkey, record, cid } = evt.commit;
    const uri = `at://${evt.did}/${collection}/${rkey}`;

    if (operation === 'delete') {
      await this.indexer.deleteRecord(uri);
    } else if ((operation === 'create' || operation === 'update') && record) {
      await this.indexer.indexRecord({
        uri,
        cid,
        record,
      });
    }
  }
}
