import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface BridgeConfig {
  cloudUrl: string;
  nodeId: string; // hashed machine ID
  keyHash: string; // hashed API key
  piecesEndpoint: string;
}

const CONFIG_DIR = join(homedir(), '.mcp-bridge');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Ensure the config directory exists.
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load the saved config, or return null if not found.
 */
export function loadConfig(): BridgeConfig | null {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as BridgeConfig;
  } catch {
    return null;
  }
}

/**
 * Save config to disk.
 */
export function saveConfig(config: BridgeConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get the config file path (for display purposes).
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
