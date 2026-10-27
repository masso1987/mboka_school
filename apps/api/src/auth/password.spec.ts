import { generateTemporaryPassword, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the correct password and rejects others', async () => {
    const hash = await hashPassword('Corr3ct horse');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('Corr3ct horse', hash)).resolves.toBe(true);
    await expect(verifyPassword('corr3ct horse', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toEqual(await hashPassword('same'));
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
  });

  it('generates temporary passwords of the requested length', () => {
    expect(generateTemporaryPassword(20)).toHaveLength(20);
  });
});
