import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAINTENANCE, maintenanceSchema, maintenanceState, securitySchema } from './platform-settings';

const now = new Date('2026-11-03T10:00:00Z');
const window = (start: string, end: string, notify = true) => ({ ...DEFAULT_MAINTENANCE, startsAt: start, endsAt: end, notify });

test('maintenance is on when switched on, or inside its window', () => {
  assert.deepEqual(maintenanceState(DEFAULT_MAINTENANCE, now), { active: false, upcoming: false });
  assert.deepEqual(maintenanceState({ ...DEFAULT_MAINTENANCE, enabled: true }, now), { active: true, upcoming: false });
  assert.deepEqual(maintenanceState(window('2026-11-03T09:00:00Z', '2026-11-03T11:00:00Z'), now), { active: true, upcoming: false });
  assert.deepEqual(maintenanceState(window('2026-11-03T08:00:00Z', '2026-11-03T10:00:00Z'), now), { active: false, upcoming: false }); // end excluded
});

test('a coming window is announced only when asked, within 72 hours', () => {
  assert.equal(maintenanceState(window('2026-11-04T22:00:00Z', '2026-11-05T02:00:00Z'), now).upcoming, true);
  assert.equal(maintenanceState(window('2026-11-04T22:00:00Z', '2026-11-05T02:00:00Z', false), now).upcoming, false);
  assert.equal(maintenanceState(window('2026-11-10T22:00:00Z', '2026-11-11T02:00:00Z'), now).upcoming, false);
});

test('a window needs both ends, in order; idle timeout is off or at least 15 minutes', () => {
  assert.equal(maintenanceSchema.safeParse({ ...DEFAULT_MAINTENANCE, startsAt: '2026-11-04T22:00:00Z' }).success, false);
  assert.equal(maintenanceSchema.safeParse(window('2026-11-05T02:00:00Z', '2026-11-04T22:00:00Z')).success, false);
  assert.equal(maintenanceSchema.safeParse(window('2026-11-04T22:00:00+01:00', '2026-11-05T02:00:00+01:00')).success, true);
  assert.equal(securitySchema.safeParse({ sessionHours: 12, idleMinutes: 0 }).success, true);
  assert.equal(securitySchema.safeParse({ sessionHours: 12, idleMinutes: 5 }).success, false);
});
