import { csrfMatches } from './session.guard';
import { hashToken } from './session.service';

describe('csrfMatches', () => {
  it('accepts only the exact token', () => {
    expect(csrfMatches('abc123', 'abc123')).toBe(true);
    expect(csrfMatches('abc124', 'abc123')).toBe(false);
    expect(csrfMatches('abc', 'abc123')).toBe(false);
    expect(csrfMatches(undefined, 'abc123')).toBe(false);
    expect(csrfMatches('', 'abc123')).toBe(false);
  });
});

describe('hashToken', () => {
  it('is a deterministic SHA-256 hex digest', () => {
    const token = 'raw-session-token';
    expect(hashToken(token)).toEqual(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});
