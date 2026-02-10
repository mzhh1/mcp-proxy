#!/usr/bin/env node

import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { getHashedMachineId } from './identity.js';
import { loadConfig, saveConfig, getConfigPath } from './config.js';
import { Bridge } from './bridge.js';

const program = new Command();

program
  .name('mcp-bridge')
  .description('Bridge local Pieces MCP to cloud relay')
  .version('1.0.0');

/**
 * init: First-time setup. Generates API key, hashes machine ID,
 * and saves config.
 */
program
  .command('init')
  .description('Initialize bridge configuration')
  .requiredOption('--cloud <url>', 'Cloud relay URL (e.g. http://localhost:8787)')
  .option(
    '--pieces <url>',
    'Local Pieces MCP endpoint',
    'http://localhost:39300/model_context_protocol/2025-03-26/mcp'
  )
  .action(async (opts) => {
    const cloudUrl = opts.cloud.replace(/\/+$/, '');
    const piecesEndpoint = opts.pieces;

    console.log('🔧 Initializing MCP Bridge...\n');

    // Generate a new API key
    const rawKey = randomUUID();
    console.log(`🔑 Generated API Key: ${rawKey}`);
    console.log('⚠️  请妥善保管此 Key，仅显示一次！\n');

    // Hash the key via cloud
    console.log('📡 Hashing key via cloud...');
    const keyHashRes = await fetch(`${cloudUrl}/api/hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: rawKey }),
    });

    if (!keyHashRes.ok) {
      console.error(`❌ Cloud hash failed: ${keyHashRes.status}`);
      process.exit(1);
    }

    const { hash: keyHash } = (await keyHashRes.json()) as { hash: string };

    // Hash the machine ID via cloud
    console.log('📡 Hashing machine ID via cloud...');
    const nodeId = await getHashedMachineId(cloudUrl);

    // Save config
    const config = {
      cloudUrl,
      nodeId,
      keyHash,
      piecesEndpoint,
    };

    saveConfig(config);
    console.log(`\n✅ 配置已保存到: ${getConfigPath()}`);
    
    // Construct full bridge URL
    const fullBridgeUrl = `${cloudUrl}/mcp/${nodeId}`;

    console.log('\n🎉 Bridge Initialized Successfully!');
    console.log('----------------------------------------');
    console.log(`🌍 Bridge URL: ${fullBridgeUrl}`);
    console.log(`� API Key:    ${rawKey}`);
    console.log('----------------------------------------');
    console.log('⚠️  请妥善保管 API Key，它不会再次显示！');
    
    console.log(`\n👉 Next steps:`);
    console.log(`   1. Start the bridge:`);
    console.log(`      mcp-bridge start`);
    console.log(`   2. Test connection:`);
    console.log(`      mcp-bridge client --url ${fullBridgeUrl} --key ${rawKey}`);
  });

/**
 * start: Connect the bridge to the cloud relay.
 */
program
  .command('start')
  .description('Start the bridge and connect to cloud relay')
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      console.error('❌ No configuration found. Run `mcp-bridge init` first.');
      process.exit(1);
    }

    const fullBridgeUrl = `${config.cloudUrl}/mcp/${config.nodeId}`;

    console.log('🚀 Starting MCP Bridge...');
    console.log(`   Cloud:  ${config.cloudUrl}`);
    console.log(`   Pieces: ${config.piecesEndpoint}`);
    console.log(`   NodeID: ${config.nodeId}`);
    console.log(`   ---------------------------------------------------`);
    console.log(`   🌍 Bridge URL: ${fullBridgeUrl}`);
    console.log(`   ---------------------------------------------------`);
    console.log('\n');

    const bridge = new Bridge(config);

    // Graceful shutdown
    process.on('SIGINT', () => {
      bridge.stop();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      bridge.stop();
      process.exit(0);
    });

    await bridge.start();
  });

/**
 * rotate-key: Generate a new API key and update the cloud relay.
 */
program
  .command('rotate-key')
  .description('Generate a new API key and update the registration')
  .action(async () => {
    const config = loadConfig();
    if (!config) {
      console.error('❌ No configuration found. Run `mcp-bridge init` first.');
      process.exit(1);
    }

    const newKey = randomUUID();
    console.log(`🔑 New API Key: ${newKey}`);
    console.log('⚠️  请妥善保管此 Key，仅显示一次！\n');

    // Hash the new key
    const res = await fetch(`${config.cloudUrl}/api/hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newKey }),
    });

    if (!res.ok) {
      console.error(`❌ Cloud hash failed: ${res.status}`);
      process.exit(1);
    }

    const { hash: newKeyHash } = (await res.json()) as { hash: string };

    // Update config
    config.keyHash = newKeyHash;
    saveConfig(config);

    console.log('✅ 配置已更新');
    console.log('⚠️  如果 bridge 正在运行，请重启以生效');
  });

