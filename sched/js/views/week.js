/* ---------------------------------------------------------------------------
   A schedule is a FORTNIGHT, not a rolling list of days.

   Rachel sits down and builds two weeks at a time, publishes that, and later
   looks back at it as one thing. Showing an endless stream of session cards
   described a different object from the one she is actually making — so the
   screen now shows exactly one period, always Monday to the Sunday thirteen
   days later, with the rest reachable from the picker.
--------------------------------------------------------------------------- */

function currentPeriod(){
  const ps=D.periods||[];
  if(!ps.length) return null;
  return ps.find(p=>p.id===periodId) || ps.find(p=>p.is_current) || ps[0];
}

function periodLabel(p){
  const a=shortDate(p.starts_on), b=shortDate(p.ends_on);
  return p.label ? `${esc(p.label)} · ${a} – ${b}` : `${a} – ${b}`;
}

function renderPeriodBar(){
  const ps=D.periods||[], cur=currentPeriod();
  if(!cur) return `<div class="panel">
      <div class="note">No schedule period yet. A schedule is a fortnight, always
      starting on a Monday.</div>
      <button class="btn primary" id="pnew" style="margin-top:10px">Start this fortnight</button>
    </div>`;

  const filled=cur.filled||0, slots=cur.slots||0;
  const pct=slots?Math.round(filled/slots*100):0;
  return `<div class="panel periodbar">
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
      <select id="psel" style="min-width:250px;font-weight:600">
        ${ps.map(p=>`<option value="${p.id}" ${p.id===cur.id?'selected':''}>${
          periodLabel(p)}${p.is_current?' — current':''}${
          p.status==='published'?' ✓':''}</option>`).join('')}
      </select>
      <span class="chip ${cur.status}">${esc(cur.status)}</span>
      <div class="rtime">${filled} of ${slots} places filled${slots?` · ${pct}%`:''}</div>
      <div style="flex:1"></div>
      <button class="btn" id="pprev" title="The fortnight before this one">‹ earlier</button>
      <button class="btn" id="pnext" title="The fortnight after this one">later ›</button>
      ${cur.status==='published'
        ? `<button class="btn" id="punpub">Unpublish</button>`
        : `<button class="btn primary" id="ppub">Publish this fortnight</button>`}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
      <button class="btn" id="pcopy" title="Same people, same roles, where they still can">Copy last fortnight</button>
      <button class="btn" id="pfill" title="Suggest people who said they can work">Fill from availability</button>
      <button class="btn" id="pclear" title="Empty every slot, keeping the shape">Clear people</button>
      <div style="flex:1"></div>
      <label class="pullbox" title="Skip anyone who has already confirmed every shift">
        <input type="checkbox" id="pblastu" ${edits['ui|blastu']?'checked':''}> only unconfirmed</label>
      ${edits['ui|blastarm']
        ? `<button class="btn primary" id="pblast">Press again to text ${blastCount()} people</button>
           <button class="btn" id="pblastx">Cancel</button>`
        : `<button class="btn" id="pblast" title="Everyone on this fortnight gets their portal link by text">📱 Text everybody the schedule</button>`}
      <span class="rtime" id="pblastmsg">${esc(edits['ui|blastmsg']||'')}</span>
    </div>
    ${cur.status==='published'
      ? `<div class="note ok" style="margin-top:10px">Published${
          cur.published_at?` ${esc(shortDate(cur.published_at.slice(0,10)))}`:''}.
         Staff can see it. Changes still save, but tell people.</div>`
      : ''}
  </div>`;
}

/* Week cards + the day roster beneath them. */
/* Who the blast would reach: one text per person with any shift in the
   fortnight -- minus the confirmed when the checkbox says so, and minus
   anybody with no phone number, who is reported by name instead of skipped
   silently. */
function blastCount(){
  const cur = currentPeriod(); if(!cur) return 0;
  const inP = d => d >= cur.starts_on && d <= cur.ends_on;
  const per = new Map();
  for (const a of D.assigns){
    if (!a.staff_id) continue;
    const s = D.sessions.find(x => x.id === a.session_id);
    if (!s || !inP(s.session_date)) continue;
    const e = per.get(a.staff_id) || { shifts: 0, yes: 0 };
    e.shifts++; if (a.response === 'yes') e.yes++;
    per.set(a.staff_id, e);
  }
  const only = edits['ui|blastu'] === true;
  let n = 0;
  for (const [id, e] of per){
    if (only && e.yes >= e.shifts) continue;
    if (!D.staff.find(p => p.id === id)?.phone) continue;
    n++;
  }
  return n;
}

