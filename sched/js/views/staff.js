/* Staff list and the per-person hours/overtime detail. */
function viewStaff(){
  const showInactive = edits['ui|showInactive'] === true;
  const all = [...D.staff].sort((a,b)=>a.name.localeCompare(b.name));
  /* Inactive people go to the TOP while the filter is on. The only reason to
     turn it on is to find one of them -- to reactivate somebody, or to check
     who was let go -- and buried alphabetically among sixty active staff they
     are harder to find with the filter on than off. */
  const rows = showInactive
    ? [...all].sort((a,b)=>(a.active?1:0)-(b.active?1:0) || a.name.localeCompare(b.name))
    : all.filter(s=>s.active);
  const offCount = all.length - all.filter(s=>s.active).length;

  const shiftCount={};
  for(const a of D.assigns){ if(a.staff_id) shiftCount[a.staff_id]=(shiftCount[a.staff_id]||0)+1; }
  const noContact=rows.filter(r=>!r.phone&&!r.email).length;

  return `<h2>${rows.length} staff${showInactive&&offCount?` (including ${offCount} inactive)`:''}</h2>

  <div class="panel" style="margin-bottom:12px">
    <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
      <div><label class="rtime">Name</label><br><input id="newname" placeholder="Full name" style="width:180px"></div>
      <div><label class="rtime">Phone</label><br><input id="newphone" placeholder="optional" style="width:140px"></div>
      <div><label class="rtime">Email</label><br><input id="newemail" placeholder="optional" style="width:190px"></div>

      <button class="btn primary" id="addstaff">Add staff</button>
      <span class="grow"></span>
      <label style="display:flex;gap:6px;align-items:center;color:var(--muted);font-size:13px">
        <input type="checkbox" id="showinactive" ${showInactive?'checked':''} style="width:auto"> show inactive
      </label>
    </div>
  </div>

  ${noContact?`<div class="note warn">${noContact} of these have neither phone nor email — nothing can be
    sent to them until that is filled in.</div>`:''}
  <div class="note warn">Hourly rates are not held here; they live in payroll. This app reports hours by
    category and commission by workweek.</div>

  <div class="panel" style="overflow-x:auto"><table>
    <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Also qualified for <span class="rtime">(everyone runs flash)</span></th><th>Shifts</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="${r.active?'':'inactive-row'}">
      <td><a href="#" data-person="${r.id}">${personLabel(r.id, r.name)}</a>${
        /* Surname under the display name. The schedule shows first names only,
           which is how Rachel has always written it, but the staff list is
           where you go to work out WHICH Michael, so the full name belongs
           here and nowhere else. */
        r.last_name?`<div class="rtime" style="margin-left:24px">${esc(r.first_name||'')} ${esc(r.last_name)}</div>`:''
      }${r.active?'':' <span class="rtime">(inactive)</span>'}${
        r.on_roster===false?' <span class="rtime" title="Not on the current employee list">off list</span>':''}</td>
      ${contactCell(r,'phone')}
      ${contactCell(r,'email')}
      <td>${D.roles.filter(x=>x.name!==UNIVERSAL_ROLE).map(x=>{
        const on=canDo(r.id,x.id);
        return `<label class="rolechk ${on?'on':''}" title="${esc(x.name)}">
          <input type="checkbox" data-cap="${r.id}|${x.id}" ${on?'checked':''}> ${esc(x.name)}</label>`;
      }).join('')}</td>
      <td>${shiftCount[r.id]||0}</td>
      <td style="text-align:right"><button class="btn" data-toggle="${r.id}">${r.active?'Deactivate':'Reactivate'}</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function viewPerson(){
  const p=D.staff.find(x=>x.id===person); if(!p) return '<div class="panel">Not found.</div>';
  const off=Number(edits['ui|period'] ?? 0), P=periodOffsetDates(off);
  const inP=d=>d>=P.start&&d<=P.end;
  const hr=n=>n?n.toFixed(2)+'h':'—';
  const money=n=>n?'$'+n.toFixed(2):'—';

  /* One row per session. The summary is derived from these rows rather than
     computed separately, so the total can never disagree with the detail. */
  const rows=[];

  for(const t of D.time.filter(t=>t.staff_id===p.id&&inP(t.work_date))){
    const h=Number(t.hours_worked||0);
    const chk=checkDay({hours:h, mealTaken:t.meal_taken, mealWaived:t.meal_waived,
      secondMealTaken:t.second_meal_taken, secondMealWaived:t.second_meal_waived,
      restsTaken:t.rest_breaks_taken});
    rows.push({date:t.work_date, clocked:h, sched:null, chk, ot:dailyOvertime(h),
               cat:t.category, worked:t.is_worked_time});
  }

  for(const a of D.assigns.filter(a=>a.staff_id===p.id)){
    const s=D.sessions.find(x=>x.id===a.session_id);
    if(!s||!inP(s.session_date)) continue;
    const st=a.scheduled_start||timeForRaw(a.role_id,dowOf(s),s.part,s.hall_id);
    const en=a.scheduled_end;
    const sh=(st&&en)?shiftHours(st.slice(0,5),en.slice(0,5)):null;
    const existing=rows.find(r=>r.date===s.session_date&&r.sched==null);
    const label=`${s.hall_id.toUpperCase()} ${s.part}`;
    if(existing){ existing.sched=sh; existing.session=label; }
    else rows.push({date:s.session_date, clocked:null, sched:sh, session:label,
                    chk:sh?checkDay({hours:sh,restsTaken:0}):null,
                    ot:sh?dailyOvertime(sh):null, planned:true});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date));

  const sum=rows.reduce((t,r)=>({
    clocked:t.clocked+(r.clocked||0), sched:t.sched+(r.sched||0),
    ot15:t.ot15+(r.clocked?r.ot.ot1_5:0), ot20:t.ot20+(r.clocked?r.ot.ot2_0:0),
    prem:t.prem+(r.clocked&&r.chk?r.chk.premiumHours:0),
    restsReq:t.restsReq+(r.chk?r.chk.restsRequired:0),
    mealsReq:t.mealsReq+(r.chk?r.chk.mealsRequired:0),
    bad:t.bad+((r.clocked&&r.chk&&!r.chk.ok)?1:0),
  }),{clocked:0,sched:0,ot15:0,ot20:0,prem:0,restsReq:0,mealsReq:0,bad:0});

  const comm=D.payouts.filter(x=>x.staff_id===p.id&&inP(x.session_date))
    .reduce((n,x)=>n+Number(x.payout_amount),0);
  const basis=sum.clocked||sum.sched;
  const rateAdj=basis?comm/basis:0;
  const otAdj=rateAdj*0.5*sum.ot15+rateAdj*1.0*sum.ot20;

  const body=rows.map(r=>{
    const c=r.chk;
    const breaks=!c?'<span class="rtime">—</span>'
      : r.planned?`<span class="rtime">needs ${c.mealsRequired}×30m, ${c.restsRequired}×10m</span>`
      : c.ok?`<span style="color:var(--deployed)">✓ ${c.mealsRequired}×30m, ${c.restsRequired}×10m</span>`
      : `<span style="color:var(--alert)">✗ ${esc(c.problems.join('; '))}</span>`;
    const ot=!r.ot||!r.clocked?'—'
      : (r.ot.ot1_5||r.ot.ot2_0)
        ? `${r.ot.ot1_5?`<strong>${r.ot.ot1_5}h @1.5×</strong>`:''}${r.ot.ot2_0?` <strong style="color:var(--alert)">${r.ot.ot2_0}h @2×</strong>`:''}`
        : '<span class="rtime">none</span>';
    return `<tr class="${r.clocked&&c&&!c.ok?'rowbad':''}">
      <td>${r.date}${r.session?` <span class="rtime">${esc(r.session)}</span>`:''}
        ${r.cat&&r.cat!=='worked'?` <span class="rtime">(${esc(r.cat)})</span>`:''}</td>
      <td>${r.clocked!=null?hr(r.clocked):'<span class="rtime">not clocked</span>'}</td>
      <td>${r.sched!=null?hr(r.sched):'<span class="rtime">—</span>'}</td>
      <td>${breaks}</td>
      <td>${ot}</td>
      <td>${c&&r.clocked&&c.premiumHours?`<strong style="color:var(--alert)">${c.premiumHours}h</strong>`:'—'}</td>
    </tr>`;}).join('');

  /* Their usual hall, so Add hours defaults sensibly: the hall of their most
     recent assignment, or Santa Clara when they have none yet. */
  const lastHall = D.assigns.filter(a=>a.staff_id===p.id)
    .map(a=>D.sessions.find(x=>x.id===a.session_id))
    .filter(Boolean).sort((a,b)=>b.session_date.localeCompare(a.session_date))[0]?.hall_id || 'sc';
  const showPrev = edits['ui|pvw'] === p.id;

  return `<h2><a href="#" data-person="">← all staff</a></h2>
    <h2>${personLabel(p.id,p.name)}</h2>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn" data-period="${off-1}">← previous</button>
      <button class="btn" data-period="0" ${off===0?'disabled':''}>this period</button>
      <button class="btn" data-period="${off+1}">next →</button>
      <span class="rtime">${esc(P.label)} · ${esc(p.phone||'no phone')} · ${esc(p.email||'no email')}</span>
      <div style="flex:1"></div>
      <button class="btn ${edits['ui|petpick']?'primary':''}" id="mpetbtn">${
        edits['ui|petpick'] ? 'Close characters' : (p.pet ? 'Change character' : 'Choose character')}</button>
      <button class="btn ${showPrev?'primary':''}" id="pvwbtn">${
        showPrev?'Close preview':'Preview their portal'}</button>
    </div>
    ${edits['ui|petpick'] ? managerPetPicker(p) : ''}
    ${showPrev?personPortalPreview(p):''}

    <div class="panel" style="margin-bottom:12px">
      <strong style="margin-right:8px">Add hours</strong>
      <span class="rtime">a manual entry — payroll sees it immediately</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <input type="date" id="ah-date" value="${new Date().toISOString().slice(0,10)}">
        <select id="ah-hall">${['sc','rwc'].map(h=>`<option value="${h}" ${
          h===lastHall?'selected':''}>${esc(HALLNAME[h])}</option>`).join('')}</select>
        <input type="number" id="ah-hours" min="0.25" max="16" step="0.25" placeholder="hours"
               style="width:90px">
        <select id="ah-cat">${['worked','vacation','holiday','sick','pto'].map(c=>
          `<option value="${c}">${c}</option>`).join('')}</select>
        <input type="text" id="ah-note" placeholder="note (optional)" style="min-width:160px">
        <button class="btn primary" id="ah-add">Add</button>
        <span class="rtime" id="ah-msg">${esc(edits['ui|ahmsg']||'')}</span>
      </div>
    </div>

    <div class="panel" style="margin-bottom:12px">
      <table><tbody>
        <tr><td>Clocked</td><td><strong>${hr(sum.clocked)}</strong></td>
            <td>Scheduled</td><td><strong>${hr(sum.sched)}</strong></td>
            <td>Sessions</td><td><strong>${rows.length}</strong></td></tr>
        <tr><td>Overtime 1.5×</td><td><strong>${hr(sum.ot15)}</strong></td>
            <td>Double time</td><td><strong>${hr(sum.ot20)}</strong></td>
            <td>Break premiums</td><td><strong>${sum.prem?sum.prem+'h owed':'none'}</strong></td></tr>
        <tr><td>30-min meals required</td><td><strong>${sum.mealsReq}</strong></td>
            <td>10-min rests required</td><td><strong>${sum.restsReq}</strong></td>
            <td>Days out of compliance</td><td><strong style="${sum.bad?'color:var(--alert)':''}">${sum.bad}</strong></td></tr>
        <tr><td>Commission</td><td><strong>${money(comm)}</strong></td>
            <td>Rate adj</td><td><strong>${rateAdj?'+'+money(rateAdj)+'/h':'—'}</strong></td>
            <td>Est. OT adj</td><td><strong>${money(otAdj)}</strong></td></tr>
      </tbody></table>
    </div>

    <h2>Every session in this period</h2>
    <div class="panel" style="overflow-x:auto"><table>
      <thead><tr><th>Date</th><th>Clocked</th><th>Scheduled</th>
        <th>Breaks (30m meals / 10m rests)</th><th>Overtime that day</th><th>Premium</th></tr></thead>
      <tbody>${body||'<tr><td colspan="6" class="rtime">Nothing in this period.</td></tr>'}</tbody></table></div>

    <div class="note warn" style="margin-top:12px">Daily overtime is shown per session: over 8 hours at
    1.5×, over 12 at 2×. It does not include weekly overtime, which belongs to the workweek rather than to
    any one day — the Staff hours tab classifies that. Rows for future sessions show what the breaks
    <em>will</em> require, not a violation.</div>`;
}


/* Phone and email are editable in place. 42 of 67 staff have neither, and
   every one of them is a person who cannot be sent a shift or an availability
   request — so adding one has to be a click where the gap is, not a trip into
   a separate form. */
function contactCell(r, field){
  const k=`c|${r.id}|${field}`;
  const editing = k in edits;
  if(editing){
    return `<td><input type="${field==='email'?'email':'tel'}" data-contact="${r.id}|${field}"
      value="${esc(edits[k])}" style="width:100%;min-width:150px"
      placeholder="${field==='email'?'name@example.com':'408-555-0123'}">
      <div class="rtime">Enter to save · Esc to cancel</div></td>`;
  }
  const v=r[field];
  return `<td><a href="#" class="editable" data-editc="${r.id}|${field}"
    title="Click to ${v?'change':'add'}">${
      v ? esc(v) : (field==='phone'
        ? '<span class="short">missing</span>'
        : '<span class="rtime">— add</span>')}</a></td>`;
}


/* What THIS person sees when they open their link -- rendered from the same
   data the manager is already looking at, read-only. The buttons are drawn
   because the point is to show what the worker gets, but they are dead: a
   preview that can confirm a shift AS the worker is a recorded answer they
   never gave. The live page (me.html) goes through worker_home() with their
   token; this is a picture of it, not a session as them. */
function personPortalPreview(p){
  /* The offline demo is a frozen fortnight, so its idea of "today" is pinned
     to the snapshot -- otherwise every shift is in the past and the preview
     shows an empty phone. Live pages have no DEMO_TODAY and use the clock. */
  const today = (typeof DEMO_TODAY === 'string') ? DEMO_TODAY
    : new Date().toISOString().slice(0,10);
  const mine = D.assigns.filter(a=>a.staff_id===p.id)
    .map(a=>({a, s:D.sessions.find(x=>x.id===a.session_id)}))
    .filter(x=>x.s && x.s.session_date>=today)
    .sort((x,y)=>x.s.session_date.localeCompare(y.s.session_date)).slice(0,6);
  const answered = {yes:'✓ confirmed', declined:'✗ declined'};
  return `<div class="panel" style="margin-bottom:12px">
    <div class="rtime" style="margin-bottom:8px">What ${esc(p.name)} sees on their
      phone when they tap their link. Preview only — nothing here can be pressed
      as them.</div>
    <div class="dphone" style="pointer-events:none;user-select:none">
      <div class="dph-top">${petChip(p.id)}<strong>Hi ${esc((p.first_name||p.name).split(' ')[0])}</strong></div>
      <div class="dph-h">My shifts</div>
      ${mine.length?mine.map(({a,s})=>`<div class="dph-card">
        <strong>${esc(label(s))}</strong>
        <div class="rtime">${esc(HALLNAME[s.hall_id])} · ${
          esc(D.roles.find(r=>r.id===a.role_id)?.name||'')}${
          a.scheduled_start?` · from ${a.scheduled_start.slice(0,5)}`:''}${
          a.early_start?' · early for buy-ins':''}</div>
        ${answered[a.response]
          ? `<div class="rtime" style="margin-top:6px">${answered[a.response]}</div>`
          : `<div style="margin-top:6px;opacity:.55"><button class="btn primary">Got it</button>
             <button class="btn">Can't make it</button>
             <button class="btn">Hand over</button></div>`}
      </div>`).join(''):'<div class="rtime">No upcoming shifts published.</div>'}
    </div>
  </div>`;
}


/* The manager's picker, on the person's own page. Same rule as the worker's:
   one character, one person -- taken ones are shown with their owner's name
   and are not offered. Choosing writes sched_staff directly (a manager acting
   as a manager, not as the worker), and the unique index is the referee if
   two managers race for the same character. */
function managerPetPicker(p){
  const taken = new Map(D.staff.filter(x => x.pet && x.id !== p.id).map(x => [x.pet, x.name]));
  const dirKind = { pets:'cat', monsters:'boss', chars:'critter' };
  const all = (typeof ART === 'object' && ART)
    ? Object.keys(ART).filter(k => k.endsWith('-sit')).map(k => {
        const [dir, file] = k.split('/');
        return { id: file.replace(/-sit$/,''), kind: dirKind[dir] || 'cat' };
      }) : [];
  const tile = x => {
    const owner = taken.get(x.id), mine = x.id === p.pet;
    return `<button class="wpet ${mine?'mine':''}" data-mpet="${esc(x.id)}|${esc(x.kind)}"
      ${owner?'disabled style="opacity:.35"':''} title="${owner?esc(owner+' has this one'):''}">
      <img src="${esc(petSrc(x.id, x.kind, 'sit'))}" alt="">
      <span>${esc(petName(x.id))}</span>
      ${mine?'<span class="rtime">theirs now</span>':owner?`<span class="rtime">${esc(owner)}</span>`:''}
    </button>`;
  };
  return `<div class="panel" style="margin-bottom:12px">
    <div class="rtime" style="margin-bottom:8px">Pick ${esc(p.name)}'s character — it shows
      beside their name everywhere, and on the break board. Greyed-out ones belong to
      somebody else. <span id="mpetmsg">${esc(edits['ui|mpetmsg']||'')}</span></div>
    <div class="wpets" style="grid-template-columns:repeat(auto-fill,minmax(86px,1fr));max-height:340px;overflow-y:auto">
      ${all.map(tile).join('')}
    </div>
  </div>`;
}
