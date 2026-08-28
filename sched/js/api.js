/* Every Supabase call lives here.
   One place to look when a query is wrong, and the only file that knows the
   shape of the database. Views receive data; they never fetch it. */

async function loadAll(){
  /* Keep two weeks of drafts on the board. The function only fills gaps —
     it never touches a session that already exists — so this is safe to call
     every time and means the days Rachel is working on are always there. */
  await sb.rpc('ensure_upcoming_sessions', { p_days: 14 });

  const [roles,times,hallRoles,sessions,assigns,cpos,days,staff,caps,time,rpa,shares,payouts,avail,sessionRoles,declines]=await Promise.all([
    sb.from('sched_roles').select('*').order('sort'),
    sb.from('sched_hall_role_times').select('*'),
    sb.from('sched_hall_role_needs').select('*'),
    sb.from('sched_sessions').select('*').order('session_date').order('hall_id').order('part'),
    sb.from('sched_assignments').select('*, sched_staff!sched_assignments_staff_id_fkey(name), sched_sessions!inner(hall_id)')
      .order('slot_index'),
    sb.from('sched_caller_positions').select('*, sched_staff!sched_caller_positions_staff_id_fkey(name), sched_sessions!inner(hall_id,session_date,part)'),
    sb.from('sched_hall_days').select('*').order('hall_id').order('dow').order('part'),
    sb.from('sched_staff').select('*').order('name'),
    sb.from('sched_staff_role_capability').select('*'),
    sb.from('sched_time_entries').select('*'),
    sb.from('sched_rpa_defaults').select('*').order('hall_id').order('dow'),
    sb.from('sched_session_shares').select('*'),
    sb.from('sched_commission_payouts').select('*'),
    sb.from('sched_staff_availability').select('*'),
    sb.from('sched_session_roles').select('*'),
    sb.from('sched_declines').select('*, sched_staff!sched_declines_staff_id_fkey(name, first_name)')
      .order('declined_at', {ascending:false}),
  ]);
  const err=[roles,times,hallRoles,sessions,assigns,cpos,days,staff,caps,time,rpa,shares,payouts,avail,sessionRoles,declines].find(r=>r.error);
  if(err){ $('main').innerHTML=`<div class="panel">Load failed: ${esc(err.error.message)}</div>`; return; }
  /* SPREAD D, do not replace it. This used to be a bare object literal with no
     `periods` key, so loadAll() silently deleted the fortnights that boot() had
     just fetched one line earlier — and currentPeriod() then returned null, so
     the Schedule screen offered "Start this fortnight" on top of a fortnight
     that already existed and was 269/310 full. Every action that reloads (add
     staff, save, clear) wiped them again. Anything owned by another loader --
     periods, fillReport -- has to survive this assignment. */
  D={...D,
     roles:roles.data,times:times.data,needs:hallRoles.data,days:days.data,staff:staff.data,caps:caps.data,time:time.data,rpa:rpa.data,shares:shares.data,payouts:payouts.data,avail:avail.data,sessionRoles:sessionRoles.data,declines:declines.data||[],
     sessions:sessions.data,assigns:assigns.data,calling:{},cpos:cpos.data||[]};
  for(const r of cpos.data||[]){
    const s=r.sched_sessions, k=s.part==='single'?s.session_date:`${s.session_date} ${s.part}`;
    (D.calling[k]=D.calling[k]||[]);
    let e=D.calling[k].find(x=>x.name===r.sched_staff.name);
    if(!e){e={name:r.sched_staff.name,sections:['','','']};D.calling[k].push(e);}
    e.sections[r.section-1]=r.position;
  }
  if(sel>=D.sessions.length || !D.sessions[sel] || !isUpcoming(D.sessions[sel])) sel=firstUpcomingIndex();
  render();
}

/* Messaging. Every one of these QUEUES; the sender drains it separately, so a
   provider outage can never roll back a publish. */
async function publishPeriod(id){ return sb.rpc('schedule_publish', { p_id:id }); }
async function sendAvailability(requestId, nudge){
  return sb.rpc('availability_send', { p_request:requestId||null, p_nudge:!!nudge });
}
async function sendWelcome(staffId){ return sb.rpc('staff_welcome', { p_staff:staffId }); }
async function loadOutbox(){
  return sb.from('sched_messages').select('*, sched_staff(name, first_name)')
    .order('created_at',{ascending:false}).limit(200);
}
async function drainOutbox(send){
  return sb.functions.invoke('send-notifications', { body:{ send: !!send, dryRun: !send } });
}

