import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { hashWithSalt } from './services/crypto';
import { BridgeRelay } from './services/bridge-relay';

// Re-export for wrangler to discover the Durable Object
export { BridgeRelay };

type AppEnv = {
  Bindings: Env;
};

const app = new Hono<AppEnv>();

// Middleware
app.use('*', cors());
app.use('*', logger());

// ─── POST /api/hash ──────────────────────────────────────
app.post('/api/hash', async (c) => {
  const body = await c.req.json<{ value: string }>();
  if (!body.value || typeof body.value !== 'string') {
    return c.json({ error: 'Missing or invalid "value" field' }, 400);
  }
  const hashed = await hashWithSalt(body.value, c.env.HASH_SALT);
  return c.json({ hash: hashed });
});

// ─── GET /ws/bridge ──────────────────────────────────────
// Bridge WebSocket connection routed to Durable Object
app.get('/ws/bridge', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  }

  const nodeId = c.req.query('nodeId');
  const keyHash = c.req.query('keyHash');
  if (!nodeId || !keyHash) {
    return c.json({ error: 'Missing nodeId or keyHash query params' }, 400);
  }

  // Route to Durable Object by nodeId
  const id = c.env.BRIDGE_RELAY.idFromName(nodeId);
  const stub = c.env.BRIDGE_RELAY.get(id);

  // Forward the WebSocket upgrade to the Durable Object
  return stub.fetch(new Request('http://internal/connect', {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
      'X-Key-Hash': keyHash,
    },
  }));
});

// ─── GET /mcp/:nodeId/status ─────────────────────────────
app.get('/mcp/:nodeId/status', async (c) => {
  const nodeId = c.req.param('nodeId');
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const rawKey = authHeader.slice(7);
  const keyHash = await hashWithSalt(rawKey, c.env.HASH_SALT);

  const id = c.env.BRIDGE_RELAY.idFromName(nodeId);
  const stub = c.env.BRIDGE_RELAY.get(id);

  const res = await stub.fetch(new Request('http://internal/status', {
    headers: { 'X-Key-Hash': keyHash },
  }));
  return new Response(res.body, res);
});

// ─── GET /mcp/:nodeId/tools ──────────────────────────────
app.get('/mcp/:nodeId/tools', async (c) => {
  const nodeId = c.req.param('nodeId');
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const rawKey = authHeader.slice(7);
  const keyHash = await hashWithSalt(rawKey, c.env.HASH_SALT);

  const id = c.env.BRIDGE_RELAY.idFromName(nodeId);
  const stub = c.env.BRIDGE_RELAY.get(id);

  const res = await stub.fetch(new Request('http://internal/forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Key-Hash': keyHash },
    body: JSON.stringify({ method: 'tools/list' }),
  }));
  return new Response(res.body, res);
});

// ─── POST /mcp/:nodeId/call ──────────────────────────────
app.post('/mcp/:nodeId/call', async (c) => {
  const nodeId = c.req.param('nodeId');
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const rawKey = authHeader.slice(7);
  const keyHash = await hashWithSalt(rawKey, c.env.HASH_SALT);

  const body = await c.req.json<{ method: string; params?: unknown }>();
  if (!body.method) {
    return c.json({ error: 'Missing "method" field in request body' }, 400);
  }

  const id = c.env.BRIDGE_RELAY.idFromName(nodeId);
  const stub = c.env.BRIDGE_RELAY.get(id);

  const res = await stub.fetch(new Request('http://internal/forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Key-Hash': keyHash },
    body: JSON.stringify({ method: body.method, params: body.params }),
  }));
  return new Response(res.body, res);
});

// ─── Health check ────────────────────────────────────────
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Root ────────────────────────────────────────────────
app.get('/', (c) => {
  return c.json({
    name: 'MCP Cloud Relay',
    version: '1.0.0',
    endpoints: {
      hash: 'POST /api/hash',
      bridge: 'GET /ws/bridge?nodeId=&keyHash= (WebSocket)',
      mcpCall: 'POST /mcp/:nodeId/call (Bearer auth)',
      mcpTools: 'GET /mcp/:nodeId/tools (Bearer auth)',
      mcpStatus: 'GET /mcp/:nodeId/status',
      health: 'GET /health',
    },
  });
});

export default app;
