/* CSV export.

   Excel is the thing these numbers get checked in, so the output is written
   for Excel rather than for elegance:
     - values are always quoted, so a comma in a name or a break reason cannot
       shift every following column
     - a leading =, +, - or @ is prefixed with an apostrophe, because Excel
       treats those as formulas and a name like "-Dana" would otherwise be
       evaluated (this is also the CSV-injection hole)
     - CRLF line endings, which Excel expects
     - a UTF-8 BOM, so accented names survive the round trip */

function csvCell(v) {
  if (v == null) return '""';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function downloadCsv(filename, headers, rows) {
  const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/* ---------------- Excel workbook ----------------
   One file, two sheets. CSV is a single flat table by definition, so a
   workbook is the only way to put the summary and the session detail in one
   thing the user opens once.

   The same formula guard applies: Excel evaluates a cell beginning =, +, -
   or @, so a name like "-Dana" would be computed and =HYPERLINK() is a real
   exfiltration route in a file that gets emailed to payroll. */

function safeCell(v){
  if (v == null) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function sheetFrom(headers, rows){
  const aoa = [headers.map(safeCell), ...rows.map(r => r.map(safeCell))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  /* Column widths from the content, so nothing opens as ####. */
  ws['!cols'] = headers.map((h, i) => ({
    wch: Math.min(42, Math.max(String(h).length + 2,
      ...rows.map(r => String(r[i] ?? '').length + 2))) }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

function downloadWorkbook(filename, sheets){
  if (typeof XLSX === 'undefined') {
    throw new Error('The Excel library did not load — check the network connection.');
  }
  const wb = XLSX.utils.book_new();
  for (const { name, headers, rows } of sheets) {
    XLSX.utils.book_append_sheet(wb, sheetFrom(headers, rows), name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
