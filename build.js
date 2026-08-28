/**
 * Inline sched/js/*.js into manager.html so the page works from a plain
 * double-click (file://). ES modules cannot load over file://, and the page
 * being openable matters more than the page being modular.
 *
 * The files under sched/js/ are the source of truth — the tests import those.
 * This only copies them in, between the markers, so it is safe to re-run.
 * An earlier version matched on the <script type="module"> tag instead, which
 * meant a second run silently did nothing and a newly-added module never
 * reached the page.
 */
import { readFileSync, writeFileSync } from 'node:fs';

// Order matters: config and helpers first, then pure logic, then data access,
// then views, then the wiring that calls them.
const MODULES = [
  'sched/js/core.js',
  'sched/js/ca-overtime.js',
  'sched/js/ca-regular-rate.js',
  'sched/js/ca-breaks.js',
  'sched/js/break-planner.js',
  'sched/js/attendance-alerts.js',
  'sched/js/caller-rotation.js',
  'sched/js/csv.js',
  'sched/js/api.js',
  'sched/js/schedule-fill.js',
  'sched/js/views/week.js',
  'sched/js/views/staff.js',
  'sched/js/views/availability.js',
  'sched/js/views/roster.js',
  'sched/js/views/closeout.js',
  'sched/js/views/demo.js',
  'sched/js/views/hours.js',
  'sched/js/views/template.js',
  'sched/js/views/commission.js',
  'sched/js/views/attention.js',
  'sched/js/views/breakplan.js',
  'sched/js/views/messages.js',
  'sched/js/app.js',
];
const PAGE = 'sched/manager.html';

/* board.html needs only the planner, so it stays small enough to sit on a TV
   stick with a slow connection. */
const BOARD = { page: 'sched/board.html',
                modules: ['sched/js/break-planner.js', 'sched/js/attendance-alerts.js'] };

/* The characters, inlined. sched/js/art-sit.js holds all 66 at rest;
   art-all.js adds the walking pose, which only the break board uses. These are
   generated from sched/art by tools/embed-art.sh and are large on purpose —
   a 1.4 MB page that always shows its art beats a 120 KB one that sometimes
   does not. */
const ART_SIT = 'sched/js/art-sit.js';
const ART_ALL = 'sched/js/art-all.js';
const START = '/* @modules-start */';
const END = '/* @modules-end */';

const inlined = MODULES.map(p =>
  `/* ── from ${p} — edit that file, then run: node build.js ── */\n` +
  readFileSync(p, 'utf8')
    .replace(/^export\s+/gm, '')
    .replace(/^import[^;]*;$/gm, '')
).join('\n');

/* Put the character data at the very top of the page's own script, so it is
   defined before anything reads it. Replaces any previous block, so building
   twice does not stack two copies. */
const ART_START = '/* @art-start */', ART_END = '/* @art-end */';
function withArt(pageHtml, artFile) {
  const data = readFileSync(artFile, 'utf8');
  const block = `${ART_START}\n${data}${ART_END}\n`;
  const s0 = pageHtml.indexOf(ART_START), s1 = pageHtml.indexOf(ART_END);
  if (s0 !== -1 && s1 !== -1) {
    return pageHtml.slice(0, s0) + block + pageHtml.slice(s1 + ART_END.length + 1);
  }
  /* First time: go in right after the page's own <script> opening — the last
     one, which is the page's, not the CDN tags above it. */
  const tags = [...pageHtml.matchAll(/<script>/g)];
  const at = tags[tags.length - 1].index + '<script>'.length;
  return pageHtml.slice(0, at) + '\n' + block + pageHtml.slice(at);
}

const html = readFileSync(PAGE, 'utf8');
const a = html.indexOf(START), b = html.indexOf(END);
if (a === -1 || b === -1) throw new Error(`markers missing in ${PAGE} — cannot build`);

const out = html.slice(0, a + START.length) + '\n' + inlined + '\n' + html.slice(b);
/* The art is spliced in AFTER the guards below have run over `out`. Those
   guards regex-scan the script for called-but-undefined functions, and a
   megabyte of base64 is exactly the kind of thing that produces nonsense
   matches. Verify the code, then add the pictures. */
