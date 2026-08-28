import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* csv.js is written for the browser, so load it the way the build does. */
const src = readFileSync(new URL('../sched/js/csv.js', import.meta.url), 'utf8');
const { csvCell, toCsv } = new Function(src + '; return {csvCell, toCsv};')();

test('every value is quoted, so a comma cannot shift columns', () => {
  const out = toCsv(['A','B'], [['first meal not taken; 2 rests missed', 'x']]);
  assert.match(out, /"first meal not taken; 2 rests missed","x"/);
});

test('embedded quotes are doubled, not dropped', () => {
  assert.equal(csvCell('O"Brien'), '"O""Brien"');
});

test('formula characters are neutralised — this is CSV injection', () => {
  // Excel evaluates a cell starting =, +, - or @. A name like "-Dana" would be
  // computed, and =HYPERLINK(...) is a genuine exfiltration vector.
  for (const s of ['=SUM(A1)', '+1', '-Dana', '@cmd']) {
    assert.equal(csvCell(s)[1], "'", `${s} must be prefixed`);
  }
});

test('a plain value is not mangled', () => {
  assert.equal(csvCell('James C.'), '"James C."');
  assert.equal(csvCell(7.75), '"7.75"');
});

test('null and undefined become empty cells, not the text "null"', () => {
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
});

test('output carries a BOM and CRLF endings for Excel', () => {
  const out = toCsv(['A'], [['x']]);
  assert.equal(out.charCodeAt(0), 0xFEFF);
  assert.ok(out.includes('\r\n'));
});
