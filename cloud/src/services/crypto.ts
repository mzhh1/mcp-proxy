/**
 * SHA-256 hash with salt using Web Crypto API (Cloudflare Workers compatible)
 */
export async function hashWithSalt(value: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(value + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
