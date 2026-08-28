/* ---------------------------------------------------------------------------
   Wall chart — the whole fortnight on one screen, with everybody's character.

   The Schedule view is for BUILDING: one session at a time, dropdowns, edits.
   This is for LOOKING: all eighteen sessions at once, who is on each one, and
   — the reason it exists — where the holes are. Rachel reads it, prints it,
   and pins it up; nothing here changes any data.

   It renders whichever fortnight the Schedule view is on, so the period picker
   is shared and flipping between the two screens never loses your place.
--------------------------------------------------------------------------- */

/* Sessions in the current period, earliest first, AM before PM.

   Past nights are hidden by default. This screen answers "where are the holes"
   and a hole in a night that has already happened is not a hole any more --
   left in, last week's gaps sit at the top of the list looking like work. The
   toggle keeps them reachable, and a fortnight that is ENTIRELY past still
   draws in full, because hiding everything would just look broken. */
function rosterSessions(cur){
  const all = D.sessions
    .map((s,i)=>[s,i])
    .filter(([s])=>s.session_date>=cur.starts_on && s.session_date<=cur.ends_on)
    .sort((a,b)=>a[0].session_date.localeCompare(b[0].session_date)
                 || (a[0].part==='PM')-(b[0].part==='PM'));
  if(edits['ui|wallPast']===true) return { list:all, hidden:0, allPast:false };
  const upcoming = all.filter(([s])=>isUpcoming(s));
  /* Looking back at a finished fortnight: show it rather than an empty screen. */
  if(!upcoming.length) return { list:all, hidden:0, allPast:all.length>0 };
  return { list:upcoming, hidden:all.length-upcoming.length, allPast:false };
}

/* What a role needs on a session: the per-session override if there is one,
   otherwise the hall template. Same rule the Schedule view uses — if the two
   screens disagreed about the headcount, one of them would be lying. */
function rosterNeed(s, roleId){
  const override=D.sessionRoles.find(x=>x.session_id===s.id&&x.role_id===roleId)?.needed;
  return override ?? (needFor(roleId,dowOf(s),s.part,s.hall_id) ?? 0);
}

/* One session card. */
function rosterCard(s, i){
  const dw=dowOf(s), a=forSession(s);
  let need=0, filled=0;

  const blocks=[...D.roles].sort((x,y)=>x.sort-y.sort).map(r=>{
    const n=rosterNeed(s,r.id);
    const mine=a.filter(x=>x.role_id===r.id&&x.staff_id)
                .sort((p,q)=>p.slot_index-q.slot_index);
    /* A role with no template need and nobody in it is not a hole — it is a
       role this hall does not run on this day. Leave it out entirely. */
    if(!n && !mine.length) return '';
    need+=Math.max(n,mine.length); filled+=mine.length;
    const short=Math.max(0, n-mine.length);
    const t=timeFor(r.id,dw,s.part,s.hall_id);
    const guessed=isPlaceholderTime(r.id,dw,s.part,s.hall_id);

    const chips=mine.map(x=>{
      const p=D.staff.find(y=>y.id===x.staff_id);
      /* The one name in a manager role the session is judged against. */
      const mor=isMor(s.id, r.id, x.slot_index);
      return `<li${mor?' class="ismor"':''}>${petChip(x.staff_id)}<span>${esc(p?.name??'')}</span>${
        mor?'<em class="tag mor" title="Manager of record">MoR</em>':''}${
        x.is_training?'<em class="tag">training</em>':''}${
        x.early_start?'<em class="tag">early</em>':''}${
        x.response==='declined'?'<em class="tag bad">declined</em>':''}</li>`;
    }).join('');

    return `<div class="rblock${short?' gap':''}">
      <div class="rhead"><b>${esc(r.name)}</b><span class="rtime">${
        t?`${esc(t)}${guessed?' <span class="guess" title="Placeholder time — nobody has confirmed when this role actually starts">?</span>':''}`:''
      }</span></div>
      <ul class="rpeople">${chips}${
        short?`<li class="open">${short} unfilled</li>`:''}</ul></div>`;
  }).join('');

  const pct=need?Math.round(filled/need*100):0;
  return `<section class="wcard ${s.status}">
    <button class="whead" data-goto="${i}" title="Open this session in Schedule">
      <span class="wday">${esc(label(s))}</span>
      <span class="hallbadge ${s.hall_id}">${s.hall_id.toUpperCase()}</span>
      <span class="wcount">${filled} of ${need}</span>
      <span class="wbar"><i style="width:${pct}%"></i></span>
    </button>
    ${blocks||'<div class="rblock"><span class="rtime">No roles configured for this day.</span></div>'}
  </section>`;
}

