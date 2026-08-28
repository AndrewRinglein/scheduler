/* RPA targets, session results, share ratios and payout confirmation. */
function poolFor(s){
  if(s.actual_rpa==null||s.target_rpa==null||!s.attendance) return null;
  if(Number(s.actual_rpa)<=Number(s.target_rpa)) return 0;
  return Math.round((s.actual_rpa-s.target_rpa)*s.attendance*s.comm_rate*100)/100;
}

/* Which rows have been pulled this sitting. Deliberately not persisted: the
   tick means "I fetched this just now", not a property of the session. */
const pulled = new Set();

function viewCommission(){
  const money=n=>n==null?'—':'$'+Number(n).toFixed(2);
  if(!D.sessions.length) return '<div class="panel">No sessions for this hall.</div>';

  const hidePast = edits['ui|showPast'] !== true;
  const list=D.sessions.map((x,i)=>[x,i]).filter(([x])=>!hidePast||isUpcoming(x));
  const hiddenN=D.sessions.length-list.length;

  /* Everything is entered in the line and calculated as you type, so the
     consequence of a number is visible before it is saved rather than after. */
  const val=(s,f)=>{ const k=`res|${s.id}|${f}`; return k in edits?edits[k]:(s[f]??''); };
  const headcount=s=>D.assigns.filter(a=>a.session_id===s.id&&a.staff_id).length;

  const calc=s=>{
    const sales=Number(val(s,'total_sales')), att=Number(val(s,'attendance'));
    const tgt=Number(s.target_rpa ?? D.rpa.find(r=>r.hall_id===s.hall_id&&r.dow===dowOf(s)&&r.part===s.part)?.target_rpa ?? 0);
    if(!sales||!att||!tgt) return {rpa:null,pool:null,each:null,tgt};
    const rpa=sales/att;
    const pool=rpa>tgt ? (rpa-tgt)*att*Number(s.comm_rate) : 0;
    const n=headcount(s);
    return {rpa,pool,each:n?pool/n:null,tgt,n};
  };

  const rows=list.map(([s,i])=>{
    const c=calc(s), dirtyRow=Object.keys(edits).some(k=>k.startsWith(`res|${s.id}|`));
    const done=!!s.commission_confirmed_at;
    return `<tr class="${i===sel?'sel':''} ${dirtyRow?'rowdirty':''}" data-sess="${i}">
      <td><strong>${esc(label(s))}</strong></td>
      <td><input type="text" inputmode="decimal" value="${val(s,'target_rpa')||c.tgt||''}"
           data-res="${s.id}|target_rpa" placeholder="target" style="width:90px" ${done?'disabled':''}>
          <label class="rolechk" title="Also set the default for every future ${esc(DOW[dowOf(s)])} ${
            esc(s.part)} at ${esc(HALLNAME[s.hall_id])}, so later sessions inherit it">
            <input type="checkbox" data-rpafwd="${s.id}" ${
              edits[`fwd|${s.id}`]?'checked':''} ${done?'disabled':''}> from now on</label></td>
      <td><input type="text" inputmode="decimal" value="${val(s,'total_sales')}" data-res="${s.id}|total_sales"
           placeholder="sales" style="width:120px" ${done?'disabled':''}></td>
      <td><input type="text" inputmode="numeric" value="${val(s,'attendance')}" data-res="${s.id}|attendance"
           placeholder="att" style="width:80px" ${done?'disabled':''}></td>
      <td class="rtime">${c.rpa==null?'—':money(c.rpa)}</td>
      <td>${c.pool==null?'<span class="rtime">—</span>'
            :c.pool===0?'<span class="rtime">no</span>'
            :`<strong>${money(c.pool)}</strong>`}</td>
      <td>${c.each==null?'<span class="rtime">—</span>'
            :`<strong>${money(c.each)}</strong><div class="rtime">÷ ${c.n}</div>`}</td>
      <td>${dirtyRow?`<button class="btn primary" data-saveres="${s.id}">Save</button> `:''}
          ${done?'<span class="chip deployed">paid</span>'
            :`<button class="btn ${c.pool>0?'go':''}" data-alloc="${i}" ${c.pool>0?'':'disabled'}
               title="${c.pool>0?'Allocate the pool across the team':'No pool to allocate yet'}">Allocate</button>`}
          <label class="pullbox" title="Fill sales and attendance from the hall's reconciliation">
            <input type="checkbox" data-pull="${s.id}" ${pulled.has(s.id)?'checked':''} ${
              done?'disabled':''}> Pull</label>
          <span class="pullmsg" id="pm_${s.id}"></span></td>
    </tr>`;}).join('');

  const table=`<h2>Sessions — both halls</h2>
    <div class="panel" style="overflow-x:auto"><table class="rpaline">
    <thead><tr><th>Session</th><th>Target RPA</th><th>Total sales</th><th>Attendance</th>
      <th>RPA</th><th>Pool</th><th>Each</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
    <label style="display:flex;gap:6px;align-items:center;color:var(--muted);font-size:13px;margin-top:8px">
      <input type="checkbox" id="showpast" ${hidePast?'':'checked'} style="width:auto">
      show past sessions${hiddenN?` (${hiddenN} hidden)`:''}</label></div>`;

  /* Ratios for the selected session, once there is a pool to divide. */
  const s=D.sessions[sel];
  if(!s) return table;
  const c=calc(s);
  if(!c.pool) return table;

  const roster=D.assigns.filter(a=>a.session_id===s.id&&a.staff_id);
  const confirmed=!!s.commission_confirmed_at;
  const shareRow=id=>D.shares.find(x=>x.session_id===s.id&&x.staff_id===id);
  const totalShares=roster.reduce((n,a)=>n+Number(shareEdit(s.id,a.staff_id,shareRow(a.staff_id))),0);

  const shares=`<h2><span class="hallbadge ${s.hall_id}">${s.hall_id.toUpperCase()}</span>${esc(label(s))} — ${roster.length} on shift, ${money(c.pool)} to divide</h2>
    <div class="panel"><table><thead><tr><th>Person</th><th>Role</th><th>Shares</th><th>Payout</th></tr></thead><tbody>${
    roster.map(a=>{
      const sh=Number(shareEdit(s.id,a.staff_id,shareRow(a.staff_id)));
      return `<tr><td>${personLabel(a.staff_id, a.sched_staff?.name||'—')}</td>
        <td class="rtime">${esc(D.roles.find(r=>r.id===a.role_id)?.name||'')}</td>
        <td><input type="text" inputmode="decimal" min="0" max="3" value="${sh}" data-sh="${s.id}|${a.staff_id}"
             style="width:76px" ${confirmed?'disabled':''}></td>
        <td>${money(totalShares>0?(sh/totalShares)*c.pool:0)}</td></tr>`;}).join('')}
    <tr style="background:var(--bg)"><td colspan="2"><strong>Total</strong></td>
      <td><strong>${totalShares.toFixed(1)}</strong></td><td><strong>${money(c.pool)}</strong></td></tr>
    </tbody></table>
    <div style="margin-top:11px">${confirmed
      ? `<span class="rtime">Confirmed ${new Date(s.commission_confirmed_at).toLocaleString()}.</span>`
      : `<button class="btn primary" id="confirmcomm">Confirm payout</button>
         <span class="rtime">Freezes shares, pool and amounts.</span>`}</div></div>`;

  return table+shares;
}

