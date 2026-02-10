import { Hono } from 'hono';
import type { Env, BridgeMessage } from '../types';
import {
  registerBridge,
  unregisterBridge,
  getBridge,
  updateKeyHash,
  resolveRequest,
} from '../services/registry';

const bridge = new Hono<{ Bindings: Env }>();

/**
 * GET /ws/bridge
 * WebSocket upgrade endpoint for local bridges.
 * Bridge connects with query params: ?nodeId=xxx&keyHash=yyy
 */
bridge.get('/', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  }

  const nodeId = c.req.query('nodeId');
  const keyHash = c.req.query('keyHash');

  if (!nodeId || !keyHash) {
    return c.json({ error: 'Missing nodeId or keyHash query params' }, 400);
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  // Register this bridge
  registerBridge(nodeId, keyHash, server);
  console.log(`[bridge] registered: ${nodeId}`);

  server.send(
    JSON.stringify({
      type: 'registered',
      message: 'Bridge registered successfully',
    })
  );

  server.addEventListener('message', (event) => {
    try {
      const msg: BridgeMessage = JSON.parse(
        typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
      );

      if (msg.type === 'response' && msg.requestId) {
        // Bridge is responding to a forwarded request
        resolveRequest(msg.requestId, msg.result);
      } else if (msg.type === 'rotate_key' && msg.newKeyHash) {
        // Bridge wants to rotate its key
        const success = updateKeyHash(nodeId, msg.newKeyHash);
        server.send(
          JSON.stringify({
            type: success ? 'registered' : 'error',
            message: success ? 'Key rotated successfully' : 'Failed to rotate key',
          })
        );
      }
    } catch (err) {
      console.error('[bridge] failed to parse message:', err);
    }
  });

  server.addEventListener('close', () => {
    console.log(`[bridge] disconnected: ${nodeId}`);
    unregisterBridge(nodeId);
  });

  server.addEventListener('error', (err) => {
    console.error(`[bridge] error for ${nodeId}:`, err);
    unregisterBridge(nodeId);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
});

export default bridge;