async function loadAttention(){ return sb.rpc('manager_attention'); }
async function markAttentionSeen(){ return sb.rpc('manager_mark_seen'); }

/* Attendance and sales from the hall's own reconciliation, rather than Rachel
   retyping figures the operational side already holds. */
async function pullSessionActuals(session_id){
  return sb.rpc('session_actuals', { p_session: session_id });
}

async function setManagerOfRecord(session_id, role_id, staff_id){
  return sb.rpc('set_manager_of_record',
    { p_session: session_id, p_role: role_id, p_staff: staff_id });
}

/* End-of-night: who never closed out, and asking them to say when. */
/* Add Hours on a person: a manual worked-time entry -- payroll-real, not a
   scheduled shift. The RPC ADDS on a same-day repeat, so two 1-hour stints on
   one day become 2 hours rather than an error. */
async function addWorkedHours(staffId, hall, date, hours, category, note){
  return sb.rpc('add_worked_hours', { p_staff: staffId, p_hall: hall, p_date: date,
    p_hours: hours, p_category: category, p_note: note || null });
}
/* Text everybody their schedule link. SMS ONLY, on Angela's instruction --
   the rows queue until the SMS provider is wired, and nothing falls back to
   email. Never call notify() from a blast: falling back is its whole point. */
async function scheduleBlast(periodId, onlyUnconfirmed){
  return sb.rpc('schedule_blast', { p_period: periodId, p_only_unconfirmed: !!onlyUnconfirmed });
}
/* The manager assigns or changes a character from the person's page. A plain
   update: the one-character-one-person unique index is the guard, and a
   violation surfaces as the error message rather than being checked first. */
async function setStaffPet(staffId, pet, kind){
  return sb.from('sched_staff').update({ pet, pet_kind: kind }).eq('id', staffId);
}
async function loadUnclosed(hall){ return sb.rpc('unclosed_shifts',
  { p_hall: hall || null, p_date: null, p_days: 3 }); }
async function requestTimeFixes(items){ return sb.rpc('request_time_fixes', { p_items: items }); }
async function resolveTimeFix(id, approve){ return sb.rpc('time_fix_resolve', { p_id: id, p_approve: approve }); }

/* Caller rotation. One row per caller per section; deleting the row is how a
   cell goes back to blank, since `position` is NOT NULL. */
async function saveCallerPosition(session_id, staff_id, section, position){
  if(!position) return sb.from('sched_caller_positions').delete()
    .eq('session_id',session_id).eq('staff_id',staff_id).eq('section',section);
  return sb.from('sched_caller_positions')
    .upsert({session_id,staff_id,section,position},{onConflict:'session_id,staff_id,section'});
}

/* Schedule periods: the fortnight Rachel builds as one bundle. */
async function ensurePeriod(anyDate){
  return sb.rpc('schedule_period_ensure', { p_any_date: anyDate || null });
}
async function loadPeriods(){ return sb.rpc('schedule_periods', { p_limit: 24 }); }
async function setPeriod(id, patch){
  return sb.rpc('schedule_period_set',
    { p_id:id, p_label:patch.label ?? null, p_note:patch.note ?? null,
      p_status:patch.status ?? null });
}

/* The fortnightly availability request. All three go through RPCs rather than
   table writes: the reply rows, the token minting and the session
   materialisation have to happen together or the request covers fewer nights
   than it claims. */
async function createAvailabilityRequest(start, end, cap, note){
  return sb.rpc('availability_request_create',
    { p_start:start, p_end:end, p_cap:+cap, p_note:note||null, p_send:true });
}
async function loadAvailabilityStatus(){ return sb.rpc('availability_status', { p_request:null }); }
async function reviewAvailability(request_id, staff_id){
  return sb.rpc('availability_review', { p_request:request_id, p_staff:staff_id });
}
async function resetStaffLink(staff_id, revoke){
  return sb.rpc('staff_link_reset', { p_staff:staff_id, p_revoke:!!revoke });
}

/* Availability has three states and the table only stores two, because "not
   answered" is the ABSENCE of a row. Setting a slot back to unanswered
   therefore deletes rather than writing a null — a null would be a third
   stored value meaning the same thing, and the two would drift. */
