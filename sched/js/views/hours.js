/* Staff hours — everyone, scheduled against clocked, for one pay period.

   Pay periods are the 1st–15th and 16th–EOM, but OVERTIME is classified per
   workweek, never per pay period. So hours are grouped into workweeks, each
   week is classified, and the results are summed into the period. A workweek
   straddling the 15th keeps its premiums in the week they were earned. */

/* Pay periods are FOURTEEN DAYS starting on a Monday, not 1st–15th. They drift
   against the calendar, so a period regularly straddles the end of a month and
   no month contains a whole number of them. All of it derives from the single
   anchor in ca-regular-rate.js — change that one line and every period here
   moves with it. */
function periodOffsetDates(offset){
  const day = 86400000;
  const now = todayISO();
  const here = payPeriodFor(now);
  const start = Date.parse(here.start + 'T00:00:00Z') + offset * PAY_PERIOD_DAYS * day;
  const s = new Date(start).toISOString().slice(0,10);
  const e = new Date(start + (PAY_PERIOD_DAYS - 1) * day).toISOString().slice(0,10);
  const nice = iso => {
    const [y,m,d] = iso.split('-').map(Number);
    return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${d}`;
  };
  return { start: s, end: e, label: `${nice(s)} – ${nice(e)}` };
}

function viewHours(){
  const off = Number(edits['ui|period'] ?? 0);
  const P = periodOffsetDates(off);
  const inP = d => d >= P.start && d <= P.end;
  const hr = n => n ? n.toFixed(2) + 'h' : '—';
  const money = n => n ? '$' + n.toFixed(2) : '—';

  /* Scheduled hours need a start AND an end. Most roles have no end time
     recorded, so this is counted honestly: shifts we can measure, and a count
     of the ones we cannot. */
  const schedFor = id => {
    let hours = 0, shifts = 0, unknown = 0;
    for (const a of D.assigns) {
      if (a.staff_id !== id) continue;
      const s = D.sessions.find(x => x.id === a.session_id);
      if (!s || !inP(s.session_date)) continue;
      shifts++;
      const st = a.scheduled_start || timeForRaw(a.role_id, dowOf(s), s.part, s.hall_id);
      const en = a.scheduled_end;
      if (st && en) hours += shiftHours(st.slice(0,5), en.slice(0,5)); else unknown++;
    }
    return { hours, shifts, unknown };
  };

  /* Clocked hours, classified workweek by workweek. */
  const clockedFor = id => {
    const days = D.time.filter(t => t.staff_id === id && inP(t.work_date))
      .map(t => ({ date:t.work_date, hours:Number(t.hours_worked||0), worked:t.is_worked_time }));
    if (!days.length) return { regular:0, ot1_5:0, ot2_0:0, total:0, entries:0 };
    const byWeek = {};
    for (const d of days) (byWeek[workweekStart(d.date)] ||= []).push(d);
    const t = { regular:0, ot1_5:0, ot2_0:0 };
    for (const w of Object.values(byWeek)) {
      const merged = {};
      for (const d of w) {
        merged[d.date] ||= { date:d.date, hours:0, worked:true };
        merged[d.date].hours += d.hours;
        if (d.worked === false) merged[d.date].worked = false;
      }
      const c = classifyWorkweek(Object.values(merged));
      t.regular += c.totals.regular; t.ot1_5 += c.totals.ot1_5; t.ot2_0 += c.totals.ot2_0;
    }
    return { ...t, total:t.regular+t.ot1_5+t.ot2_0, entries:days.length };
  };

  const commFor = id => D.payouts
    .filter(p => p.staff_id === id && inP(p.session_date))
    .reduce((n, p) => n + Number(p.payout_amount), 0);

  const rows = [...D.staff].filter(s => s.active).sort((a,b)=>a.name.localeCompare(b.name))
    .map(s => {
      const sch = schedFor(s.id), clk = clockedFor(s.id), comm = commFor(s.id);
      /* The regular-rate adjustment from commission is commission ÷ hours —
         the base rate cancels out, so this works without any rate stored.
         The extra overtime it causes is that × 0.5 × overtime hours. */
      const basis = clk.total || sch.hours;
      const rateAdj = basis ? comm / basis : 0;
      const otAdj = rateAdj * 0.5 * clk.ot1_5 + rateAdj * 1.0 * clk.ot2_0;
      return { s, sch, clk, comm, rateAdj, otAdj, basis };
    });

  /* One definition of "has anything", used by the filter AND the export, so a
     row can never be visible on screen and missing from the file. */
  const hasActivity = r => r.sch.shifts > 0 || r.clk.total > 0 || r.sch.hours > 0 || r.comm > 0;
  const onlyActive = edits['ui|onlyWithHours'] !== false;   // default ON
  const shown = onlyActive ? rows.filter(hasActivity) : rows;
  const hiddenPeople = rows.length - shown.length;

  const anyClocked = rows.some(r => r.clk.entries);
  const unknownEnds = shown.reduce((n,r)=>n+r.sch.unknown, 0);
  const tot = shown.reduce((t,r)=>({
    sch:t.sch+r.sch.hours, reg:t.reg+r.clk.regular, ot:t.ot+r.clk.ot1_5,
    dt:t.dt+r.clk.ot2_0, comm:t.comm+r.comm, otAdj:t.otAdj+r.otAdj,
  }), {sch:0,reg:0,ot:0,dt:0,comm:0,otAdj:0});

  /* Both exports are built from the rows already on screen, so a CSV can
     never disagree with what was checked in the browser. */
  window.__hoursExport = { period:P, rows: shown };

  return `<h2>Staff hours — ${esc(P.label)}</h2>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <button class="btn" data-period="${off-1}">← previous</button>
      <button class="btn" data-period="0" ${off===0?'disabled':''}>this period</button>
      <button class="btn" data-period="${off+1}">next →</button>
      <span class="rtime">${P.start} to ${P.end}</span>
      <span class="grow" style="flex:1"></span>
      <button class="btn primary" id="xlsx">Export to Excel</button>
      <label style="display:flex;gap:6px;align-items:center;color:var(--muted);font-size:13px">
        <input type="checkbox" id="onlyhours" ${onlyActive?'checked':''} style="width:auto">
        only people with hours${hiddenPeople?` (${hiddenPeople} hidden)`:''}</label>
    </div>

    ${!anyClocked?`<div class="note warn">No clocked hours exist yet — the time clock has not been built,
      so the clocked columns are empty for everyone. Scheduled hours are real.</div>`:''}
    ${unknownEnds?`<div class="note warn">${unknownEnds} scheduled shift(s) have no end time recorded, so
      they count as shifts but contribute no hours. Most roles have a start time and no finish.</div>`:''}

    <div class="panel" style="overflow-x:auto"><table>
      <thead><tr><th>Person</th><th>Shifts</th><th>Scheduled</th>
        <th>Clocked reg</th><th>1.5×</th><th>2×</th><th>Clocked total</th>
        <th>Commission</th><th>Rate adj</th><th>Est. OT adj</th></tr></thead>
      <tbody>${shown.length?shown.map(r=>`<tr>
        <td><a href="#" data-person="${r.s.id}">${personLabel(r.s.id, r.s.name)}</a></td>
        <td>${r.sch.shifts||'—'}</td>
        <td>${hr(r.sch.hours)}${r.sch.unknown?`<div class="rtime">${r.sch.unknown} no end</div>`:''}</td>
        <td>${hr(r.clk.regular)}</td>
        <td>${r.clk.ot1_5?`<strong>${hr(r.clk.ot1_5)}</strong>`:'—'}</td>
        <td>${r.clk.ot2_0?`<strong style="color:var(--alert)">${hr(r.clk.ot2_0)}</strong>`:'—'}</td>
        <td>${hr(r.clk.total)}</td>
        <td>${money(r.comm)}</td>
        <td>${r.rateAdj?`+${money(r.rateAdj)}/h`:'—'}</td>
        <td>${r.otAdj?`<strong>${money(r.otAdj)}</strong>`:'—'}</td>
      </tr>`).join(''):`<tr><td colspan="10" class="rtime">Nobody has hours in this period.</td></tr>`}
      <tr style="background:var(--bg)"><td><strong>Total</strong></td><td></td>
        <td><strong>${hr(tot.sch)}</strong></td><td><strong>${hr(tot.reg)}</strong></td>
        <td><strong>${hr(tot.ot)}</strong></td><td><strong>${hr(tot.dt)}</strong></td>
        <td><strong>${hr(tot.reg+tot.ot+tot.dt)}</strong></td>
        <td><strong>${money(tot.comm)}</strong></td><td></td>
        <td><strong>${money(tot.otAdj)}</strong></td></tr>
      </tbody></table></div>

    <div class="note warn" style="margin-top:12px"><strong>Rate adj</strong> is commission ÷ hours — the
    amount commission raises someone's regular rate. The base wage cancels out of that division, which is
    why it works with no rate stored here. <strong>Est. OT adj</strong> is what that raise adds to their
    overtime: rate adj × 0.5 for time-and-a-half hours, × 1.0 for double time. It is the money that gets
    underpaid if overtime is calculated on base rate alone.</div>`;
}
