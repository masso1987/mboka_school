import { base32Decode, base32Encode, generateRecoveryCodes, hashRecoveryCode, hotp, verifyTotp } from './totp';

describe('TOTP (RFC 6238 / 4226)', () => {
  // RFC 4226 Appendix D: secret "12345678901234567890", counters 0–9.
  const rfcSecret = Buffer.from('12345678901234567890');
  const rfcHotp = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

  it('matches the RFC 4226 HOTP test vectors', () => {
    rfcHotp.forEach((expected, counter) => expect(hotp(rfcSecret, counter)).toBe(expected));
  });

  it('matches RFC 6238 at T=59s (8 digits → 94287082)', () => {
    expect(hotp(rfcSecret, Math.floor(59 / 30), 8)).toBe('94287082');
  });

  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(rfcSecret)).equals(rfcSecret)).toBe(true);
    expect(base32Encode(rfcSecret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('accepts the current code within one step of drift and rejects others', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = hotp(rfcSecret, step);
    expect(verifyTotp(secret, code, now)).toBe(step);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(step);
    expect(verifyTotp(secret, code, now + 90_000)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('generates distinct recovery codes and hashes them case-insensitively', () => {
    const { plain, hashed } = generateRecoveryCodes();
    expect(new Set(plain).size).toBe(10);
    expect(hashRecoveryCode(plain[0]!.toLowerCase())).toBe(hashed[0]);
  });
});
