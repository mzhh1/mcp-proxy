import { Hono } from 'hono';
import type { Env, MCPCallRequest } from '../types';
import { hashWithSalt } from '../services/crypto';
import { getBridge, forwardRequest, isBridgeOnline } from '../services/registry';

const mcp = new Hono<{ Bindings: Env }>();

/**
 * Shared auth middleware for /mcp/:nodeId/* routes.
 * Validates Bearer token against the registered bridge's key hash.
 */
async function authMiddleware(
  c: any,
  next: () => Promise<void>
): Promise<Response | void> {
  const nodeId = c.req.param('nodeId');
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const rawKey = authHeader.slice(7); // strip "Bearer "

  // Check if bridge is online
  const bridge = getBridge(nodeId);
  if (!bridge) {
    return c.json({ error: 'Bridge not online', nodeId }, 404);
  }

  // Hash the provided key and compare with registered key hash
  const keyHash = await hashWithSalt(rawKey, c.env.HASH_SALT);
  if (keyHash !== bridge.keyHash) {
    return c.json({ error: 'Invalid key' }, 403);
  }

  await next();
}

/**
 * GET /mcp/:nodeId/tools
 * Retrieve the list of available MCP tools from the bridge.
 */
mcp.get('/:nodeId/tools', authMiddleware, async (c) => {
  const nodeId = c.req.param('nodeId');
  const requestId = crypto.randomUUID();

  try {
    const result = await forwardRequest(nodeId, requestId, 'tools/list', undefined);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

/**
 * POST /mcp/:nodeId/call
 * Forward an MCP tool call to the bridge.
 */
mcp.post('/:nodeId/call', authMiddleware, async (c) => {
  const nodeId = c.req.param('nodeId');
  const body = await c.req.json<MCPCallRequest>();

  if (!body.method) {
    return c.json({ error: 'Missing "method" field in request body' }, 400);
  }

  const requestId = crypto.randomUUID();

  try {
    const result = await forwardRequest(nodeId, requestId, body.method, body.params);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

/**
 * GET /mcp/:nodeId/status
 * Check if a bridge is online (no auth required).
 */
mcp.get('/:nodeId/status', (c) => {
  const nodeId = c.req.param('nodeId');
  const online = isBridgeOnline(nodeId);
  return c.json({ nodeId, online });
});

export default mcp;
