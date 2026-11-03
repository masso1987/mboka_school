import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenceSchema, licensedPermissions, moduleOfPermission } from './modules';
import { PERMISSION_KEYS } from './permissions';

test('every permission belongs to one module or to the core', () => {
  assert.equal(moduleOfPermission('hr.payroll.approve'), 'payroll'); // longest prefix wins over nothing in hr.
  assert.equal(moduleOfPermission('hr.staff.read'), 'hr');
  assert.equal(moduleOfPermission('reports.financial.read'), 'finance');
  assert.equal(moduleOfPermission('academics.assignments.manage'), 'timetable');
  assert.equal(moduleOfPermission('academics.years.read'), null);
  assert.equal(moduleOfPermission('users.invite'), null);
  // Every hr.* permission is licensed somewhere: none falls into the core by accident.
  for (const key of PERMISSION_KEYS) if (key.startsWith('hr.')) assert.notEqual(moduleOfPermission(key), null, key);
});

test('a licence removes the permissions of the modules it leaves off, never the core', () => {
  const perms = ['students.read', 'fees.invoice.read', 'hr.payroll.manage', 'users.invite', 'academics.years.read'];
  assert.deepEqual([...licensedPermissions(perms, [])].sort(), [...perms].sort());
  assert.deepEqual([...licensedPermissions(perms, ['students'])].sort(), ['academics.years.read', 'students.read', 'users.invite']);
});

test('licence input', () => {
  const base = { plan: 'standard', status: 'ACTIVE', maxStudents: 500, maxCampuses: 2, maxUsers: 40, modules: null, trialEndsAt: null, currentUntil: '2027-06-30', notes: null };
  assert.equal(licenceSchema.safeParse(base).success, true);
  assert.equal(licenceSchema.safeParse({ ...base, modules: [] }).success, false);
  assert.equal(licenceSchema.safeParse({ ...base, modules: ['students', 'wizardry'] }).success, false);
});
