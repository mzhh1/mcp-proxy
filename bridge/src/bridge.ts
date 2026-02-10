import WebSocket from 'ws';
import { MCPClient } from './mcp-client.js';
import type { BridgeConfig } from './config.js';

interface CloudMessage {
  type: string;
  requestId?: string;
  method?: string;
  params?: unknown;
  message?: string;
}

export class Bridge {
  private config: BridgeConfig;
  private ws: WebSocket | null = null;
  private mcpClient: MCPClient;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.mcpClient = new MCPClient(config.piecesEndpoint);
  }

  /**
   * Start the bridge: connect to cloud relay via WebSocket.
   */
  async start(): Promise<void> {
    // Initialize local MCP session first
    console.log('🔌 Initializing local MCP connection...');
    try {
      await this.mcpClient.initialize();
      console.log('✅ Local MCP session established');
    } catch (err) {
      console.error('❌ Failed to initialize MCP:', err);
      console.log('⚠️  Will retry MCP initialization when requests arrive');
    }

    this.connect();
  }

  private connect(): void {
    const wsUrl = new URL('/ws/bridge', this.config.cloudUrl.replace('http', 'ws'));
    wsUrl.searchParams.set('nodeId', this.config.nodeId);
    wsUrl.searchParams.set('keyHash', this.config.keyHash);

    console.log(`🌐 Connecting to cloud relay: ${wsUrl.origin}...`);

    this.ws = new WebSocket(wsUrl.toString());

    this.ws.on('open', () => {
      console.log('✅ Connected to cloud relay');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.ws.on('message', async (data) => {
      try {
        const msg: CloudMessage = JSON.parse(data.toString());

        if (msg.type === 'registered') {
          console.log(`🎉 ${msg.message}`);
          console.log(`📋 Node ID: ${this.config.nodeId}`);
          console.log('👂 Waiting for remote requests...\n');
        } else if (msg.type === 'request' && msg.requestId) {
          await this.handleRequest(msg);
        } else if (msg.type === 'error') {
          console.error(`❌ Cloud error: ${msg.message}`);
        }
      } catch (err) {
        console.error('❌ Failed to handle cloud message:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`🔌 Disconnected from cloud (${code}: ${reason.toString()})`);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('❌ WebSocket error:', err.message);
    });
  }

  private async handleRequest(msg: CloudMessage): Promise<void> {
    const { requestId, method, params } = msg;
    console.log(`📥 [${requestId}] ${method}`);

    try {
      let result: unknown;

      if (method === 'tools/list') {
        result = await this.mcpClient.listTools();
      } else if (method === 'tools/call') {
        const p = params as { name: string; arguments: Record<string, unknown> };
        result = await this.mcpClient.callTool(p.name, p.arguments);
      } else {
        result = await this.mcpClient.sendRequest(method!, params);
      }

      console.log(`📤 [${requestId}] responded`);

      this.ws?.send(
        JSON.stringify({
          type: 'response',
          requestId,
          result,
        })
      );
    } catch (err: any) {
      console.error(`❌ [${requestId}] error:`, err.message);
      this.ws?.send(
        JSON.stringify({
          type: 'response',
          requestId,
          result: { error: err.message },
        })
      );
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    const delay = 5000;
    console.log(`🔄 Reconnecting in ${delay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Rotate the key hash on the cloud relay.
   */
  rotateKey(newKeyHash: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to cloud relay');
    }

    this.ws.send(
      JSON.stringify({
        type: 'rotate_key',
        newKeyHash,
      })
    );

    this.config.keyHash = newKeyHash;
  }

  /**
   * Gracefully stop the bridge.
   */
  stop(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close(1000, 'bridge stopped');
    }
    console.log('👋 Bridge stopped');
  }
}
