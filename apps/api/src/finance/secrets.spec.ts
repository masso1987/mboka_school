import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, sign, signatureValid } from './secrets';

describe('provider secrets', () => {
  beforeAll(() => {
    process.env.PAYMENT_SECRETS_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips through AES-256-GCM and never stores the clear text', () => {
    const stored = encryptSecret('whsec_0123456789abcdef');
    expect(stored).not.toContain('whsec');
    expect(decryptSecret(stored)).toBe('whsec_0123456789abcdef');
  });

  it('detects tampering', () => {
    const [v, iv, tag, data] = encryptSecret('secret-value-123456').split('.');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });

  it('accepts only the exact HMAC of the exact body', () => {
    const body = Buffer.from('{"transactionId":"T1"}');
    const sig = sign('k'.repeat(20), body);
    expect(signatureValid('k'.repeat(20), body, sig)).toBe(true);
    expect(signatureValid('k'.repeat(20), Buffer.from('{"transactionId":"T2"}'), sig)).toBe(false);
    expect(signatureValid('k'.repeat(20), body, undefined)).toBe(false);
    expect(signatureValid('k'.repeat(20), body, 'zz')).toBe(false);
  });
});
