/**
 * Environment bindings for Cloudflare Workers
 */
export type Env = {
  HASH_SALT: string;
  BRIDGE_RELAY: DurableObjectNamespace;
};

/**
 * MCP call request body from remote clients
 */
export interface MCPCallRequest {
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Hash request body
 */
export interface HashRequest {
  value: string;
}
