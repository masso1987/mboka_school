import { DEFAULT_ROLES } from '@mboka/shared';
import { describe, expect, it } from 'vitest';
import { visibleNavItems } from './nav';

const canFor = (roleKey: string) => {
  const perms = new Set<string>(DEFAULT_ROLES.find((r) => r.key === roleKey)?.permissions ?? []);
  return (p: string) => perms.has(p);
};

describe('navigation filtering', () => {
  it('shows a teacher only teaching-related modules', () => {
    const keys = visibleNavItems(canFor('teacher')).map((i) => i.key);
    expect(keys).toContain('attendance');
    expect(keys).toContain('grades');
    expect(keys).not.toContain('fees');
    expect(keys).toContain('hr'); // own leave requests
    expect(keys).not.toContain('portal');
    expect(keys).not.toContain('administration');
  });

  it('shows a cashier finance but not grades', () => {
    const keys = visibleNavItems(canFor('cashier')).map((i) => i.key);
    expect(keys).toContain('fees');
    expect(keys).not.toContain('grades');
  });

  it('shows the director everything except the family portal', () => {
    expect(visibleNavItems(canFor('director')).map((i) => i.key)).not.toContain('portal');
    expect(visibleNavItems(canFor('director'))).toHaveLength(15);
  });

  it('always shows the dashboard and announcements', () => {
    expect(visibleNavItems(() => false).map((i) => i.key)).toEqual(['dashboard', 'community']);
  });

  it('shows a parent only the dashboard, the portal and announcements', () => {
    expect(visibleNavItems(canFor('parent')).map((i) => i.key)).toEqual(['dashboard', 'portal', 'community']);
  });
});
