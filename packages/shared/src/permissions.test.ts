import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROLES } from './roles';
import { hasAllPermissions, isPermissionKey, PERMISSION_KEYS } from './permissions';
import { academicYearSchema } from './schemas';

test('every default role references only catalogued permissions', () => {
  for (const role of DEFAULT_ROLES) {
    for (const p of role.permissions) assert.ok(isPermissionKey(p), `${role.key}: ${p}`);
  }
});

test('permission keys follow module.resource.action or module.action', () => {
  for (const key of PERMISSION_KEYS) assert.match(key, /^[a-z]+(\.[a-z]+){1,2}$/);
});

test('hasAllPermissions requires every permission', () => {
  assert.equal(hasAllPermissions(['students.read'], ['students.read']), true);
  assert.equal(hasAllPermissions(['students.read'], ['students.read', 'students.update']), false);
  assert.equal(hasAllPermissions(new Set<string>(), []), true);
});

test('teacher role cannot approve grades (separation of duties default)', () => {
  const teacher = DEFAULT_ROLES.find((r) => r.key === 'teacher');
  assert.ok(teacher);
  assert.equal(teacher.permissions.includes('grades.approve'), false);
});

test('academic year rejects end date before start date', () => {
  const r = academicYearSchema.safeParse({ name: '2026-2027', startDate: '2027-07-01', endDate: '2026-09-01' });
  assert.equal(r.success, false);
});
