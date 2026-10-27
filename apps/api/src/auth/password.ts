import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt via node:crypto avoids native build dependencies on Windows/Alpine.
// Parameters are stored with each hash so they can be raised later without breaking old hashes.
const N = 2 ** 15;
const r = 8;
const p = 1;
const KEY_LEN = 64;

function derive(password: string, salt: Buffer, n: number, rr: number, pp: number, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, len, { N: n, r: rr, p: pp, maxmem: 128 * n * rr * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, r, p, KEY_LEN);
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, rr, pp, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), Number(n), Number(rr), Number(pp), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A real hash of a random password, verified against when the user does not exist (equalizes timing). */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** Readable one-time password for provisioning (no ambiguous characters). */
export function generateTemporaryPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
