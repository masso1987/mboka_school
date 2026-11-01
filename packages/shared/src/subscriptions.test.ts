import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCycle, signupSchema, subscriptionAccess } from './subscriptions';

const now = new Date('2026-10-27T12:00:00Z');
const day = 86_400_000;

test('a running trial is writable with days left, an ended one is read-only', () => {
  const running = subscriptionAccess({ status: 'TRIALING', trialEndsAt: new Date(now.getTime() + 10 * day), currentUntil: null }, now);
  assert.deepEqual([running.state, running.writable, running.daysLeft], ['TRIAL', true, 10]);
  const ended = subscriptionAccess({ status: 'TRIALING', trialEndsAt: new Date(now.getTime() - day), currentUntil: null }, now);
  assert.deepEqual([ended.state, ended.writable], ['EXPIRED', false]);
});

test('a lapsed subscription keeps 7 days of grace, then becomes read-only', () => {
  const grace = subscriptionAccess({ status: 'ACTIVE', trialEndsAt: null, currentUntil: new Date(now.getTime() - 3 * day) }, now);
  assert.deepEqual([grace.state, grace.writable, grace.daysLeft], ['GRACE', true, 4]);
  const expired = subscriptionAccess({ status: 'ACTIVE', trialEndsAt: null, currentUntil: new Date(now.getTime() - 8 * day) }, now);
  assert.deepEqual([expired.state, expired.writable], ['EXPIRED', false]);
});

test('no end date never expires', () => {
  assert.equal(subscriptionAccess({ status: 'ACTIVE', trialEndsAt: null, currentUntil: null }, now).writable, true);
});

test('billing periods end on the same day of the next month or year, clamped to month end', () => {
  assert.equal(addCycle(new Date('2026-01-31T00:00:00Z'), 'MONTHLY').toISOString().slice(0, 10), '2026-02-28');
  assert.equal(addCycle(new Date('2026-10-27T00:00:00Z'), 'MONTHLY').toISOString().slice(0, 10), '2026-11-27');
  assert.equal(addCycle(new Date('2028-02-29T00:00:00Z'), 'ANNUAL').toISOString().slice(0, 10), '2029-02-28');
});

test('sign-up needs the terms accepted and rejects a filled honeypot', () => {
  const base = { schoolName: 'Collège Test', city: 'Douala', ownerName: 'Awa Bello', ownerEmail: 'a@b.cm', phone: '+237670000000', password: 'long enough pass', plan: 'standard', acceptTerms: true };
  assert.equal(signupSchema.safeParse(base).success, true);
  assert.equal(signupSchema.safeParse({ ...base, acceptTerms: false }).success, false);
  assert.equal(signupSchema.safeParse({ ...base, website: 'http://spam' }).success, false);
});
