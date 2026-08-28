/* Availability: a standing yes/no per person per session of the week.
   Click a cell to toggle. Binary, as in the demo — a person works a slot or
   they doesn't. Absence of a row means available, so the grid shows green
   until someone is explicitly marked off. */

function availKey(staffId, dow, part){ return `${staffId}|${dow}|${part}`; }

/* THREE states, not two. Nobody has answered yet for most of these slots, and
   showing an unanswered cell as green says something the data does not support
   — it is the difference between "Rosa can work Saturdays" and "nobody has
   ever asked Rosa about Saturdays". Returns true, false, or null for unknown.
   Rachel can still set any of them herself. */
function isAvailable(staffId, dow, part){
  const k = 'av|' + availKey(staffId, dow, part);
  if (k in edits) return edits[k];
  const row = D.avail.find(a => a.staff_id === staffId && a.dow === dow && a.part === part);
  return row ? row.available : null;      // no row = we have not been told
}

/* Clicking walks unknown -> works -> does not work -> unknown, so a cell set by
   mistake can be put back to unanswered rather than left as a guess. */
function nextAvail(v){ return v === null ? true : v === true ? false : null; }

/* Has this person answered the open availability request? Distinct from what
   they answered, and the only thing that separates "free all fortnight" from
   "never opened the form". */
function hasReplied(staffId){
  const st = D.availStatus;
  if (!st || !st.ok) return null;
  const row = (st.people || []).find(p => p.staff_id === staffId);
  return row ? !!row.replied_at : null;
}

function viewAvailability(){
  /* Chronological across the operating week: Mon (SC), Tue-Thu (RWC),
     Fri (SC), Sat-Sun (SC). Sorting by hall first split the week in two and
     put Tuesday before Monday. Monday-first, so dow 0 (Sunday) goes last. */
  const weekPos = d => (d.dow + 6) % 7;
  const byDay = (a,b) => weekPos(a) - weekPos(b)
    || (a.part === b.part ? 0 : a.part === 'AM' ? -1 : 1)
    || a.hall_id.localeCompare(b.hall_id);
  const cols = D.days.filter(d => d.active).sort(byDay);
  if (!cols.length) return `<div class="panel">This hall has no sessions configured yet — see
    <strong>Sessions &amp; crew</strong>.</div>`;

  const rows = [...D.staff].filter(s => s.active).sort((a,b) => a.name.localeCompare(b.name));
  const offCount = rows.reduce((n,s) =>
    n + cols.filter(c => isAvailable(s.id, c.dow, c.part) === false).length, 0);
  const unknownCount = rows.reduce((n,s) =>
    n + cols.filter(c => isAvailable(s.id, c.dow, c.part) === null).length, 0);

  const head = cols.map(c =>
    `<th style="text-align:center"><span class="hallbadge ${c.hall_id}">${c.hall_id.toUpperCase()}</span><br>
      ${DOW[c.dow].slice(0,3)} ${c.part}</th>`).join('');

  const body = rows.map(s => {
    const replied = hasReplied(s.id);
    return `<tr>
    <td style="white-space:nowrap">${personLabel(s.id, s.name)}
      ${replied === false ? '<span class="chip noreply">no reply yet</span>' : ''}</td>
    ${cols.map(c => {
      const on = isAvailable(s.id, c.dow, c.part);
      const cls = on === true ? 'yes' : on === false ? 'no' : 'unknown';
      const txt = on === true ? 'yes' : on === false ? 'no' : '·';
      return `<td class="avcell ${cls}" data-av="${availKey(s.id,c.dow,c.part)}"
        title="${esc(s.name)} — ${DOW[c.dow]}${c.part!=='single'?' '+c.part:''} — ${
          on === null ? 'not answered' : on ? 'works this one' : 'does not work this one'
        }">${txt}</td>`;
    }).join('')}
  </tr>`;}).join('');

  return renderAvailRequest() + `<h2>Who works when</h2>
    <div class="note">Standing pattern, not one particular week. Click a cell to cycle it
    through <strong>yes</strong>, <strong>no</strong> and <strong>·</strong> (nobody has said).
    A dot is not a yes — it means we have not been told, which is why it is neither
    green nor red.</div>
    <div class="panel" style="overflow-x:auto">
      <table class="availgrid"><thead><tr><th>Person</th>${head}</tr></thead>
      <tbody>${body}</tbody></table>
    </div>
    <div class="rtime" style="margin-top:8px">${rows.length} staff ·
      ${offCount} marked unavailable · ${unknownCount} not answered</div>`;
}


/* ---------------------------------------------------------------------------
   The fortnightly request. Rachel texts everyone a few days out and asks who
   can work the next two weeks. The standing grid above is the DEFAULT; this is
   the specific ask, and the two are not rivals — the grid is what makes the ask
   cheap, because most people change nothing.

   The form everyone receives starts fully available and they turn days off, so
   a person who never opens it produces exactly the same answers as a person who
   said yes to everything. That is why "still waiting on" is the headline number
   here and not a footnote: it is the only thing that tells those two apart.
--------------------------------------------------------------------------- */

function nextMonday(){
  const d=new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0,10);
}
function plusDays(iso, n){
  const [y,m,d]=iso.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10);
}
function shortDate(iso){
  const [y,m,d]=iso.split('-').map(Number);
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${d}`;
}
function ago(ts){
  if(!ts) return '';
  const mins=Math.round((Date.now()-Date.parse(ts))/60000);
  if(mins<1) return 'just now';
  if(mins<60) return `${mins}m ago`;
  if(mins<48*60) return `${Math.round(mins/60)}h ago`;
  return `${Math.round(mins/1440)}d ago`;
}

