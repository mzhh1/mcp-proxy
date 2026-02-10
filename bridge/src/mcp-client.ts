/**
 * MCP Streamable HTTP Client
 * Connects to local Pieces OS via the 2025-03-26 Streamable HTTP transport.
 */

export class MCPClient {
  private endpoint: string;
  private sessionId: string | null = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  /**
   * Initialize the MCP session by sending the 'initialize' handshake.
   */
  async initialize(): Promise<void> {
    const payload = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'mcp-bridge',
          version: '1.0.0',
        },
      },
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(payload),
    });

    // Extract session ID from response headers
    const sid = response.headers.get('mcp-session-id');
    if (sid) {
      this.sessionId = sid;
    }

    const data = await response.json();
    console.log('[mcp-client] initialized:', JSON.stringify(data));
  }

  /**
   * Send a JSON-RPC request to the local MCP server.
   */
  async sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.sessionId) {
      await this.initialize();
    }

    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      ...(params !== undefined && { params }),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    // Update session ID if changed
    const sid = response.headers.get('mcp-session-id');
    if (sid) {
      this.sessionId = sid;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MCP request failed (${response.status}): ${text}`);
    }

    return response.json();
  }

  /**
   * List available MCP tools.
   */
  async listTools(): Promise<unknown> {
    return this.sendRequest('tools/list');
  }

  /**
   * Call an MCP tool.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest('tools/call', { name, arguments: args });
  }
}
