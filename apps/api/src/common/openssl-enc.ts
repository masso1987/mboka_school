import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * Same format as `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt` (scripts/backup.sh), so a file encrypted
 * here opens with the documented command:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in <file> -out <file without .enc>
 * Layout: "Salted__" + 8-byte salt + AES-256-CBC ciphertext; key and IV from PBKDF2-HMAC-SHA256 of the password.
 */
export const OPENSSL_ITERATIONS = 200_000;
const MAGIC = Buffer.from('Salted__');

function keyIv(password: string, salt: Buffer) {
  const derived = pbkdf2Sync(password, salt, OPENSSL_ITERATIONS, 48, 'sha256');
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

export function opensslEncrypt(data: Buffer, password: string): Buffer {
  const salt = randomBytes(8);
  const { key, iv } = keyIv(password, salt);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([MAGIC, salt, cipher.update(data), cipher.final()]);
}

export function opensslDecrypt(file: Buffer, password: string): Buffer {
  if (!file.subarray(0, 8).equals(MAGIC)) throw new Error('not an openssl salted file');
  const { key, iv } = keyIv(password, file.subarray(8, 16));
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(file.subarray(16)), decipher.final()]);
}
