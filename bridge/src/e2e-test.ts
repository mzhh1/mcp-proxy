/**
 * End-to-end integration test for Cloud MCP Bridge.
 *
 * Prerequisites:
 * 1. Cloud relay running: cd cloud && npx wrangler dev
 * 2. Pieces OS running on localhost:39300
 *
 * This script will:
 * 1. Generate a key and hash it via cloud
 * 2. Get hashed machine ID
 * 3. Start bridge, connect to cloud
 * 4. Make remote curl-style calls via cloud relay
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import WebSocket from 'ws';

const require2 = createRequire(import.meta.url);
const { machineIdSync } = require2('node-machine-id');

const CLOUD_URL = 'http://localhost:8787';
const PIECES_MCP = 'http://localhost:39300/model_context_protocol/2025-03-26/mcp';

async function cloudHash(value: string): Promise<string> {
  const res = await fetch(`${CLOUD_URL}/api/hash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const data = (await res.json()) as { hash: string };
  return data.hash;
}

async function main() {
  console.log('=== Cloud MCP Bridge E2E Test ===\n');

  // Step 1: Generate key and hash it
  const rawKey = randomUUID();
  console.log(`[1] Generated raw key: ${rawKey}`);
  const keyHash = await cloudHash(rawKey);
  console.log(`    Key hash: ${keyHash.slice(0, 20)}...`);

  // Step 2: Hash machine ID
  const rawMachineId = machineIdSync({ original: true });
  const nodeId = await cloudHash(rawMachineId);
  console.log(`[2] Node ID: ${nodeId.slice(0, 20)}...`);

  // Step 3: Connect bridge via WebSocket
  console.log('[3] Connecting bridge to cloud...');
  const wsUrl = `ws://localhost:8787/ws/bridge?nodeId=${nodeId}&keyHash=${keyHash}`;

  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 10000);
    ws.on('open', () => {
      clearTimeout(timeout);
      console.log('    ✅ WebSocket connected');
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'registered') {
        console.log(`    ✅ ${msg.message}`);
        resolve();
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Handle forwarded requests from cloud → bridge → local MCP
  let mcpSessionId: string | null = null;

  // Initialize local MCP session
  console.log('[4] Initializing local MCP session...');
  try {
    const initPayload = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      },
    };
    const initRes = await fetch(PIECES_MCP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(initPayload),
    });
    const sid = initRes.headers.get('mcp-session-id');
    if (sid) mcpSessionId = sid;
    console.log(`    ✅ MCP session: ${mcpSessionId?.slice(0, 15)}...`);
  } catch (err) {
    console.log(`    ⚠️ MCP init failed (may still work): ${err}`);
  }

  // Bridge: handle incoming cloud requests
  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type !== 'request') return;

    console.log(`    📥 Bridge received: ${msg.method}`);

    try {
      // Forward to local MCP
      const mcpPayload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: msg.method,
        ...(msg.params && { params: msg.params }),
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (mcpSessionId) headers['mcp-session-id'] = mcpSessionId;

      const mcpRes = await fetch(PIECES_MCP, {
        method: 'POST',
        headers,
        body: JSON.stringify(mcpPayload),
      });

      const sid = mcpRes.headers.get('mcp-session-id');
      if (sid) mcpSessionId = sid;

      const result = await mcpRes.json();
      console.log(`    📤 Bridge responding`);

      ws.send(JSON.stringify({
        type: 'response',
        requestId: msg.requestId,
        result,
      }));
    } catch (err: any) {
      ws.send(JSON.stringify({
        type: 'response',
        requestId: msg.requestId,
        result: { error: err.message },
      }));
    }
  });

  // Step 5: Test remote calls via cloud REST API
  console.log('\n[5] Testing remote calls via cloud relay...\n');

  // Test 5a: Check bridge status (requires auth)
  console.log('--- Test: /mcp/:nodeId/status (Bearer auth) ---');
  const statusRes = await fetch(`${CLOUD_URL}/mcp/${nodeId}/status`, {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  const statusData = await statusRes.json() as any;
  console.log(`    Result: ${JSON.stringify(statusData)}`);
  console.log(`    ${statusData.online ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test 5b: List tools with Bearer auth
  console.log('--- Test: /mcp/:nodeId/tools (Bearer auth) ---');
  const toolsRes = await fetch(`${CLOUD_URL}/mcp/${nodeId}/tools`, {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  console.log(`    HTTP Status: ${toolsRes.status}`);

  if (toolsRes.ok) {
    const toolsData = (await toolsRes.json()) as any;
    if (toolsData?.result?.tools) {
      const tools = toolsData.result.tools;
      console.log(`    Found ${tools.length} tools:`);
      for (const t of tools) {
        console.log(`      - ${t.name}`);
      }
      console.log('    ✅ PASS\n');
    } else {
      console.log(`    Response: ${JSON.stringify(toolsData).slice(0, 200)}`);
      console.log('    ⚠️ Unexpected format\n');
    }
  } else {
    const err = await toolsRes.text();
    console.log(`    Error: ${err}`);
    console.log('    ❌ FAIL\n');
  }

  // Test 5c: Call ask_pieces_ltm
  console.log('--- Test: /mcp/:nodeId/call (ask_pieces_ltm) ---');
  const callRes = await fetch(`${CLOUD_URL}/mcp/${nodeId}/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rawKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'ask_pieces_ltm',
        arguments: {
          question: '今天我做了什么',
          chat_llm: 'gpt-4o',
          connected_client: 'e2e-test',
        },
      },
    }),
  });
  console.log(`    HTTP Status: ${callRes.status}`);

  if (callRes.ok) {
    const callData = (await callRes.json()) as any;
    const text = callData?.result?.content?.[0]?.text;
    if (text) {
      console.log(`    LTM response length: ${text.length} chars`);
      console.log(`    Preview: ${text.slice(0, 150)}...`);
      console.log('    ✅ PASS\n');
    } else {
      console.log(`    Response: ${JSON.stringify(callData).slice(0, 300)}`);
      console.log('    ⚠️ Check response format\n');
    }
  } else {
    const err = await callRes.text();
    console.log(`    Error: ${err}`);
    console.log('    ❌ FAIL\n');
  }

  // Test 5d: Wrong key should be rejected
  console.log('--- Test: Invalid Bearer key (should fail) ---');
  const badRes = await fetch(`${CLOUD_URL}/mcp/${nodeId}/tools`, {
    headers: { Authorization: 'Bearer wrong-key-12345' },
  });
  console.log(`    HTTP Status: ${badRes.status} (expect 403)`);
  console.log(`    ${badRes.status === 403 ? '✅ PASS' : '❌ FAIL'}\n`);

  // Cleanup
  ws.close();
  console.log('=== E2E Test Complete ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
