import { Hono } from 'hono';
import type { Env, HashRequest } from '../types';
import { hashWithSalt } from '../services/crypto';

const hash = new Hono<{ Bindings: Env }>();

/**
 * POST /api/hash
 * Public endpoint: accepts a value, returns SHA-256(value + SALT).
 * The salt never leaves the server.
 */
hash.post('/', async (c) => {
  const body = await c.req.json<HashRequest>();

  if (!body.value || typeof body.value !== 'string') {
    return c.json({ error: 'Missing or invalid "value" field' }, 400);
  }

  const hashed = await hashWithSalt(body.value, c.env.HASH_SALT);
  return c.json({ hash: hashed });
});

export default hash;
