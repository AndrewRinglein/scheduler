/* ---------------------------------------------------------------------------
   Rachel's list — the answer to "what needs me?"

   Decided: she gets no texts. Everything that wants her collects here.

   Two kinds of thing, and the difference matters. EVENTS happened at a moment
   — somebody declined, a shift changed hands — and can be marked seen. STATES
   are true until somebody fixes them: nobody has replied, a manager wants a
   third day off, a published night is short. Marking a state seen would be a
   lie, so they stay until the underlying fact changes.

   That is why the badge counts only events plus unresolved states, and why
   "mark all seen" clears the first kind and not the second.
--------------------------------------------------------------------------- */

function attentionCount(){
  const a = D.attention;
  if (!a || !a.ok) return 0;
  return (a.declines||[]).length + (a.handoffs||[]).length
       + (a.no_reply||[]).length + (a.over_cap||[]).length + (a.short||[]).length;
}

function whenShort(ts){
  if (!ts) return '';
  const mins = Math.round((Date.now() - Date.parse(ts)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/* ---------------------------------------------------------------------------
   The unclosed-shift walkthrough, demo builds only.

   Angela wanted Needs You to SHOW the text-to-set-time story end to end: a
   person with an open punch, the exact text our system sends them, and the
   portal screen they land on -- suggestion prefilled, but theirs to change --
   where they confirm "this is when my shift ended."

   DEMO_ATTN is defined only by tools/build-demo.mjs, so the live page renders
   none of this: live unclosed shifts come from unclosed_shifts() on the End of
   night tab, and a worker's real answer arrives as a time-fix claim a manager
   approves. This block is a faithful picture of that flow, not a second
   implementation of it.
--------------------------------------------------------------------------- */
function attnDemoCard(x, i){
  const sent = edits['ui|attnsent'] || {};
  const isSent = !!sent[i];
  const step = (t, label, missing) => `<div class="uxstep${missing ? ' miss' : ''}">
    <span class="uxt">${missing ? '—' : esc(t)}</span><span class="uxl">${esc(label)}</span></div>`;
  return `<div class="panel" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      ${x.pet ? `<img src="${esc(petSrc(x.pet, x.pet_kind, 'sit'))}" style="width:44px;height:44px">` : ''}
      <div><strong style="font-size:16px">${esc(x.name)}</strong>
        <div class="rtime">${esc(x.role)} · scheduled ${esc(x.sched)}</div></div>
      <div style="flex:1"></div>
      <span class="chip planned">${esc(x.problem)}</span>
    </div>

    <div class="uxline">
      ${step(x.in, 'clocked in', false)}
      ${x.lunchOut ? step(x.lunchOut, 'left for lunch', false) : ''}
      ${x.kind === 'lunch'
        ? step('', 'back from lunch', true)
        : step(x.lunchBack, 'back from lunch', false)}
      ${x.kind === 'out' ? step('', 'clocked out', true) : step(x.end, 'shift end', false)}
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin:12px 0 5px">
      <span class="rtime">The text our system sends them:</span>
      ${isSent
        ? `<span class="chip deployed">✓ sent — queued for SMS</span>`
        : `<button class="btn primary" data-attnsend="${i}">Send text</button>`}
    </div>
    <div class="uxsms">${esc(x.sms)}</div>

    <div class="rtime" style="margin:14px 0 6px">…and what they see when they tap the link:</div>
    <div class="dphone" style="pointer-events:none;user-select:none;max-width:360px">
      <div class="dph-top">${x.pet ? `<img src="${esc(petSrc(x.pet, x.pet_kind, 'sit'))}"
        style="width:34px;height:34px">` : ''}<strong>Hi ${esc(x.name.split(' ')[0])}</strong></div>
      <div class="dph-h">Your time needs fixing</div>
      <div class="dph-card" style="border-left:4px solid var(--warn)">
        <strong>${esc(x.portalTitle)}</strong>
        <div class="rtime" style="margin-top:3px">${esc(x.portalHint)}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:9px">
          <input type="time" value="${esc(x.suggest)}" style="font-size:17px;font-weight:700">
          <button class="btn primary">${esc(x.confirm)}</button>
        </div>
        <div class="rtime" style="margin-top:7px">The time is suggested — they can set
          whatever is true. A manager approves it before it touches payroll.</div>
      </div>
    </div>
  </div>`;
}

function viewAttention(){
  const a = D.attention;
  /* Send one, or send the lot -- Angela: "a button that says Send all, or you
     can individually send." Sent state lives in ui| edits, so it survives a
     re-render and clears on refresh like everything else in the demo. */
  const sent = edits['ui|attnsent'] || {};
  const demoBlock = (typeof DEMO_ATTN !== 'undefined' && Array.isArray(DEMO_ATTN))
    ? `<div style="display:flex;align-items:center;gap:12px">
         <h2 style="margin-bottom:0">Unclosed shifts
           <span class="rtime">what the end-of-night texts look like</span></h2>
         <div style="flex:1"></div>
         ${DEMO_ATTN.every((_, i) => sent[i])
           ? `<span class="chip deployed">✓ all sent</span>`
           : `<button class="btn primary" id="attnsendall">Send all</button>`}
       </div>
       ${DEMO_ATTN.map((x, i) => attnDemoCard(x, i)).join('')}`
    : '';
  if (!a || !a.ok) return demoBlock || `<div class="panel">Nothing to show yet.</div>`;

  const dec = a.declines || [], han = a.handoffs || [];
  const nor = a.no_reply || [], cap = a.over_cap || [], sht = a.short || [];
  if (!attentionCount()) return demoBlock + `<h2>Nothing needs you</h2>
    <div class="panel"><div class="note ok">No declines, no swaps to review, everybody
    has replied, and every published session is fully crewed.</div></div>`;

  const block = (title, rows, extra='') => rows.length
    ? `<h2>${title} <span class="rtime">${rows.length}</span></h2>
       <div class="panel">${rows}${extra}</div>` : '';

  /* Declines first. A refused shift is an empty slot on a published night and
     is the only item here with a deadline attached to it. */
  const declines = block('Declined shifts', dec.map(d => `
    <div class="arow">
      <div>${personLabel(d.staff_id || '', d.name)}
        <span class="rtime">${esc(whenShort(d.at))}</span></div>
      <div class="rtime">${esc(shortDate(d.date))} ·
        <span class="hallbadge ${esc(d.hall)}">${esc((d.hall||'').toUpperCase())}</span>
        ${esc(d.role || '')}${d.reason ? ` · “${esc(d.reason)}”` : ''}</div>
      <button class="btn" data-goto="${esc(d.date)}">Go to that night</button>
    </div>`).join(''));

  const handoffs = block('Shifts that changed hands', han.map(h => `
    <div class="arow">
      <div><strong>${esc(h.from)}</strong> → <strong>${esc(h.to)}</strong>
        <span class="rtime">${esc(whenShort(h.at))}</span></div>
      <div class="rtime">${esc(shortDate(h.date))} ·
        <span class="hallbadge ${esc(h.hall)}">${esc((h.hall||'').toUpperCase())}</span></div>
      <button class="btn" data-goto="${esc(h.date)}">Go to that night</button>
    </div>`).join(''));

  const short = block('Published nights that are short', sht.map(s => `
    <div class="arow">
      <div><strong>${esc(shortDate(s.date))}</strong>
        <span class="hallbadge ${esc(s.hall)}">${esc((s.hall||'').toUpperCase())}</span>
        <span class="rtime">${esc(s.part)}</span></div>
      <div class="short">${s.short_by} still to fill</div>
      <button class="btn" data-goto="${esc(s.date)}">Go to that night</button>
    </div>`).join(''));

  const over = block('Asking for extra days off', cap.map(c => `
    <div class="arow">
      <div>${personLabel(c.staff_id, c.name)}
        <span class="rtime">${c.days_off} days off</span></div>
      <div class="rtime">${c.note ? esc(c.note) : 'No reason given'}</div>
      <button class="btn" data-goto-avail="1">Review</button>
    </div>`).join(''));

  /* Unreachable people are called out separately: chasing somebody you have no
     way of contacting is not a reminder, it is a different job. */
  const unreachable = nor.filter(p => !p.reachable);
  const noreply = block('Have not replied about availability',
    nor.map(p => `<span class="pillp">${personLabel(p.staff_id, p.name)}${
      p.reachable ? '' : ' <span class="short">no contact details</span>'}</span>`).join(''),
    unreachable.length
      ? `<div class="note warn" style="margin-top:10px">${unreachable.length} of these
         have no phone and no email, so they were never actually asked. Add their
         details on the Staff tab.</div>`
      : '');

  return demoBlock + `<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
      <h2 style="margin:0">What needs you</h2><div style="flex:1"></div>
      ${(dec.length || han.length)
        ? `<button class="btn" id="markseen">Mark declines and swaps seen</button>` : ''}
    </div>
    ${declines}${handoffs}${short}${over}${noreply}`;
}
