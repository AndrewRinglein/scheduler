/* Sessions & crew — both halls in one grid, so the whole operating week is
   visible at once. Santa Clara runs Mon/Fri/Sat/Sun, Redwood City Tue/Wed/Thu;
   seeing them side by side is the point, since no day is shared. */

function viewTemplate(){
  /* Chronological across the operating week: Mon (SC), Tue-Thu (RWC),
     Fri (SC), Sat-Sun (SC). Sorting by hall first split the week in two and
     put Tuesday before Monday. Monday-first, so dow 0 (Sunday) goes last. */
  const weekPos = d => (d.dow + 6) % 7;
  const byDay = (a,b) => weekPos(a) - weekPos(b)
    || (a.part === b.part ? 0 : a.part === 'AM' ? -1 : 1)
    || a.hall_id.localeCompare(b.hall_id);
  const cols=[...D.days].filter(d=>d.active).sort(byDay);
  if(!cols.length) return `<div class="panel">No sessions defined yet.${addDayForm()}</div>`;

  const head=cols.map(c=>`<th class="hallcol ${c.hall_id}">
      <div class="hallname">${c.hall_id.toUpperCase()}</div>
      ${DOW[c.dow].slice(0,3)}${c.part!=='single'?' '+c.part:''}
      <div style="font-weight:400"><button class="btn" style="padding:0 5px;font-size:10px"
        data-del="${c.hall_id}|${c.dow}|${c.part}">×</button></div></th>`).join('');

  const rows=D.roles.map(r=>`<tr>
    <td><strong>${esc(r.name)}</strong>
      <div class="rtime">${r.fixed_count===null?'varies by session':'usually '+r.fixed_count}</div></td>`+
    cols.map(c=>{
      const key=`${c.hall_id}|${r.id}|${c.dow}|${c.part}`;
      const cur=D.needs.find(x=>x.hall_id===c.hall_id&&x.role_id===r.id&&x.dow===c.dow&&x.part===c.part)?.needed ?? 0;
      const v=key in edits?edits[key]:cur;
      const tm=timeFor(r.id,c.dow,c.part,c.hall_id);
      const guessed=isPlaceholderTime(r.id,c.dow,c.part,c.hall_id);
      return `<td class="hallcol ${c.hall_id}"><input type="text" inputmode="numeric" value="${v}"
        data-k="${key}" style="width:58px">${tm?`<div class="rtime">${tm}${guessed?' <span class="guess" title="Placeholder start time — confirm the real one">?</span>':''}</div>`:''}</td>`;
    }).join('')+'</tr>').join('');

  const totals=cols.map(c=>{
    let n=0; for(const r of D.roles){
      const key=`${c.hall_id}|${r.id}|${c.dow}|${c.part}`;
      n+= key in edits?edits[key]:(D.needs.find(x=>x.hall_id===c.hall_id&&x.role_id===r.id&&x.dow===c.dow&&x.part===c.part)?.needed??0);}
    return `<td class="hallcol ${c.hall_id}"><strong>${n}</strong></td>`;}).join('');

  return `<h2>People needed per session — both halls</h2>
    <div class="panel" style="overflow-x:auto">
      <table><thead><tr><th>Role</th>${head}</tr></thead>
      <tbody>${rows}<tr style="background:var(--bg)"><td><strong>Total</strong></td>${totals}</tr></tbody></table>
    </div>
    <div class="panel" style="margin-top:12px">${addDayForm()}</div>`;
}

function addDayForm(){
  return `<strong style="font-size:13px">Add a session</strong>
    <div style="display:flex;gap:8px;margin-top:7px;align-items:center;flex-wrap:wrap">
      <select id="nhall"><option value="sc">Santa Clara</option><option value="rwc">Redwood City</option></select>
      <select id="ndow">${DOW.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select>
      <select id="npart"><option value="single">Single session</option><option value="AM">AM</option><option value="PM">PM</option></select>
      <button class="btn" id="addday">Add</button>
    </div>`;
}
