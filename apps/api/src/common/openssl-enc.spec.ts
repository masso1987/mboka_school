import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opensslDecrypt, opensslEncrypt } from './openssl-enc';

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version']);
    return true;
  } catch {
    return false;
  }
})();

describe('openssl-compatible encryption', () => {
  const text = Buffer.from('{"école":"Collège Éloi","montant":"130000"}');

  it('round-trips and refuses the wrong password', () => {
    const enc = opensslEncrypt(text, 'a long backup password');
    expect(enc.subarray(0, 8).toString()).toBe('Salted__');
    expect(opensslDecrypt(enc, 'a long backup password').equals(text)).toBe(true);
    expect(() => opensslDecrypt(enc, 'not the password')).toThrow();
  });

  (hasOpenssl ? it : it.skip)('opens with the documented openssl command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mboka-enc-'));
    writeFileSync(join(dir, 'b.enc'), opensslEncrypt(text, 'a long backup password'));
    execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-pass', 'pass:a long backup password', '-in', join(dir, 'b.enc'), '-out', join(dir, 'b.json')]);
    expect(readFileSync(join(dir, 'b.json')).equals(text)).toBe(true);
  });
});