/* manager.html now carries the WALKING poses too, not just the sitting ones.
   The demo tab reproduces the break board including its yard of wandering
   characters, and petSrc(pet, kind, 'walk') fell through to a relative path
   that resolves nowhere on a double-clicked file -- so every character in the
   yard was an invisible broken image. Costs about 1.3 MB; board.html has
   carried the same for months. */
writeFileSync(PAGE, withArt(out, ART_ALL));

// Verify every exported name actually reached the page, rather than trusting it.
const missing = [];
for (const p of MODULES) {
  for (const m of readFileSync(p, 'utf8').matchAll(/^export (?:function|const) (\w+)/gm)) {
    if (!out.includes(m[1])) missing.push(`${m[1]} (${p})`);
  }
}
if (missing.length) throw new Error('not inlined: ' + missing.join(', '));

// Refuse to ship a page whose view functions are referenced but not defined.
// A patching mistake deleted viewStaff once and it only surfaced at runtime,
// as a blank screen with a console error.
const script = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
// Every function the page CALLS must be defined somewhere in it. The earlier
// version only checked view* names, which is why losing boot() got through and
// only surfaced when a user clicked Sign in.
const defined = new Set([
  ...[...script.matchAll(/function (\w+)\s*\(/g)].map(m => m[1]),
  ...[...script.matchAll(/(?:const|let|var) (\w+)\s*=/g)].map(m => m[1]),
]);
const BUILTIN = new Set(['if','for','while','switch','catch','return','typeof','function',
  'await','new','delete','void','super','fetch','Number','String','Boolean','Array','Object',
  'Math','JSON','Date','Promise','Set','Map','parseInt','parseFloat','isNaN','confirm','alert',
  'setTimeout','clearTimeout','require','import','Error','RegExp','decodeURIComponent',
  'encodeURIComponent','of','in','do','else','try','async','yield','case',
  'var','calc','rgba','translateY','url',   // CSS functions inside template literals
  'type','step','value','min','max','width','class','style',   // HTML attrs in nested templates
  'change','s','n','each',   // plain words inside nested template literals
  'inner','sched_assignments_staff_id_fkey','sched_caller_positions_staff_id_fkey']);  // PostgREST embed hints
// Strip comments and string/template literals first — otherwise ordinary prose
// inside a comment reads as a function call and the check cries wolf.
//
// ORDER MATTERS, and getting it wrong is silent. Template literals go first:
// they are the ones that contain English, and English contains apostrophes.
// With single quotes stripped first, `${p.name}'s meal` opened a "string" at
// that apostrophe and closed it at the next one several lines away, deleting
// the code between and exposing the PostgREST embed hints inside it as
// undefined function calls. The build failed complaining about
// sched_declines_staff_id_fkey, which appears nowhere near the change.
const code = script
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''");
const called = new Set([...code.matchAll(/(?:^|[^.\w$])(\w+)\s*\(/g)].map(m => m[1]));
const undef = [...called].filter(n => !defined.has(n) && !BUILTIN.has(n) && isNaN(Number(n)));
if (undef.length) throw new Error(`page calls undefined function(s): ${undef.join(', ')}`);

// Every data-* hook a view emits must have a handler reading dataset.<name>.
// Three handlers went missing in the file split and nothing noticed: the page
// parsed, every function existed, and clicking simply did nothing.
const hooks = new Set([...script.matchAll(/data-([a-z]+)=/g)].map(m => m[1]));
const IGNORE = new Set(['v', 'i']);            // nav tabs and card index, handled positionally
const unhandled = [...hooks].filter(h =>
  !IGNORE.has(h) && !new RegExp(`dataset\\.${h}\\b`).test(script));
if (unhandled.length) throw new Error(
  `views emit data-${unhandled.join(', data-')} but nothing reads dataset.${unhandled[0]}`);

try { new Function('supabase', script.replace(/\nboot\(\);/, '')); }
catch (e) { throw new Error(`page does not parse: ${e.message}`); }

// An element toggled via .hidden must not carry an unconditional display rule,
// because `display` beats [hidden] and the element stays on screen forever.
// This is how the allocation modal became a floating white box.
const css = (out.match(/<style>([\s\S]*?)<\/style>/) || ['',''])[1];
for (const m of out.matchAll(/\$\('(\w+)'\)\.hidden\s*=/g)) {
  const id = m[1];
  const rule = new RegExp(`#${id}\\s*\\{[^}]*display\\s*:`, 'i');
  const escape_ = new RegExp(`#${id}\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none`, 'i');
  if (rule.test(css) && !escape_.test(css)) {
    throw new Error(`#${id} is toggled with .hidden but has a display rule and no #${id}[hidden]{display:none}`);
  }
}

// --- board.html ---
{
  const inlinedBoard = BOARD.modules.map(p =>
    `/* from ${p} — edit that file, then run: node build.js */\n` +
    readFileSync(p, 'utf8').replace(/^export\s+/gm, '').replace(/^import[^;]*;$/gm, '')
  ).join('\n');
  const bh = readFileSync(BOARD.page, 'utf8');
  const ba = bh.indexOf(START), bb = bh.indexOf(END);
  if (ba === -1 || bb === -1) throw new Error(`markers missing in ${BOARD.page}`);
  const bout = bh.slice(0, ba + START.length) + '\n' + inlinedBoard + '\n' + bh.slice(bb);
  const bscript = [...bout.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  try { new Function('supabase', 'document', 'setInterval', 'alert', bscript.replace(/\nboot\(\);/, '')); }
  catch (e) { throw new Error(`board.html does not parse: ${e.message}`); }
  writeFileSync(BOARD.page, withArt(bout, ART_ALL));
  console.log(`inlined ${BOARD.modules.length} module -> ${BOARD.page} (${(bout.length/1024).toFixed(1)} KB)`);
}

console.log(`inlined ${MODULES.length} modules -> ${PAGE} (${(out.length/1024).toFixed(1)} KB)`);
/* These pages are opened by double-clicking a file. A lazily-loaded image on a
   file:// page is never fetched — the browser does not even issue the request —
   so every character renders as a broken image and nothing appears in the
   console to explain why. It cost a round trip to find; it does not get to
   come back. */
for (const f of [PAGE, BOARD.page, 'sched/me.html', 'sched/clock.html']) {
  const html = readFileSync(f, 'utf8');
  if (/<img[^>]*loading\s*=\s*["']lazy/.test(html)) {
    throw new Error(`${f} has an <img loading="lazy">. These pages run from ` +
      `file:// where lazy images are never fetched at all. Remove it.`);
  }
}

/* me.html classifies its own overtime, using the same tested module as the
   manager app rather than a second copy of the rules. */
{
  const src = readFileSync('sched/js/ca-overtime.js', 'utf8')
    .replace(/^export\s+/gm, '').replace(/^import[^;]*;$/gm, '');
  const page = readFileSync('sched/me.html', 'utf8');
  const a = page.indexOf(START), b = page.indexOf(END);
  if (a === -1 || b === -1) throw new Error('markers missing in sched/me.html');
  writeFileSync('sched/me.html',
    page.slice(0, a + START.length) + '\n' +
    `/* from sched/js/ca-overtime.js — edit that file, then run: node build.js */\n` +
    src + '\n' + page.slice(b));
}

/* clock.html and me.html are hand-written rather than assembled, but they draw
   the same characters and need the same independence from file paths. */
for (const f of ['sched/clock.html', 'sched/me.html']) {
  const before = readFileSync(f, 'utf8');
  const after = withArt(before, ART_SIT);
  if (after !== before) writeFileSync(f, after);
  console.log(`art embedded -> ${f} (${(after.length/1048576).toFixed(2)} MB)`);
}

console.log(`verified: exports inlined, ${defined.size} functions defined, no undefined view refs, parses clean`);
