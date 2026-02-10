import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { machineIdSync } = require('node-machine-id');

/**
 * Get the raw machine ID.
 */
export function getRawMachineId(): string {
  return machineIdSync({ original: true });
}

/**
 * Hash the machine ID via the cloud /api/hash endpoint.
 */
export async function getHashedMachineId(cloudUrl: string): Promise<string> {
  const rawId = getRawMachineId();
  const response = await fetch(`${cloudUrl}/api/hash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: rawId }),
  });

  if (!response.ok) {
    throw new Error(`Hash request failed: ${response.status}`);
  }

  const data = (await response.json()) as { hash: string };
  return data.hash;
}
