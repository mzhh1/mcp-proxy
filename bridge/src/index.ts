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
    console.log(`📋 Node ID: ${nodeId}`);
    console.log(`\n📌 远程调用示例:`);
    console.log(`   curl http://localhost:8787/mcp/${nodeId}/tools \\`);
    console.log(`     -H "Authorization: Bearer ${rawKey}"`);
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

    console.log('🚀 Starting MCP Bridge...');
    console.log(`   Cloud:  ${config.cloudUrl}`);
    console.log(`   Pieces: ${config.piecesEndpoint}`);
    console.log(`   NodeID: ${config.nodeId}\n`);

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
 * status: Show current configuration.
 */
program
  .command('status')
  .description('Show current bridge configuration')
  .action(() => {
    const config = loadConfig();
    if (!config) {
      console.log('❌ No configuration found. Run `mcp-bridge init` first.');
      return;
    }

    console.log('📋 MCP Bridge Status');
    console.log('-'.repeat(40));
    console.log(`Config: ${getConfigPath()}`);
    console.log(`Cloud:  ${config.cloudUrl}`);
    console.log(`Pieces: ${config.piecesEndpoint}`);
    console.log(`NodeID: ${config.nodeId}`);
    console.log(`KeyHash: ${config.keyHash.slice(0, 12)}...`);
  });

program.parse();
