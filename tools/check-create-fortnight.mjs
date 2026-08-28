/* Does Create Fortnight WORK in the offline demo? Angela pressed it on the
   Pages site and nothing happened — the stub had no schedule_period_start_on.
   This drives the real button: pick 2026-08-28, press Create, and require
   (1) the picker lands on the new fortnight, (2) day cards render with
   sessions, (3) an assignment pick sticks and shows as "· 1 shift" in the
   other dropdowns. */
import { chromium } from 'playwright';
import { freshNaked } from './naked.mjs';

const dir = freshNaked();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

page.on('pageerror', e => fail('pageerror: ' + e.message));
await page.goto('file://' + dir + '/demo.html');
await page.waitForSelector('#psel', { timeout: 15000 });

const before = await page.evaluate(() =>
  [...document.querySelectorAll('#psel option')].map(o => o.textContent.trim()));
console.log('picker before:', before);

await page.fill('#pstart', '2026-08-28');
await page.click('#pstartgo');
await page.waitForTimeout(700);

const who = await page.evaluate(() => document.getElementById('who')?.textContent || '');
console.log('flash:', JSON.stringify(who.trim()));
if (!/Fortnight ready/.test(who)) fail('no "Fortnight ready" flash — got: ' + who);
await page.waitForTimeout(600);

const picked = await page.evaluate(() => {
  const sel = document.getElementById('psel');
  return sel ? sel.selectedOptions[0]?.textContent.trim() : '(no #psel)';
});
console.log('picker after:', JSON.stringify(picked));
if (!/Aug 28/.test(picked || '')) fail('picker not on the new fortnight: ' + picked);

const shape = await page.evaluate(() => ({
  cards: document.querySelectorAll('#main .card').length,
  dropdowns: document.querySelectorAll('#main select[data-a]').length,
}));
console.log('day cards:', shape.cards, ' assignment dropdowns:', shape.dropdowns);
if (!shape.cards) fail('no day cards rendered for the new fortnight');
if (!shape.dropdowns) fail('no assignment dropdowns rendered');

// Pick the first available person in the first dropdown; the save must stick.
const pick = await page.evaluate(() => {
  const sel = document.querySelector('#main select[data-a]');
  const opt = [...sel.options].find(o => o.value && !o.disabled);
  if (!opt) return null;
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { value: opt.value, name: opt.textContent.trim(), key: sel.dataset.a };
});
if (!pick) fail('first dropdown had nobody to pick');
await page.waitForTimeout(1000);
const after = await page.evaluate((p) => {
  const sel = document.querySelector(`#main select[data-a="${p.key}"]`)
    || document.querySelector('#main select[data-a]');
  const others = [...document.querySelectorAll('#main select[data-a]')]
    .filter(s => s !== sel);
  let counted = null;
  for (const s of others) {
    const o = [...s.options].find(o => o.value === p.value);
    if (o) { counted = o.textContent.trim(); break; }
  }
  return { stuck: sel && sel.value === p.value, counted };
}, pick);
console.log('picked', pick?.name, '— stuck:', after.stuck,
  ' another dropdown offers:', JSON.stringify(after.counted));
if (!after.stuck) fail('assignment pick did not stick after reload/render');
if (!/1 shift/.test(after.counted || '')) fail('shift count missing: ' + after.counted);

// An overlapping Create must refuse with the live RPC's wording.
await page.fill('#pstart', '2026-09-01');
await page.click('#pstartgo');
await page.waitForTimeout(800);
const clash = await page.evaluate(() => document.getElementById('who')?.textContent || '');
console.log('overlap flash:', JSON.stringify(clash.trim()));
if (!/overlaps the fortnight/.test(clash)) fail('overlap not refused: ' + clash);

// Refresh: demo resets to the shipped snapshot.
await page.reload();
await page.waitForSelector('#psel', { timeout: 15000 });
const reset = await page.evaluate(() =>
  [...document.querySelectorAll('#psel option')].map(o => o.textContent.trim()));
console.log('picker after reload:', reset);
if (reset.length !== before.length) fail('reload did not reset the snapshot');

console.log(process.exitCode ? 'CHECK FAILED' : 'ok — Create makes a fillable fortnight in the demo');
await browser.close();
