import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface BridgeConfig {
  cloudUrl: string;
  nodeId: string; // hashed machine ID
  keyHash: string; // hashed API key
  piecesEndpoint: string;
}

export interface ClientConfig {
  bridgeUrl: string;
  apiKey: string;
}

const CONFIG_DIR = join(homedir(), '.mcp-bridge');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CLIENT_CONFIG_FILE = join(CONFIG_DIR, 'client-config.json');

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

/**
 * Load the saved client config, or return null if not found.
 */
export function loadClientConfig(): ClientConfig | null {
  try {
    const raw = readFileSync(CLIENT_CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as ClientConfig;
  } catch {
    return null;
  }
}

/**
 * Save client config to disk.
 */
export function saveClientConfig(config: ClientConfig): void {
  ensureConfigDir();
  writeFileSync(CLIENT_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get the client config file path (for display purposes).
 */
export function getClientConfigPath(): string {
  return CLIENT_CONFIG_FILE;
}
