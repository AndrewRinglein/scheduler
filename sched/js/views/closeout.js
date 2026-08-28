/* ---------------------------------------------------------------------------
   End of night: who did not close out.

   Two ways a shift is left open — still clocked in, or gone to lunch and never
   punched back — and both cost real money if nobody notices, because the hours
   keep running. The MOD sees them all here and texts them in one press.

   What comes back is a CLAIM, not a correction. The worker says when they
   actually finished; it lands as a pending row and only moves the clock when a
   manager approves it. Anything else would let a token rewrite its own paid
   hours, which is the one thing a time clock exists to prevent.
--------------------------------------------------------------------------- */

function tf(ts){
  if(!ts) return '—';
  const d=new Date(ts);
  return `${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')}${d.getHours()<12?'am':'pm'}`;
}
const CLOSE_LABEL = {
  clock_out: 'never clocked out',
  meal_end:  'never came back from lunch',
};

function viewCloseout(){
  const rows = D.unclosed;
  if (rows == null) return `<div class="panel">Checking…</div>`;

  if (!rows.length) return `<h2>End of night</h2>
    <div class="panel"><div class="note ok">Everybody closed out. Nothing to chase.</div></div>`;

  /* Somebody with no phone and no email cannot be asked, so they are separated
     out rather than silently counted in the "texted 5 people" total. */
  const askable = rows.filter(r => r.reachable && !r.fix);
  const waiting = rows.filter(r => r.fix && r.fix.status === 'open');
  const answered = rows.filter(r => r.fix && r.fix.status === 'answered');
  const unreachable = rows.filter(r => !r.reachable);

  const line = r => `<tr>
    <td>${personLabel(r.staff_id, r.name)}</td>
    <td><span class="chip ${r.kind === 'meal_end' ? 'planned' : 'draft'}">${
      esc(CLOSE_LABEL[r.kind])}</span></td>
    <td class="rtime">${esc(String(r.date))} · ${esc(HALLNAME[r.hall] || r.hall)}</td>
    <td class="rtime">in ${tf(r.clock_in)}</td>
    <td class="rtime">should have been ${tf(r.expected_at)}</td>
    <td>${
      !r.reachable ? '<span class="short">no phone or email</span>'
      : r.fix && r.fix.status === 'answered'
        ? `<strong>says ${tf(r.fix.proposed_at)}</strong>
           <button class="btn primary" data-tfok="${r.fix.id}">Approve</button>
           <button class="btn" data-tfno="${r.fix.id}">Reject</button>`
      : r.fix ? '<span class="rtime">asked, waiting</span>'
      : '<span class="rtime">not asked yet</span>'}</td>
  </tr>`;

  const table = list => `<div class="panel" style="overflow-x:auto"><table>
    <tbody>${list.map(line).join('')}</tbody></table></div>`;

  return `<h2>End of night <span class="rtime">${rows.length} not closed out</span></h2>
    ${answered.length ? `<h2>They have answered — ${answered.length}</h2>${table(answered)}` : ''}
    ${askable.length ? `<h2>Not asked yet — ${askable.length}</h2>${table(askable)}
      <div class="panel" style="margin-top:10px">
        <button class="btn primary" id="tfsend">Text ${askable.length} ${
          askable.length === 1 ? 'person' : 'people'} to set their time</button>
        <span class="rtime" style="margin-left:10px">Each gets their own problem named
          and a link to their page. Pressing this twice does not send twice.</span>
      </div>` : ''}
    ${waiting.length ? `<h2>Asked, waiting — ${waiting.length}</h2>${table(waiting)}` : ''}
    ${unreachable.length ? `<h2>Cannot be asked — ${unreachable.length}</h2>${table(unreachable)}
      <div class="note warn">These have no phone number and no email, so the app cannot
        reach them at all. Add contact details on the Staff tab, or fix the time by hand.</div>` : ''}`;
}

/* The payload request_time_fixes() wants: only the people who can actually be
   reached and have not already been asked. */
function closeoutAskPayload(){
  return (D.unclosed || [])
    .filter(r => r.reachable && !r.fix)
    .map(r => ({ entry_id: r.entry_id, staff_id: r.staff_id, kind: r.kind,
                 expected_at: r.expected_at, punch_id: r.punch_id || null }));
}
