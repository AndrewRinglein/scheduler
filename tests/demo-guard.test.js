import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  customerFromSearch,
  isDemo,
  targetCustomerFromUrl,
  createGuardedFetch,
  TenantMismatchError,
  installDemoGuard,
} from '../sched/js/demo-guard.js';

test('customerFromSearch reads the customer param', () => {
  assert.equal(customerFromSearch('?customer=demo'), 'demo');
  assert.equal(customerFromSearch('customer=fgs&hall=2'), 'fgs');
  assert.equal(customerFromSearch('?hall=2&customer=fgs'), 'fgs');
  assert.equal(customerFromSearch('?customer=a%20b'), 'a b');
});

test('customerFromSearch returns null when absent or blank', () => {
  assert.equal(customerFromSearch(''), null);
  assert.equal(customerFromSearch('?hall=2'), null);
  assert.equal(customerFromSearch('?customer='), null);
  assert.equal(customerFromSearch('?customer=%20%20'), null);
});

test('isDemo is exact — no prefix matching', () => {
  assert.equal(isDemo('demo'), true);
  assert.equal(isDemo('demo2'), false);
  assert.equal(isDemo('demonstration'), false);
  assert.equal(isDemo('DEMO'), false);
  assert.equal(isDemo(null), false);
});

test('targetCustomerFromUrl parses PostgREST eq. filters', () => {
  assert.equal(targetCustomerFromUrl('/rest/v1/staff?customer_id=eq.demo'), 'demo');
  assert.equal(targetCustomerFromUrl('/rest/v1/staff?customer_id=demo'), 'demo');
  assert.equal(targetCustomerFromUrl('/rest/v1/staff?select=id&customer_id=eq.fgs'), 'fgs');
  assert.equal(targetCustomerFromUrl('/rest/v1/staff?id=eq.123'), null);
  assert.equal(targetCustomerFromUrl('not a url at all'), null);
});

test('reads pass through even across tenants', async () => {
  let called = 0;
  const guarded = createGuardedFetch(async () => { called++; return 'ok'; }, () => 'demo');
  await guarded('/rest/v1/staff?customer_id=eq.fgs');                       // no method = GET
  await guarded('/rest/v1/staff?customer_id=eq.fgs', { method: 'GET' });
  assert.equal(called, 2);
});

test('same-tenant writes pass through', async () => {
  let called = 0;
  const guarded = createGuardedFetch(async () => { called++; return 'ok'; }, () => 'demo');
  await guarded('/rest/v1/staff?customer_id=eq.demo', { method: 'POST' });
  await guarded('/rest/v1/staff?customer_id=eq.demo', { method: 'PATCH' });
  assert.equal(called, 2);
});

test('THE IMPORTANT ONE: a write to another tenant is blocked, not sent', async () => {
  let called = 0;
  let blocked = null;
  const guarded = createGuardedFetch(
    async () => { called++; return 'ok'; },
    () => 'demo',
    (e) => { blocked = e; }
  );

  await assert.rejects(
    () => guarded('/rest/v1/scheduled_shifts?customer_id=eq.fgs', { method: 'DELETE' }),
    TenantMismatchError
  );

  assert.equal(called, 0, 'the request must not reach the network');
  assert.ok(blocked instanceof TenantMismatchError);
  assert.equal(blocked.activeCustomer, 'demo');
  assert.equal(blocked.targetCustomer, 'fgs');
});

test('and it blocks the reverse direction too — real page, demo write', async () => {
  let called = 0;
  const guarded = createGuardedFetch(async () => { called++; return 'ok'; }, () => 'fgs');
  await assert.rejects(
    () => guarded('/rest/v1/staff?customer_id=eq.demo', { method: 'POST' }),
    TenantMismatchError
  );
  assert.equal(called, 0);
});

test('writes that name no tenant are left alone', async () => {
  // Addressing a row by primary key is legitimate; RLS governs it.
  let called = 0;
  const guarded = createGuardedFetch(async () => { called++; return 'ok'; }, () => 'demo');
  await guarded('/rest/v1/staff?id=eq.abc-123', { method: 'PATCH' });
  assert.equal(called, 1);
});

test('all write verbs are covered', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'delete']) {
    const guarded = createGuardedFetch(async () => 'ok', () => 'demo');
    await assert.rejects(
      () => guarded('/rest/v1/x?customer_id=eq.other', { method }),
      TenantMismatchError,
      `${method} should be guarded`
    );
  }
});

test('installDemoGuard is idempotent and does not double-wrap', () => {
  const win = { fetch: async () => 'ok', location: { search: '?customer=demo' } };
  assert.equal(installDemoGuard(win), true);
  const wrappedOnce = win.fetch;
  assert.equal(installDemoGuard(win), false);
  assert.equal(win.fetch, wrappedOnce, 'second install must not re-wrap');
});
