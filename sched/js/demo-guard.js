/**
 * A2 — Demo guard.
 *
 * Two jobs, both of which exist because there is no staging environment and
 * the demo tenant lives in the same database as paying customers:
 *
 *   1. Say unambiguously whether the current page is the demo tenant.
 *   2. Refuse any write whose target tenant is not the tenant the page is
 *      currently showing.
 *
 * Job 2 is the important one. The failure it prevents is quiet and expensive:
 * a manager clicking around the demo, a stale customer id somewhere in a code
 * path, and a write landing on a real hall's schedule. Nothing would look
 * wrong at the time. The guard turns that into a thrown error at the moment
 * it happens, which is the only point at which it is cheap to notice.
 *
 * It is deliberately dumb. It does not know about roles, RLS or permissions —
 * the database enforces those. It only checks one invariant: the tenant you
 * are writing to is the tenant you are looking at.
 */

export const DEMO_CUSTOMER = 'demo';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Read the active customer id out of a query string. */
export function customerFromSearch(search = '') {
  const raw = String(search).replace(/^\?/, '');
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    if (decodeURIComponent(k) === 'customer') {
      return decodeURIComponent(v).trim() || null;
    }
  }
  return null;
}

/** Is this the demo tenant? Exact match only — no prefixes, no guessing. */
export function isDemo(customer) {
  return customer === DEMO_CUSTOMER;
}

/**
 * Pull the customer id a Supabase REST URL is targeting, if it names one.
 * Handles `customer_id=eq.demo`, which is how PostgREST filters are written.
 * Returns null when the URL does not mention a customer at all — callers must
 * decide what to do about that rather than having it silently pass.
 */
export function targetCustomerFromUrl(url) {
  let qs;
  try {
    qs = new URL(url, 'https://placeholder.invalid').searchParams;
  } catch {
    return null;
  }
  const raw = qs.get('customer_id');
  if (!raw) return null;
  const m = /^(?:eq\.)?(.*)$/.exec(raw);
  return m ? decodeURIComponent(m[1]) : null;
}

export class TenantMismatchError extends Error {
  constructor(active, target, url) {
    super(
      `Blocked a write to tenant "${target}" while viewing tenant "${active}". ` +
      `This is the demo guard doing its job — the request was not sent. URL: ${url}`
    );
    this.name = 'TenantMismatchError';
    this.activeCustomer = active;
    this.targetCustomer = target;
    this.url = url;
  }
}

/**
 * Wrap a fetch implementation so cross-tenant writes throw instead of sending.
 *
 * @param {Function} fetchImpl      usually window.fetch
 * @param {Function} getActiveCustomer  called per request; returns the id the
 *                                      page is currently showing
 * @param {Function} [onBlock]      notified when a write is blocked
 */
export function createGuardedFetch(fetchImpl, getActiveCustomer, onBlock) {
  return function guardedFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();

    if (WRITE_METHODS.has(method)) {
      const active = getActiveCustomer();
      const target = targetCustomerFromUrl(url);

      // A write that names a tenant must name the one on screen.
      // A write that names no tenant is left alone: the row's own customer_id
      // and the RLS policy govern it, and guessing here would break legitimate
      // calls that address a row by primary key.
      if (target !== null && active != null && target !== active) {
        const err = new TenantMismatchError(active, target, url);
        if (typeof onBlock === 'function') onBlock(err);
        return Promise.reject(err);
      }
    }

    return fetchImpl(input, init);
  };
}

/** Install the guard on window.fetch. Idempotent. */
export function installDemoGuard(win = globalThis, onBlock) {
  if (!win || !win.fetch || win.__demoGuardInstalled) return false;
  const getActive = () => customerFromSearch(win.location ? win.location.search : '');
  win.fetch = createGuardedFetch(win.fetch.bind(win), getActive, onBlock);
  win.__demoGuardInstalled = true;
  return true;
}