function viewWeek(){
  const bar=renderPeriodBar(), cur=currentPeriod();
  if(!cur) return bar;

  const inPeriod=s=>s.session_date>=cur.starts_on && s.session_date<=cur.ends_on;
  const list=D.sessions.map((s,i)=>[s,i]).filter(([s])=>inPeriod(s));
  if(!list.length) return bar+`<div class="panel">No sessions fall in this fortnight yet.</div>`;

  /* Keep the selected card inside the period being viewed, otherwise the
     roster underneath belongs to a different fortnight than the cards above. */
  if(!D.sessions[sel] || !inPeriod(D.sessions[sel])) sel=list[0][1];

  /* What could NOT be placed. A silent partial fill reads as a complete one,
     and the whole risk of these shortcuts is somebody trusting them. */
  const report=(D.fillReport&&D.fillReport.length)
    ? `<div class="note warn"><strong>${D.fillReport.length} could not be placed.</strong>
       <div style="margin-top:5px">${D.fillReport.slice(0,12).map(x=>
         `${esc(shortDate(x.session.session_date))}${x.name?` · ${esc(x.name)}`:''} — ${esc(x.why)}`
        ).join('<br>')}${D.fillReport.length>12?`<br>…and ${D.fillReport.length-12} more`:''}</div>
       <div style="margin-top:6px"><button class="btn" id="fillclear">Dismiss</button></div></div>`
    : '';

  return bar+report+`<h2>${esc(shortDate(cur.starts_on))} – ${esc(shortDate(cur.ends_on))}
    <span class="rtime">${list.length} sessions</span></h2><div class="cards">`+list.map(([s,i])=>{
    const a=forSession(s), dec=a.filter(x=>x.response==='declined'&&!x.handed_from);
    return `<button class="card ${s.status} ${i===sel?'sel':''}" data-i="${i}">
      <div class="day"><span class="hallbadge ${s.hall_id}">${s.hall_id.toUpperCase()}</span>${esc(label(s))}</div>
      <div class="meta">${a.length} on shift</div>
      <span class="chip ${s.status}">${s.status}</span>
      ${dec.length?`<span class="flag">${dec.length} unfilled</span>`:''}
    </button>`;}).join('')+`</div>`+viewDay();
}