function viewRoster(){
  const cur=typeof currentPeriod==='function' ? currentPeriod() : null;
  if(!cur) return `<div class="panel">No schedule period yet. Build one in Schedule first.</div>`;

  const { list, hidden, allPast } = rosterSessions(cur);
  if(!list.length) return `<div class="panel">No sessions fall in this fortnight yet.</div>`;

  /* Totals and the gap list. Counting here rather than trusting the period's
     stored figures keeps this screen honest about what is on it right now. */
  let need=0, filled=0; const gaps=new Map();
  for(const [s] of list){
    const a=forSession(s);
    for(const r of D.roles){
      const n=rosterNeed(s,r.id);
      const have=a.filter(x=>x.role_id===r.id&&x.staff_id).length;
      if(!n && !have) continue;
      need+=Math.max(n,have); filled+=have;
      if(n>have) gaps.set(r.name,(gaps.get(r.name)||0)+(n-have));
    }
  }
  const gapList=[...gaps].sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>`<li><b>${v}</b> ${esc(k)}</li>`).join('');

  /* Split at the second Monday. A fortnight is two weeks and Rachel thinks in
     weeks, so showing fourteen undifferentiated cards would be harder to read
     than the thing it replaces. */
  const mid=plusDays(cur.starts_on,7);
  const wk=[list.filter(([s])=>s.session_date<mid), list.filter(([s])=>s.session_date>=mid)];

  const ps=D.periods||[];
  const bar=`<div class="panel periodbar wallbar">
    <select id="psel" style="min-width:250px;font-weight:600">
      ${ps.map(p=>`<option value="${p.id}" ${p.id===cur.id?'selected':''}>${
        periodLabel(p)}${p.is_current?' — current':''}${p.status==='published'?' ✓':''}</option>`).join('')}
    </select>
    <span class="chip ${cur.status}">${esc(cur.status)}</span>
    <div class="bignum">${filled}<span class="rtime"> of ${need} places filled</span></div>
    <div style="flex:1"></div>
    <button class="btn" id="pprev" title="The fortnight before this one">‹ earlier</button>
    <button class="btn" id="pnext" title="The fortnight after this one">later ›</button>
    <label class="rolechk" title="Nights that have already happened"><input type="checkbox" id="wallpast" ${
      edits['ui|wallPast']===true?'checked':''}> show past</label>
    <button class="btn" id="wallprint" title="Print or save as PDF">Print</button>
    ${hidden?`<div class="rtime" style="flex-basis:100%">${hidden} past ${
      hidden===1?'night is':'nights are'} hidden — the totals above count what is left.</div>`:''}
    ${allPast?`<div class="rtime" style="flex-basis:100%">This fortnight is over; showing all of it.</div>`:''}
  </div>`;

  const gapPanel=gapList
    ? `<div class="panel wallgaps"><h3>Still to fill</h3><ul>${gapList}</ul></div>`
    : `<div class="panel wallgaps ok"><h3>Every place is filled.</h3></div>`;

  const weekBlock=(sessions,n,from,to)=>sessions.length
    ? `<h2>Week ${n} · ${esc(shortDate(from))} – ${esc(shortDate(to))}
        <span class="rtime">${sessions.length} sessions</span></h2>
       <div class="wall">${sessions.map(([s,i])=>rosterCard(s,i)).join('')}</div>`
    : '';

  return bar+gapPanel+
    weekBlock(wk[0],1,cur.starts_on,plusDays(cur.starts_on,6))+
    weekBlock(wk[1],2,mid,cur.ends_on);
}
