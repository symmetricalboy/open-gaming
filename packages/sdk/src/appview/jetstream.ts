import type { OpenGamingAppViewEngine } from './engine.js';

export interface JetstreamEventMessage {
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

export interface OpenGamingJetstreamOptions {
  /** Upstream Jetstream WebSocket endpoint. Defaults to `wss://jetstream2.us-east.bsky.network/subscribe`. */
  jetstreamUrl?: string;
  /** Cursor persistence key inside `engine.store`. Defaults to `'jetstream_cursor'`. */
  cursorKey?: string;
  /** Rewind window (microseconds) applied on reconnect to avoid dropping in-flight events. Defaults to `5_000_000` (5s). */
  rewindMicroseconds?: number;
  /** Optional explicit list of collections to subscribe to (defaults to `engine.getWatchedCollections()`). */
  wantedCollections?: readonly string[];
  /** Optional DID filter (`wantedDids`). */
  wantedDids?: readonly string[];
  /** Optional custom `WebSocket` implementation (for older Node runtimes or test harnesses). */
  WebSocketImpl?: typeof WebSocket;
  /** Optional error callback. */
  onError?: (error: unknown) => void;
}

/**
 * Reusable real-time AT Protocol Jetstream firehose consumer for Open Gaming AppViews.
 * Streams game catalog records, player library items, definitions, unlocks, scores, matches,
 * and revocations directly into an `OpenGamingAppViewEngine` with automatic cursor persistence.
 */
export class OpenGamingJetstreamConsumer {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 2000;
  private connected = false;
  private eventsProcessed = 0;
  private lastEventAt?: string;

  private readonly baseUrl: string;
  private readonly cursorKey: string;
  private readonly rewindUs: number;
  private readonly wantedCollections: readonly string[];
  private readonly wantedDids?: readonly string[];
  private readonly WebSocketCtor?: typeof WebSocket;
  private readonly onError?: (error: unknown) => void;

  constructor(
    private engine: OpenGamingAppViewEngine,
    options?: OpenGamingJetstreamOptions
  ) {
    this.baseUrl = options?.jetstreamUrl ?? 'wss://jetstream2.us-east.bsky.network/subscribe';
    this.cursorKey = options?.cursorKey ?? 'jetstream_cursor';
    this.rewindUs = options?.rewindMicroseconds ?? 5_000_000;
    this.wantedCollections = options?.wantedCollections ?? engine.getWatchedCollections();
    this.wantedDids = options?.wantedDids;
    this.WebSocketCtor = options?.WebSocketImpl ?? globalThis.WebSocket;
    this.onError = options?.onError;
  }

  getStatus(): {
    connected: boolean;
    eventsProcessed: number;
    lastEventAt?: string;
  } {
    return {
      connected: this.connected,
      eventsProcessed: this.eventsProcessed,
      lastEventAt: this.lastEventAt,
    };
  }

  async buildSubscribeUrl(): Promise<string> {
    const url = new URL(this.baseUrl);
    for (const col of this.wantedCollections) {
      url.searchParams.append('wantedCollections', col);
    }
    if (this.wantedDids) {
      for (const did of this.wantedDids) {
        url.searchParams.append('wantedDids', did);
      }
    }
    const saved = await this.engine.store.getSyncCursor(this.cursorKey);
    if (saved) {
      const rewound = Math.max(0, Number(saved) - this.rewindUs);
      if (Number.isFinite(rewound) && rewound > 0) {
        url.searchParams.set('cursor', String(Math.trunc(rewound)));
      }
    }
    return url.toString();
  }

  start(): void {
    this.stopped = false;
    void this.connect();
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

  private async connect(): Promise<void> {
    if (this.stopped || typeof this.WebSocketCtor !== 'function') return;

    try {
      const targetUrl = await this.buildSubscribeUrl();
      const ws = new this.WebSocketCtor(targetUrl);
      this.ws = ws;

      ws.addEventListener('open', () => {
        this.connected = true;
        this.backoffMs = 2000;
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        const raw = typeof event.data === 'string' ? event.data : String(event.data);
        void this.handleMessage(raw).catch((err) => this.onError?.(err));
      });

      ws.addEventListener('close', () => {
        this.connected = false;
        this.ws = null;
        this.scheduleReconnect();
      });

      ws.addEventListener('error', (err) => {
        this.connected = false;
        this.onError?.(err);
      });
    } catch (err) {
      this.onError?.(err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(30_000, Math.floor(this.backoffMs * 1.8));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    (this.reconnectTimer as { unref?: () => void }).unref?.();
  }

  /**
   * Process a single Jetstream JSON message (exposed publicly for custom transports, queues, and unit tests).
   */
  async handleMessage(rawJson: string): Promise<void> {
    let evt: JetstreamEventMessage;
    try {
      evt = JSON.parse(rawJson) as JetstreamEventMessage;
    } catch {
      return;
    }

    if (typeof evt.time_us === 'number') {
      this.eventsProcessed += 1;
      this.lastEventAt = new Date().toISOString();
      if (this.eventsProcessed % 20 === 0 || evt.kind === 'commit') {
        await this.engine.store.setSyncCursor(this.cursorKey, String(evt.time_us));
      }
    }

    if (evt.kind === 'identity' && evt.identity?.did) {
      await this.engine.store.upsertActor({
        did: evt.identity.did,
        handle: evt.identity.handle,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (evt.kind !== 'commit' || !evt.commit || !evt.did) return;

    const { operation, collection, rkey, record, cid } = evt.commit;
    const uri = `at://${evt.did}/${collection}/${rkey}`;

    if (operation === 'delete') {
      await this.engine.deleteRecord(uri);
    } else if ((operation === 'create' || operation === 'update') && record) {
      await this.engine.indexRecord({
        uri,
        cid,
        record,
      });
    }
  }
}