function viewDay(){
  const s=D.sessions[sel]; if(!s) return `<div class="panel">Nothing to show.</div>`;
  const dw=dowOf(s), a=forSession(s);

  // Who is already working this session, in any role — used to stop one person
  // being put in two chairs at the same time.
  /* Who is already in a chair this session, and WHICH chair. Keying by role
     alone let one person fill two Flash Runner slots, because both slots
     matched their own role and the check passed. */
  const busy=new Map();
  for(const x of a){ if(x.staff_id) busy.set(x.staff_id, `${x.role_id}|${x.slot_index}`); }

  /* Earliest start first — the order people actually arrive in. Roles with no
     recorded start time fall to the bottom in catalogue order rather than
     pretending to be at midnight. */
  const ordered=[...D.roles].sort((a,b)=>{
    const ta=timeFor(a.id,dw,s.part,s.hall_id), tb=timeFor(b.id,dw,s.part,s.hall_id);
    if(ta&&tb) return ta.localeCompare(tb) || a.sort-b.sort;
    if(ta) return -1;
    if(tb) return 1;
    return a.sort-b.sort;
  });

  const rows=ordered.map(r=>{
    const template=needFor(r.id,dw,s.part,s.hall_id) ?? 0;
    /* A per-session override lives in sched_session_roles and changes THIS
       session only — the hall template is untouched. */
    const override=D.sessionRoles.find(x=>x.session_id===s.id&&x.role_id===r.id)?.needed;
    const need=override ?? template;
    const mine=a.filter(x=>x.role_id===r.id).sort((p,q)=>p.slot_index-q.slot_index);
    const slots=Math.max(need, mine.length);
    /* Every role renders, even at zero, because the whole point of the + button
       is to staff a role the template did not ask for. A row that vanishes when
       the count is zero is a role nobody can ever add. */
    const t=timeFor(r.id,dw,s.part,s.hall_id);
    const guessed=isPlaceholderTime(r.id,dw,s.part,s.hall_id);

    /* Capability is advisory: it decides whether a caution shows, never
       whether someone can be slotted. canDo() treats Flash Runners as
       universal and every other role as one that must be added to a person. */
    const okFor=id=>canDo(id,r.id);

    const cells=[];
    for(let i=0;i<slots;i++){
      const cur=mine.find(x=>x.slot_index===i);
      const id=cur?.staff_id||'';
      const warn=id&&!okFor(id);
      /* People whose job this is come first. Everyone else is still listed
         underneath, because a short-staffed night must never be unstaffable —
         they are simply grouped so the normal choice is the obvious one. */
      /* People whose job this is come first. Everyone else is still listed
         underneath — a short-staffed night must never be unstaffable — they are
         just grouped so the normal choice is the obvious one. */
      /* Only qualified people are offered. Anyone already slotted stays in
         their own dropdown regardless, so an existing assignment can never
         silently vanish because a qualification was removed later. */
      const pool=D.staff.filter(p=>(p.active&&canDo(p.id,r.id))||p.id===id);
      const thisSlot=`${r.id}|${i}`;
      const opt=p=>{
        /* Disabled if they hold ANY slot other than this exact one. */
        const elsewhere=busy.has(p.id)&&busy.get(p.id)!==thisSlot;
        const off=!isAvailable(p.id,dw,s.part)&&p.id!==id;
        return `<option value="${p.id}" ${p.id===id?'selected':''} ${elsewhere||off?'disabled':''}>${
          esc(p.name)}${elsewhere?' — already on this session':''}${off?" — doesn't work this day":''}${
          !okFor(p.id)?' (no longer qualified)':''}</option>`;
      };
      const opts='<option value="">— open —</option>' + pool.map(opt).join('');
      /* An <option> cannot contain an image, so the character sits beside the
         dropdown rather than inside it. Without this the schedule — the screen
         Rachel actually works in — is the one place with no characters at all. */
      /* An empty slot somebody REFUSED is not the same as one never filled.
         Without this the hole looks like an oversight rather than a decision
         that has already been made and communicated. */
      const refused = id ? null : (D.declines||[]).find(x =>
        x.session_id===s.id && x.role_id===r.id && x.slot_index===i);

      const mor = id && isMor(s.id, r.id, i);
      /* Offered on the OTHER filled slots of a manager role, so promoting
         somebody is one click rather than a re-shuffle of the dropdowns. */
      const canPromote = id && isMorRole(r.id) && !mor && !cur?.is_training;
      cells.push(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
        ${id?petChip(id):'<span class="pet-slot"></span>'}
        <select data-a="${s.id}|${r.id}|${i}" style="min-width:210px${warn?';border-color:var(--warn);background:var(--warn-bg)':''}">${opts}</select>
        ${mor?'<span class="mor" title="Judged against this session in reports">Manager of Record</span>':''}
        ${canPromote?`<button class="btn tiny" data-mor="${s.id}|${r.id}|${id}"
          title="Make them the manager of record for this session">make MoR</button>`:''}
        ${cur?.early_start?'<span class="rtime">★ early</span>':''}
        ${cur?.is_training?'<span class="rtime">training</span>':''}
        ${warn?'<span class="rtime" style="color:var(--warn)">no longer qualified for this role</span>':''}
        ${refused?`<span class="declined" title="They said they cannot work it">${
          esc(refused.sched_staff?.first_name || refused.sched_staff?.name || 'Someone')
          } declined ${esc(shortDate(String(refused.declined_at).slice(0,10)))}</span>`:''}
      </div>`);
    }
    const filled=mine.filter(x=>x.staff_id).length;
    /* A manager role staffed only by a trainee has no manager of record. Saying
       so beats a blank, which reads as "nothing to see here". */
    const morGap = isMorRole(r.id) && mine.some(x=>x.staff_id) && morSlot(s.id, r.id) === null;
    return `<div class="rolerow">
      <div><div class="rolename">${esc(r.name)}</div>
        <div class="rtime">${filled} of ${need||slots}${t?` · from ${t}${guessed?' <span class="guess" title="Placeholder time — nobody has confirmed when this role actually starts">?</span>':''}`:''}</div>
        ${need&&filled<need?`<div class="short">${need-filled} short</div>`:''}
        ${morGap?'<div class="short">no manager of record — trainee only</div>':''}</div>
      <div>${cells.join('')}
        <div style="margin-top:2px">
          <button class="btn" data-slot="${s.id}|${r.id}|+" title="Add one more ${esc(r.name)} for this session only">+ add ${esc(addLabel(r.name))}</button>
          ${slots>0?`<button class="btn" data-slot="${s.id}|${r.id}|-" title="Remove the last empty slot">−</button>`:''}
          ${override!=null?`<span class="rtime">this session only · template is ${template}</span>`:''}
        </div>
      </div></div>`;
  }).join('');

  return `<h2><span class="hallbadge ${s.hall_id}">${s.hall_id.toUpperCase()}</span>${esc(label(s))} · ${s.status}</h2><div class="panel">${rows||'<span class="rtime">No roles configured for this day — see Sessions &amp; crew.</span>'}</div>`
    + viewRotation(s);
}

/* ---------------------------------------------------------------------------
   Caller rotation, editable.

   It used to render whatever sched_caller_positions happened to hold, with no
   way to change it -- which meant the pattern in caller-rotation.js could not
   be applied to a new night, and a swap on the floor could not be recorded.

   The rows are the callers actually rostered on this session, so the rotation
   follows the schedule instead of drifting from it. "Build rotation" fills the
   grid from planRotation(); every cell is still a dropdown afterwards, because
   the generated pattern is a starting point and Rachel overrides it.
--------------------------------------------------------------------------- */
const ROT_CHOICES = [CALLING, VERIFYING, SUPPORT, TRAINING];

function rotKey(sessionId, staffId, section){ return `cp|${sessionId}|${staffId}|${section}`; }

/* What a cell shows: a pending edit first, then what is saved. */
function rotValue(sessionId, staffId, section){
  const k = rotKey(sessionId, staffId, section);
  if (k in edits) return edits[k];
  return (D.cpos||[]).find(x =>
    x.session_id===sessionId && x.staff_id===staffId && x.section===section)?.position ?? '';
}

/* The callers on this session, in slot order, with the trainees marked. */
function rotCallers(s){
  const role = D.roles.find(r => r.name === 'Callers/Strip');
  if (!role) return [];
  return forSession(s)
    .filter(a => a.role_id === role.id && a.staff_id)
    .sort((a,b) => a.slot_index - b.slot_index)
    .map(a => ({ id: a.staff_id,
                 name: D.staff.find(p => p.id === a.staff_id)?.name ?? '',
                 training: !!a.is_training }));
}

function viewRotation(s){
  const callers = rotCallers(s);
  if(!callers.length) return '';

  const plan = callers.map(c => ({
    name: c.name,
    sections: [1,2,3].map(n => rotValue(s.id, c.id, n)),
  }));
  const problems = plan.some(p => p.sections.some(Boolean))
    ? validateRotation(plan, SECTIONS) : [];

  /* Anything already saved that is not one of the four standard positions --
     "PM Paymaster Duties" and the like -- stays offerable, or picking it up
     would silently rewrite somebody's real arrangement. */
  const extra = [...new Set((D.cpos||[])
    .filter(x => x.session_id===s.id)
    .map(x => x.position)
    .filter(v => v && !ROT_CHOICES.includes(v)))];

  const cell = (c, n) => {
    const v = rotValue(s.id, c.id, n);
    const opts = ['', ...ROT_CHOICES, ...extra]
      .map(o => `<option value="${esc(o)}" ${o===v?'selected':''}>${o?esc(o):'—'}</option>`).join('');
    /* Highlighted if they START the section calling -- a handover that begins
       on the mic is still the calling seat for that section. */
    return `<td class="${rotStart(v).toLowerCase()==='calling'?'calling':''}">
      <select data-cp="${s.id}|${c.id}|${n}">${opts}</select></td>`;
  };

  return `<h2>Caller rotation <span class="rtime">${callers.length} on the strip</span></h2>
    <div class="panel">
      <table><thead><tr><th>Caller</th><th>First</th><th>Second</th><th>Third</th></tr></thead>
      <tbody>${callers.map(c => `<tr><td><strong>${
        petChip(c.id)}${esc(c.name)}</strong>${c.training?' <span class="rtime">training</span>':''}</td>${
        [1,2,3].map(n => cell(c,n)).join('')}</tr>`).join('')}</tbody></table>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn" id="rotbuild" data-sess="${s.id}"
          title="Fill from the usual pattern — you can still change any cell">Build rotation</button>
        <button class="btn" id="rotclear" data-sess="${s.id}"
          title="Empty every cell for this session">Clear</button>
        ${problems.length
          ? `<span class="short">${problems.map(esc).join(' · ')}</span>`
          : `<span class="rtime">Changes save with the rest of the page.</span>`}
      </div>
    </div>`;
}