function renderAvailRequest(){
  const st=D.availStatus;

  if(!st || !st.ok){
    const start = edits['ar|start'] ?? nextMonday();
    const end   = edits['ar|end']   ?? plusDays(start, 13);
    return `<h2>Ask everyone for their availability</h2>
      <div class="panel">
        <div class="note">Everyone gets a personal link. The form starts with every session
        ticked and they turn days off — so it takes most people about ten seconds.
        Anyone qualified beyond floor runner is told they are critical staff and
        can turn off ${esc(String(edits['ar|cap'] ?? 2))} days.</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-top:12px">
          <label>From<br><input type="date" data-ar="start" value="${esc(start)}"></label>
          <label>To<br><input type="date" data-ar="end" value="${esc(end)}"></label>
          <label>Days off for critical staff<br>
            <input type="text" inputmode="numeric" data-ar="cap" style="width:70px"
                   value="${esc(String(edits['ar|cap'] ?? 2))}"></label>
          <label style="flex:1;min-width:230px">Message (optional)<br>
            <input type="text" data-ar="note" style="width:100%"
              placeholder="Please reply by Friday" value="${esc(edits['ar|note']??'')}"></label>
          <button class="btn primary" id="arcreate">Create request</button>
        </div>
      </div>`;
  }

  const r=st.request, people=st.people||[];
  const waiting=people.filter(p=>!p.replied_at);
  const review=people.filter(p=>p.needs_review && !p.reviewed_at);
  const done=people.length-waiting.length;

  const row=p=>`<tr class="${p.needs_review&&!p.reviewed_at?'flagrow':''}">
    <td style="white-space:nowrap">${personLabel(p.staff_id,p.name)}
      ${p.critical?'<span class="chip crit">critical</span>':''}</td>
    <td>${p.replied_at
      ? `<span class="okmark">replied</span> <span class="rtime">${esc(ago(p.replied_at))}</span>`
      : '<span class="short">no reply yet</span>'}</td>
    <td>${p.days_off ? `${p.days_off} day${p.days_off===1?'':'s'} off` : '<span class="rtime">all sessions</span>'}
      ${(p.off||[]).length?`<div class="rtime">${(p.off||[]).map(o=>esc(shortDate(o.date))+' '+esc(o.part)).join(', ')}</div>`:''}</td>
    <td>${p.note?esc(p.note):''}
      ${p.needs_review&&!p.reviewed_at
        ? `<div><button class="btn" data-arok="${p.staff_id}">Accept the extra days</button></div>`
        : p.reviewed_at?'<span class="rtime">accepted</span>':''}</td>
    <td style="text-align:right;white-space:nowrap">
      ${p.token?`<button class="btn" data-arcopy="${esc(p.token)}">Copy link</button>`
               :'<span class="short">no link</span>'}</td>
  </tr>`;

  return `<h2>Availability for ${esc(shortDate(r.start))} – ${esc(shortDate(r.end))}</h2>
    <div class="panel">
      <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
        <div><div class="bignum">${done}<span class="rtime"> of ${people.length}</span></div>
          <div class="rtime">have replied</div></div>
        ${waiting.length?`<div><div class="bignum warnnum">${waiting.length}</div>
          <div class="rtime">still waiting on</div></div>`:''}
        ${review.length?`<div><div class="bignum badnum">${review.length}</div>
          <div class="rtime">want extra days off</div></div>`:''}
        <div style="flex:1"></div>
        <button class="btn" id="arrefresh">Refresh</button>
      </div>
      ${r.note?`<div class="note">${esc(r.note)}</div>`:''}
      <div class="note warn">An untouched form and a form that said yes to everything look
      identical — the only difference is whether they replied. Treat “no reply yet” as
      unknown, not as a yes.</div>
    </div>
    <div class="panel" style="overflow-x:auto">
      <table><thead><tr><th>Person</th><th>Reply</th><th>Days off</th>
        <th>Note</th><th></th></tr></thead>
      <tbody>${people.map(row).join('')}</tbody></table>
    </div>`;
}
