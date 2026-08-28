/* ---------------------------------------------------------------------------
   The outbox.

   Everything queues. Nothing sends because Rachel clicked Publish — publishing
   writes the messages and this is where they leave. That separation is the
   whole safety property: a provider outage cannot roll back a schedule, and no
   endpoint being poked can text 67 people.

   UNREACHABLE IS SHOWN, LOUDLY. 42 of 67 staff have neither a phone nor an
   email. A send that quietly reaches a third of the workforce while reporting
   success is worse than one that says so.
--------------------------------------------------------------------------- */

function msgCounts(){
  const m = D.outbox || [];
  return {
    queued: m.filter(x => x.status === 'queued').length,
    unreachable: m.filter(x => x.status === 'unreachable').length,
    sent: m.filter(x => x.status === 'sent').length,
    failed: m.filter(x => x.status === 'failed').length,
  };
}

function viewMessages(){
  const m = D.outbox;
  if (!m) return `<div class="panel">Loading…</div>`;
  const c = msgCounts();

  const rows = m.slice(0, 80).map(x => `<tr class="${x.status === 'failed' ? 'flagrow' : ''}">
    <td style="white-space:nowrap">${x.sched_staff
        ? esc(x.sched_staff.first_name || x.sched_staff.name) : '<span class="rtime">—</span>'}</td>
    <td><span class="chip ${esc(x.channel)}">${esc(x.channel)}</span></td>
    <td class="rtime">${esc(x.to_addr || 'no phone, no email')}</td>
    <td>${esc(x.subject || '')}<div class="rtime">${esc((x.body || '').split('\n')[0])}</div></td>
    <td><span class="mstat ${esc(x.status)}">${esc(x.status)}</span>
      ${x.error ? `<div class="rtime" style="color:var(--alert)">${esc(x.error)}</div>` : ''}</td>
    <td class="rtime" style="white-space:nowrap">${esc(String(x.created_at).slice(0, 16).replace('T', ' '))}</td>
  </tr>`).join('');

  return `<h2>Messages</h2>
    <div class="panel">
      <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center">
        <div><div class="bignum">${c.queued}</div><div class="rtime">waiting to go</div></div>
        ${c.unreachable ? `<div><div class="bignum badnum">${c.unreachable}</div>
          <div class="rtime">cannot be reached</div></div>` : ''}
        <div><div class="bignum">${c.sent}</div><div class="rtime">sent</div></div>
        ${c.failed ? `<div><div class="bignum badnum">${c.failed}</div>
          <div class="rtime">failed</div></div>` : ''}
        <div style="flex:1"></div>
        <button class="btn" id="mcheck">Check what would go</button>
        <button class="btn primary" id="msend" ${c.queued ? '' : 'disabled'}>Send ${c.queued} now</button>
      </div>
      ${c.unreachable ? `<div class="note warn" style="margin-top:11px">
        <strong>${c.unreachable} message${c.unreachable === 1 ? '' : 's'} cannot be delivered</strong>
        — those people have neither a phone number nor an email address. They are
        written down here so they are not silently lost; add their details on the
        Staff tab and they can be sent again.</div>` : ''}
      <div class="note" style="margin-top:11px">Email sends today. Texts wait on four
        AWS credentials — until those are set, anything addressed to a phone stays
        queued rather than being marked failed, because these are real messages to
        real people and marking them failed would lose them.</div>
    </div>
    ${m.length ? `<div class="panel" style="overflow-x:auto">
      <table><thead><tr><th>Who</th><th>How</th><th>To</th><th>Message</th>
        <th>Status</th><th>Queued</th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${m.length > 80 ? `<div class="rtime" style="margin-top:8px">Showing the most recent 80 of ${m.length}.</div>` : ''}
    </div>` : `<div class="panel"><div class="rtime">Nothing has been queued yet.
      Messages appear here when you publish a fortnight, send an availability
      request, or welcome somebody new.</div></div>`}`;
}