async function saveAvailability(staff_id, dow, part, available){
  if(available === null || available === undefined){
    return sb.from('sched_staff_availability').delete()
      .eq('staff_id',staff_id).eq('dow',dow).eq('part',part);
  }
  return sb.from('sched_staff_availability').upsert(
    {staff_id,dow,part,available,updated_at:new Date().toISOString()},
    {onConflict:'staff_id,dow,part'});
}

async function addStaff(name, phone, email){
  return sb.from('sched_staff').insert({name, phone: phone||null, email: email||null, active: true});
}

/* Adding a role writes a capability row; removing it deletes the row, so the
   table only ever holds qualifications that exist. */
async function setCapability(staff_id, role_id, on){
  return on
    ? sb.from('sched_staff_role_capability').upsert(
        {staff_id, role_id, can_do:true, updated_at:new Date().toISOString()},
        {onConflict:'staff_id,role_id'})
    : sb.from('sched_staff_role_capability').delete()
        .eq('staff_id',staff_id).eq('role_id',role_id);
}

/* Deactivating never deletes. Someone who leaves and returns keeps their
   history, their character and their availability. */
async function setStaffContact(id, field, value){
  const patch={}; patch[field]=value||null; patch.updated_at=new Date().toISOString();
  return sb.from('sched_staff').update(patch).eq('id', id);
}

async function setStaffActive(id, active){
  return sb.from('sched_staff').update(
    {active, deactivated_at: active ? null : new Date().toISOString(), updated_at: new Date().toISOString()}
  ).eq('id', id);
}

/* Per-session headcount. Writing here overrides the hall template for this
   one session and leaves the template alone. */
async function setSessionRoleCount(session_id, role_id, needed){
  return sb.from('sched_session_roles').upsert({session_id, role_id, needed},
    {onConflict:'session_id,role_id'});
}

/* The PIN is hashed inside the database; the plaintext is never stored and
   never comes back out. */
/* One manager PIN, hashed in the database. Staff tap their name at the clock;
   this PIN is only needed to approve an unscheduled shift. */
async function setManagerPin(pin){ return sb.rpc('set_manager_pin', { p_pin: pin }); }

/* Writes. Each returns {error} so callers can report without knowing PostgREST. */
async function saveAssignment(session_id, role_id, slot_index, staff_id){
  return staff_id
    ? sb.from('sched_assignments').upsert(
        {session_id,role_id,slot_index:+slot_index,staff_id,response:'pending',
         updated_at:new Date().toISOString()},{onConflict:'session_id,role_id,slot_index'})
    : sb.from('sched_assignments').delete()
        .eq('session_id',session_id).eq('role_id',role_id).eq('slot_index',+slot_index);
}

async function saveHallRoleNeed(hall_id, role_id, dow, part, needed){
  return sb.from('sched_hall_role_needs').upsert(
    {hall_id,role_id,dow:+dow,part,needed,updated_at:new Date().toISOString()},
    {onConflict:'hall_id,role_id,dow,part'});
}

async function saveRpaTarget(hall_id, dow, part, target_rpa){
  return sb.from('sched_rpa_defaults').upsert(
    {hall_id,dow:+dow,part,target_rpa,updated_at:new Date().toISOString()},
    {onConflict:'hall_id,dow,part'});
}

async function saveSessionResults(id, patch){
  return sb.from('sched_sessions').update(patch).eq('id',id);
}

async function addHallDay(hall_id, dow, part){
  return sb.from('sched_hall_days').upsert({hall_id,dow,part,active:true});
}

async function removeHallDay(hall_id, dow, part){
  await sb.from('sched_hall_role_needs').delete().eq('hall_id',hall_id).eq('dow',+dow).eq('part',part);
  return sb.from('sched_hall_days').delete().eq('hall_id',hall_id).eq('dow',+dow).eq('part',part);
}

async function confirmCommission(session, rows, total, pool){
  await sb.from('sched_session_shares').upsert(
    rows.map(r=>({session_id:session.id,staff_id:r.staff_id,shares:r.shares})),
    {onConflict:'session_id,staff_id'});
  const { error }=await sb.from('sched_commission_payouts').upsert(
    rows.map(r=>({session_id:session.id,staff_id:r.staff_id,session_date:session.session_date,
      shares:r.shares,total_shares:total,commission_pool:pool,
      payout_amount:Math.round((r.shares/total)*pool*100)/100})),{onConflict:'session_id,staff_id'});
  if(error) return {error};
  return sb.from('sched_sessions')
    .update({commission_confirmed_at:new Date().toISOString()}).eq('id',session.id);
}
