import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Durable Object that manages bridge WebSocket connections for a single nodeId.
 *
 * Supports multiple bridges with different keyHashes under the same nodeId.
 * Each keyHash maps to its own WebSocket connection.
 */
export class BridgeRelay extends DurableObject<Env> {
  /** keyHash → WebSocket mapping (in-memory cache) */
  private bridges = new Map<string, WebSocket>();
  /** requestId → pending response */
  private pendingRequests = new Map<string, PendingRequest>();
  /** WebSocket → keyHash reverse lookup (for disconnect cleanup) */
  private wsToKey = new Map<WebSocket, string>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/connect') {
      return this.handleConnect(request);
    }
    if (url.pathname === '/status') {
      return this.handleStatus(request);
    }
    if (url.pathname === '/forward') {
      return this.handleForward(request);
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  /**
   * Handle WebSocket upgrade from bridge.
   * Each keyHash gets its own WebSocket slot.
   */
  private async handleConnect(request: Request): Promise<Response> {
    const keyHash = request.headers.get('X-Key-Hash');
    if (!keyHash) {
      return Response.json({ error: 'Missing key hash' }, { status: 400 });
    }

    // Close existing connection for this keyHash if any
    const existing = this.bridges.get(keyHash);
    if (existing) {
      try { existing.close(1000, 'replaced'); } catch { /* ignore */ }
      this.wsToKey.delete(existing);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [keyHash]);
    this.bridges.set(keyHash, server);
    this.wsToKey.set(server, keyHash);

    server.send(JSON.stringify({
      type: 'registered',
      message: 'Bridge registered successfully',
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Check bridge status. Requires auth.
   */
  private handleStatus(request: Request): Response {
    const providedKeyHash = request.headers.get('X-Key-Hash');
    if (!providedKeyHash) {
      return Response.json({ error: 'Invalid key' }, { status: 403 });
    }

    const ws = this.getBridge(providedKeyHash);
    if (!ws) {
      return Response.json({ error: 'Bridge not connected' }, { status: 404 });
    }

    return Response.json({
      online: true,
      activeBridges: this.bridges.size, // This metric might be slightly off if we rely on recovery, but good enough
    });
  }

  /**
   * Forward request to the bridge matching the provided keyHash.
   */
  private async handleForward(request: Request): Promise<Response> {
    const providedKeyHash = request.headers.get('X-Key-Hash');
    if (!providedKeyHash) {
      return Response.json({ error: 'Invalid key' }, { status: 403 });
    }

    const ws = this.getBridge(providedKeyHash);
    if (!ws) {
      return Response.json({ error: 'Bridge not connected' }, { status: 404 });
    }

    const body = await request.json() as { method: string; params?: unknown };
    const requestId = crypto.randomUUID();

    try {
      const result = await this.forwardToBridge(ws, requestId, body.method, body.params);
      return Response.json(result);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 502 });
    }
  }

  private forwardToBridge(ws: WebSocket, requestId: string, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout (60s)'));
      }, 60_000);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      ws.send(JSON.stringify({ type: 'request', requestId, method, params }));
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const msg = JSON.parse(
        typeof message === 'string' ? message : new TextDecoder().decode(message)
      );

      if (msg.type === 'response' && msg.requestId) {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.requestId);
          pending.resolve(msg.result);
        }
      } else if (msg.type === 'rotate_key' && msg.newKeyHash) {
        // Move this WS from old keyHash to new keyHash
        const oldKey = this.wsToKey.get(ws);
        if (oldKey) {
          this.bridges.delete(oldKey);
        }
        this.bridges.set(msg.newKeyHash, ws);
        this.wsToKey.set(ws, msg.newKeyHash);
        ws.send(JSON.stringify({
          type: 'registered',
          message: 'Key rotated successfully',
        }));
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('[BridgeRelay] failed to parse message:', err);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const keyHash = this.wsToKey.get(ws);
    if (keyHash) {
      this.bridges.delete(keyHash);
      this.wsToKey.delete(ws);
      console.log(`[BridgeRelay] bridge disconnected (key: ${keyHash.slice(0, 12)}...)`);
    }
    // Reject pending requests that were sent to this ws
    // (In practice, pendingRequests don't track which ws they target,
    //  but they'll timeout naturally)
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[BridgeRelay] ws error:', error);
    const keyHash = this.wsToKey.get(ws);
    if (keyHash) {
      this.bridges.delete(keyHash);
      this.wsToKey.delete(ws);
    }
  }

  /**
   * Helper to retrieve a bridge WebSocket by keyHash.
   * If not in memory (due to DO hibernation/restart), try to recover via tags.
   */
  private getBridge(keyHash: string): WebSocket | undefined {
    // 1. Fast path: check in-memory cache
    if (this.bridges.has(keyHash)) {
      return this.bridges.get(keyHash);
    }

    // 2. Slow path: recover from Hibernation API tags
    const sockets = this.ctx.getWebSockets(keyHash);
    if (sockets.length > 0) {
      // Just pick the first one found (simplicity)
      const ws = sockets[0];
      this.bridges.set(keyHash, ws);
      this.wsToKey.set(ws, keyHash);
      return ws;
    }

    return undefined;
  }
}
