import { HttpStatus } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiException } from '../common/api-error';

/**
 * Provider secrets are encrypted at rest with AES-256-GCM under PAYMENT_SECRETS_KEY
 * (32 bytes, base64), kept outside the database (§11.3). Format: v1.<iv>.<tag>.<ciphertext>.
 */
function key(): Buffer {
  const raw = process.env.PAYMENT_SECRETS_KEY;
  const k = raw ? Buffer.from(raw, 'base64') : undefined;
  if (!k || k.length !== 32) {
    throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'SECRETS_KEY_MISSING', 'PAYMENT_SECRETS_KEY is not configured');
  }
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** HMAC-SHA256 of the exact request bytes, hex encoded. */
export function sign(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function signatureValid(secret: string, body: Buffer, provided: string | undefined): boolean {
  if (!provided || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = Buffer.from(sign(secret, body), 'hex');
  return timingSafeEqual(expected, Buffer.from(provided, 'hex'));
}
