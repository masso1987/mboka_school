import { describe, expect, it } from 'vitest';
import en from './en.json';
import fr from './fr.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('translations', () => {
  it('French and English define exactly the same keys (Definition of Done §16)', () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });
});