/**
 * client: Interactive client to test remote bridge
 */
program
  .command('client')
  .description('Connect to a remote bridge and test tools interactively')
  .option('--url <url>', 'Full bridge URL (e.g. https://cloud.com/mcp/{NODE_ID})')
  .option('--key <key>', 'API Key')
  .action(async (opts) => {
    const readline = await import('readline/promises');
    
    // 1. Get URL
    let baseUrl = opts.url;
    if (!baseUrl) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      baseUrl = await rl.question('Bridge URL: ');
      rl.close();
    }
    baseUrl = baseUrl.replace(/\/+$/, '');

    // 2. Get Key (Hidden)
    let key = opts.key;
    if (!key) {
      const { Writable } = await import('node:stream');
      let muted = false;
      const mutableStdout = new Writable({
        write: function(chunk, encoding, callback) {
          if (!muted) process.stdout.write(chunk, encoding);
          callback();
        }
      });
      const secureRl = readline.createInterface({
        input: process.stdin,
        output: mutableStdout,
        terminal: true
      });

      process.stdout.write('API Key: ');
      muted = true;
      key = await secureRl.question('');
      muted = false;
      secureRl.close();
      process.stdout.write('\n');
    }

    const headers = {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    };

    console.log(`\n🔌 Connecting to ${baseUrl}...\n`);

    try {
      // Check Status
      process.stdout.write('Checking status... ');
      const statusRes = await fetch(`${baseUrl}/status`, { headers });
      if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
      const status = await statusRes.json();
      console.log('✅ Online');
      console.log(status);

      // List Tools
      console.log('\nFetching tools...');
      const toolsRes = await fetch(`${baseUrl}/tools`, { headers });
      if (!toolsRes.ok) throw new Error(`List tools failed: ${toolsRes.status}`);
      const toolsData = (await toolsRes.json()) as any;
      const tools = toolsData.result?.tools || [];

      if (tools.length === 0) {
        console.log('⚠️  No tools found.');
        return;
      }

      console.table(tools.map((t: any) => ({
        Name: t.name,
        Description: t.description?.slice(0, 50) + (t.description?.length > 50 ? '...' : '')
      })));

      // Interactive Loop
      const rlLoop = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log('\n💡 Enter a tool name to call it, or "exit" to quit.');

      while (true) {
        const name = await rlLoop.question('\n> ');
        if (name.trim() === 'exit') break;
        if (!name.trim()) continue;

        const tool = tools.find((t: any) => t.name === name.trim());
        if (!tool) {
          console.log(`❌ Tool "${name}" not found.`);
          continue;
        }

        console.log(`\nCalling ${name}...`);
        console.log('Arguments (JSON, optional):'); 
        console.log(`Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`);
        
        const argsStr = await rlLoop.question('Enter args ({}): ');
        let args = {};
        try {
          args = argsStr.trim() ? JSON.parse(argsStr) : {};
        } catch (e) {
          console.log('❌ Invalid JSON arguments');
          continue;
        }

        const startTime = Date.now();
        try {
          const callRes = await fetch(`${baseUrl}/call`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              method: 'tools/call',
              params: { name, arguments: args }
            })
          });

          if (!callRes.ok) {
             const errText = await callRes.text();
             console.log(`❌ Call failed (${callRes.status}): ${errText}`);
          } else {
             const result = await callRes.json();
             console.log(`✅ Success (${Date.now() - startTime}ms)`);
             console.dir(result, { depth: null, colors: true });
          }
        } catch (err: any) {
          console.log(`❌ Error: ${err.message}`);
        }
      }

      rlLoop.close();

    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();