/* Allocation lives in a modal so it reads as a deliberate, separate act from
   typing in session numbers. Everyone who worked starts on one share; anyone
   else can be added by giving them a share. */
function renderAllocate(){
  const s=D.sessions[allocSel]; if(!s) return '';
  const money=n=>'$'+Number(n||0).toFixed(2);
  const sales=Number(s.total_sales), att=Number(s.attendance);
  const tgt=Number(s.target_rpa ?? 0), rpa=att?sales/att:0;
  const pool=rpa>tgt?(rpa-tgt)*att*Number(s.comm_rate):0;

  const onShift=new Set(D.assigns.filter(a=>a.session_id===s.id&&a.staff_id).map(a=>a.staff_id));
  const roleOf={}; for(const a of D.assigns) if(a.session_id===s.id&&a.staff_id)
    roleOf[a.staff_id]=D.roles.find(r=>r.id===a.role_id)?.name||'';

  const people=[...D.staff].filter(p=>p.active||onShift.has(p.id))
    .sort((a,b)=> (onShift.has(b.id)-onShift.has(a.id)) || a.name.localeCompare(b.name));

  const shareOf=p=>{
    const k=`al|${s.id}|${p.id}`;
    if(k in edits) return Number(edits[k]);
    return onShift.has(p.id) ? 1 : 0;          // everyone who worked starts on one
  };
  const total=people.reduce((n,p)=>n+shareOf(p),0);

  return `<h2 style="margin-top:0">Allocate — ${esc(label(s))}</h2>
    <div class="note warn">Pool <strong>${money(pool)}</strong> · ${onShift.size} on shift ·
      total shares <strong>${total.toFixed(1)}</strong>${total?` · ${money(pool/total)} per share`:''}</div>
    <table><thead><tr><th>Person</th><th>Role</th><th>Shares</th><th>Gets</th></tr></thead><tbody>${
    people.map(p=>{
      const sh=shareOf(p);
      return `<tr class="${sh>0?'alloc-on':''}">
        <td>${personLabel(p.id,p.name)}${onShift.has(p.id)?'':' <span class="rtime">not on this session</span>'}</td>
        <td class="rtime">${esc(roleOf[p.id]||'—')}</td>
        <td><input type="text" inputmode="decimal" min="0" max="3" value="${sh}" data-al="${s.id}|${p.id}" style="width:76px"></td>
        <td>${total>0&&sh>0?money((sh/total)*pool):'<span class="rtime">—</span>'}</td></tr>`;
    }).join('')}</tbody></table>
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
      <button class="btn go" id="confirmalloc" ${total>0&&pool>0?'':'disabled'}>Confirm Allocation</button>
      <button class="btn" id="closealloc">Cancel</button>
      <span class="rtime">Confirming writes ${money(pool)} to ${people.filter(p=>shareOf(p)>0).length} people's records and locks it.</span>
    </div>`;
}

function shareEdit(sid,pid,row){
  const k=`sh|${sid}|${pid}`;
  return k in edits?edits[k]:(row?row.shares:defaultShares());
}