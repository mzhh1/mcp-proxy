import type { BridgeRecord } from '../types';

/**
 * In-memory registry of connected bridges.
 *
 * NOTE: In Cloudflare Workers, each isolate has its own memory.
 * For a single-instance dev setup this works fine.
 * For production at scale, migrate to Durable Objects.
 */
const bridges = new Map<string, BridgeRecord>();

/** Pending requests waiting for bridge responses */
const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

export function registerBridge(nodeId: string, keyHash: string, ws: WebSocket): void {
  // Close existing connection if any
  const existing = bridges.get(nodeId);
  if (existing) {
    try {
      existing.ws.close(1000, 'replaced');
    } catch {
      // ignore
    }
  }
  bridges.set(nodeId, { nodeId, keyHash, ws, connectedAt: Date.now() });
}

export function unregisterBridge(nodeId: string): void {
  bridges.delete(nodeId);
}

export function getBridge(nodeId: string): BridgeRecord | undefined {
  return bridges.get(nodeId);
}

export function updateKeyHash(nodeId: string, newKeyHash: string): boolean {
  const bridge = bridges.get(nodeId);
  if (!bridge) return false;
  bridge.keyHash = newKeyHash;
  return true;
}

export function isBridgeOnline(nodeId: string): boolean {
  return bridges.has(nodeId);
}

/**
 * Forward a request to a bridge and wait for the response.
 */
export function forwardRequest(
  nodeId: string,
  requestId: string,
  method: string,
  params: unknown,
  timeoutMs = 60_000
): Promise<unknown> {
  const bridge = bridges.get(nodeId);
  if (!bridge) {
    return Promise.reject(new Error('Bridge not online'));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Request timeout'));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });

    try {
      bridge.ws.send(
        JSON.stringify({
          type: 'request',
          requestId,
          method,
          params,
        })
      );
    } catch (err) {
      pendingRequests.delete(requestId);
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Resolve a pending request with the bridge's response.
 */
export function resolveRequest(requestId: string, result: unknown): void {
  const pending = pendingRequests.get(requestId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingRequests.delete(requestId);
    pending.resolve(result);
  }
}

/**
 * Get a summary of all connected bridges (for debug).
 */
export function listBridges(): Array<{ nodeId: string; connectedAt: number }> {
  return Array.from(bridges.values()).map((b) => ({
    nodeId: b.nodeId,
    connectedAt: b.connectedAt,
  }));
}
