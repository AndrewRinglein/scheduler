/**
 * A3 — Demo control bar.
 *
 * A band across the top of the page that is impossible to mistake for chrome,
 * shown only on the demo tenant. It exists so that nobody — including the
 * person who built it — is ever unsure which tenant they are looking at.
 * The demo and the real halls share one database; the only thing standing
 * between "I'll just try this" and a real schedule is knowing where you are.
 *
 * It also surfaces demo-guard blocks. A guard that throws into the console is
 * a guard nobody notices. This puts the block on screen, in the bar, in words.
 *
 * Self-contained: styles are injected, no build step, no dependencies.
 */

import { isDemo, customerFromSearch, installDemoGuard } from './demo-guard.js';

const STYLE_ID = 'demo-bar-style';
const BAR_ID = 'demo-bar';

const CSS = `
#${BAR_ID} {
  position: sticky; top: 0; z-index: 9999;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 14px;
  background: repeating-linear-gradient(
    45deg, #7a3d00, #7a3d00 12px, #8a4700 12px, #8a4700 24px);
  color: #fff;
  font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  border-bottom: 2px solid #4a2500;
  box-shadow: 0 2px 6px rgba(0,0,0,.25);
}
#${BAR_ID} .demo-tag {
  background: #fff; color: #7a3d00; padding: 2px 8px;
  border-radius: 3px; letter-spacing: .08em; font-weight: 700;
}
#${BAR_ID} .demo-msg { font-weight: 400; opacity: .95; }
#${BAR_ID} .demo-spacer { flex: 1 1 auto; }
#${BAR_ID} button {
  font: inherit; font-weight: 600; cursor: pointer;
  background: rgba(255,255,255,.15); color: #fff;
  border: 1px solid rgba(255,255,255,.5); border-radius: 4px;
  padding: 4px 10px;
}
#${BAR_ID} button:hover  { background: rgba(255,255,255,.28); }
#${BAR_ID} button:active { transform: translateY(1px); }
#${BAR_ID} select {
  font: inherit; padding: 3px 6px; border-radius: 4px;
  border: 1px solid rgba(255,255,255,.5);
  background: rgba(255,255,255,.15); color: #fff;
}
#${BAR_ID} select option { color: #222; }
#${BAR_ID} .demo-alert {
  flex: 1 1 100%; margin-top: 6px; padding: 7px 10px;
  background: #fff; color: #8a1f00;
  border-left: 4px solid #c0392b; border-radius: 3px;
  font-weight: 400;
}
`;

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

/**
 * Render the bar. No-op on any tenant that is not demo — this must never
 * appear on a real hall's screen, so the check is the first thing it does.
 *
 * @param {object}   opts
 * @param {Document} [opts.doc]
 * @param {Array}    [opts.halls]     [{id, name}] for the hall switcher
 * @param {string}   [opts.hallId]    currently selected hall
 * @param {Function} [opts.onHallChange]
 * @param {Function} [opts.onReset]   omit and the reset button is not shown
 * @returns {HTMLElement|null}
 */
export function renderDemoBar(opts = {}) {
  const doc = opts.doc || document;
  const customer = opts.customer !== undefined
    ? opts.customer
    : customerFromSearch(doc.defaultView?.location?.search || '');

  if (!isDemo(customer)) return null;

  injectStyle(doc);
  doc.getElementById(BAR_ID)?.remove();

  const bar = doc.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('role', 'status');

  const tag = doc.createElement('span');
  tag.className = 'demo-tag';
  tag.textContent = 'DEMO';
  bar.appendChild(tag);

  const msg = doc.createElement('span');
  msg.className = 'demo-msg';
  msg.textContent = 'Practice data. Click anything — no real schedule can be reached from here.';
  bar.appendChild(msg);

  bar.appendChild(Object.assign(doc.createElement('span'), { className: 'demo-spacer' }));

  if (Array.isArray(opts.halls) && opts.halls.length) {
    const sel = doc.createElement('select');
    sel.setAttribute('aria-label', 'Demo hall');
    for (const h of opts.halls) {
      const o = doc.createElement('option');
      o.value = h.id;
      o.textContent = h.name;
      if (h.id === opts.hallId) o.selected = true;
      sel.appendChild(o);
    }
    if (typeof opts.onHallChange === 'function') {
      sel.addEventListener('change', () => opts.onHallChange(sel.value));
    }
    bar.appendChild(sel);
  }

  if (typeof opts.onReset === 'function') {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reset demo data';
    btn.addEventListener('click', () => opts.onReset());
    bar.appendChild(btn);
  }

  doc.body.insertBefore(bar, doc.body.firstChild);
  return bar;
}

/** Show a guard block in the bar. Falls back to nothing if the bar is absent. */
export function showBlockedWrite(err, doc = document) {
  const bar = doc.getElementById(BAR_ID);
  if (!bar) return false;
  bar.querySelector('.demo-alert')?.remove();
  const alert = doc.createElement('div');
  alert.className = 'demo-alert';
  alert.setAttribute('role', 'alert');
  alert.textContent =
    `Blocked: something tried to write to "${err.targetCustomer}" ` +
    `while you are viewing "${err.activeCustomer}". Nothing was sent. ` +
    `This is a bug worth reporting, not something you did.`;
  bar.appendChild(alert);
  return true;
}

/** Convenience: guard + bar together, wired so blocks are visible. */
export function initDemoMode(opts = {}) {
  const doc = opts.doc || document;
  const win = doc.defaultView || globalThis;
  installDemoGuard(win, (err) => showBlockedWrite(err, doc));
  return renderDemoBar({ ...opts, doc });
}
