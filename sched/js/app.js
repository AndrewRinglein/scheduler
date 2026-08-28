/* Wiring: render dispatch, event handlers, auth.
   The only file that touches the DOM outside a view's returned HTML. */

/* Re-rendering replaces the DOM, which throws away the field you are typing in
   and the caret with it — the symptom is "it won't let me type". Remember which
   input was focused and where the caret was, and put it back afterwards. */
function focusToken(){
  const el=document.activeElement;
  if(!el||!el.dataset) return null;
  const k=el.dataset.res||el.dataset.sh||el.dataset.k||el.dataset.al||el.id;
  if(!k) return null;
  let start=null,end=null;
  try{ start=el.selectionStart; end=el.selectionEnd; }catch{}
  /* If the browser will not report a caret position, put it at the END.
     Defaulting to 0 is what made typed digits come out reversed. */
  if(start==null){ start=end=String(el.value??'').length; }
  return {k,start,end};
}
function restoreFocus(t){
  if(!t) return;
  const el=document.querySelector(
    `[data-res="${CSS.escape(t.k)}"],[data-sh="${CSS.escape(t.k)}"],[data-k="${CSS.escape(t.k)}"],` +
    `[data-al="${CSS.escape(t.k)}"],#${CSS.escape(t.k)}`);
  if(!el) return;
  el.focus();
  if(t.start!=null && el.setSelectionRange){
    try{ el.setSelectionRange(t.start,t.end); }catch{}
  }
}

/* A small note beside the row that asked for it. The header flash is the wrong
   place for this: with a table of sessions, "not available" has to say WHICH
   one, and the answer is "the one you just ticked". */
function pullSay(id, text, ok){
  const el=$(`pm_${id}`); if(!el) return;
  el.textContent=text;
  el.className=`pullmsg on ${ok?'ok':'bad'}`;
  clearTimeout(el._t);
  el._t=setTimeout(()=>{ const e2=$(`pm_${id}`); if(e2){ e2.textContent=''; e2.className='pullmsg'; } }, 4000);
}

/* Transient status in the header, away from the pending-edits bar. */
let flashTimer=null;
function flash(msg, ms=1500){
  const el=$('who'); if(!el) return;
  el.dataset.orig ??= el.textContent;
  el.textContent=msg;
  clearTimeout(flashTimer);
  flashTimer=setTimeout(()=>{ el.textContent=el.dataset.orig||''; }, ms);
}

function render(){
  const t=focusToken();
  $('main').innerHTML=(person&&view==='staff')?viewPerson():
    {week:viewWeek,wall:viewRoster,closeout:viewCloseout,demo:viewDemo,staff:viewStaff,avail:viewAvailability,hours:viewHours,template:viewTemplate,commission:viewCommission,attention:viewAttention,breakplan:viewBreakPlan,messages:viewMessages}[view]();
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===view));
  $('bar').classList.toggle('on',dirty());
  $('status').textContent=dirty()?`${Object.keys(edits).length} change(s)`:'';
  restoreFocus(t);
  /* The break board is a live scene of characters, not markup that gets
     re-rendered -- start it only while that tab is on screen so a loop is
     never left running behind another view. */
  if (typeof demoSceneStart === 'function') {
    (view === 'demo' && demo && demo.tab === 'board') ? demoSceneStart() : demoSceneStop();
  }
}

/* ---------------- events ---------------- */

/* ---------------- events ---------------- */
document.querySelector('nav').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return; view=b.dataset.v; person=null; render();
  /* Fetched on arrival rather than at boot: replies land while Rachel has the
     page open, so a figure cached at load time would quietly go stale. */
  if(view==='avail') loadAvailStatus().then(render);
  if(view==='attention') loadAttention_().then(render);
  if(view==='messages') loadOutbox_().then(render);
  if(view==='closeout') loadUnclosed_().then(render); });
$('main').addEventListener('click',async e=>{
  /* Wall chart: a card header jumps to that session in Schedule. The wall is
     for reading; the moment you want to CHANGE something you want the other
     screen, so clicking takes you there rather than growing edit controls here. */
  const goto_=e.target.closest('[data-goto]');
  if(goto_){ sel=Number(goto_.dataset.goto); view='week'; person=null; return render(); }
  /* ---- demo tab: nothing here touches the database ---- */
  /* The simulate buttons rig real punches and move the clock, then let the
     planner and the alert rules do the rest. A full render is right here --
     the scene is rebuilt from the new state and reseeded. */
  const dsim=e.target.closest('[data-dsim]');
  if(dsim){ demoSim(dsim.dataset.dsim); demo.tab='board'; return render(); }

  /* worker-portal demo phone */
  const wt=e.target.closest('[data-wtab]');
  if(wt){ demo.wtab=wt.dataset.wtab; return render(); }
  const dr=e.target.closest('[data-dresp]');
  if(dr){
    const [aid,ans]=dr.dataset.dresp.split('|');
    (demo.resp=demo.resp||{})[aid]=ans;   // demo state only — never D.assigns
    return render();
  }
  const dpet=e.target.closest('[data-dpet]');
  if(dpet){
    const [pid,kind]=dpet.dataset.dpet.split('|');
    const st=D.staff.find(x=>x.id===demo.who) || D.staff.find(x=>x.id===demo.crew[0]?.id);
    if(st){ st.pet=pid; st.pet_kind=kind; }   // local only; refresh restores
    return render();
  }

  /* Needs You walkthrough: send one, or all */
  const asend=e.target.closest('[data-attnsend]');
  if(asend){
    const sent={...(edits['ui|attnsent']||{})}; sent[asend.dataset.attnsend]=true;
    edits['ui|attnsent']=sent; return render();
  }
  if(e.target.id==='attnsendall'){
    const sent={}; (typeof DEMO_ATTN!=='undefined'?DEMO_ATTN:[]).forEach((_,i)=>sent[i]=true);
    edits['ui|attnsent']=sent; return render();
  }

  const dtab=e.target.closest('[data-dtab]');
  if(dtab){ demo.tab=dtab.dataset.dtab; return render(); }
  if(e.target.id==='dreset'){ demo=demoInit(demo.sessionId); demoSeen.clear(); return render(); }
  const db=e.target.closest('[data-dbreak]');
  if(db){
    const [id,what]=db.dataset.dbreak.split('|');
    demo.decide=demo.decide||{};
    demo.decide[id]=what;
    flash(what==='skip' ? 'Skipped — in the hall that owes a premium hour.'
                        : 'Pushed 15 minutes.');
    return render();
  }
  /* Tapping a clocked-in chip on the tablet opens that person's actions. */
  const cact=e.target.closest('[data-cact]');
  if(cact){
    edits['ui|cact'] = edits['ui|cact']===cact.dataset.cact ? null : cact.dataset.cact;
    if(!edits['ui|cact']) delete edits['ui|cact'];
    return render();
  }

  const dp=e.target.closest('[data-dpunch]');
  if(dp){
    const [id,what]=dp.dataset.dpunch.split('|');
    /* A clock-in from the tablet board leaves visibly: the tile shrinks out
       over 240ms and THEN the punch lands and the board redraws without it.
       Punching first would rebuild the grid instantly and the departure --
       the thing Angela asked to see -- would never be on screen. */
    if(what==='in' && dp.classList.contains('ctile') && !dp.dataset.going){
      dp.dataset.going='1'; dp.classList.add('going');
      setTimeout(()=>{ (demo.punch[id] || (demo.punch[id]={breaks:[]})).in=demo.t; render(); }, 240);
      return;
    }
    const cur=demo.punch[id] || (demo.punch[id]={breaks:[]});
    if(what==='in')   cur.in=demo.t;
    if(what==='out'){ (cur.breaks||[]).forEach(b=>{ if(b.end==null) b.end=demo.t; }); cur.out=demo.t; }
    if(what==='rest'||what==='meal') cur.breaks.push({kind:what,start:demo.t,end:null});
    if(what==='back') (cur.breaks||[]).forEach(b=>{ if(b.end==null) b.end=demo.t; });
    return render();
  }

  const mor=e.target.closest('[data-mor]');
  if(mor){
    const [sid,rid,pid]=mor.dataset.mor.split('|');
    const { data, error }=await setManagerOfRecord(sid,rid,pid);
    if(error) return flash(error.message,5000);
    if(!data?.ok) return flash(data?.error||'Could not do that',5000);
    flash('Manager of record changed.');
    await loadAll(); return render();
  }
  if(e.target.id==='tfsend'){
    const items=closeoutAskPayload();
    if(!items.length) return flash('Nobody left to ask.');
    e.target.disabled=true;
    const { data, error }=await requestTimeFixes(items);
    e.target.disabled=false;
    if(error) return flash(error.message, 5000);
    /* Say what actually went, including what did NOT: "texted 5" when two of
       them have no number is the kind of report that gets believed. */
    flash(`Asked ${data.asked}${data.already_open?`, ${data.already_open} already had an open request`:''}${
      data.unreachable?`, ${data.unreachable} could not be reached`:''}.`, 5000);
    await loadUnclosed_(); return render();
  }
  const tfok=e.target.dataset.tfok, tfno=e.target.dataset.tfno;
  if(tfok||tfno){
    const { data, error }=await resolveTimeFix(tfok||tfno, !!tfok);
    if(error) return flash(error.message, 5000);
    if(!data?.ok) return flash(data?.error||'Could not do that', 5000);
    flash(tfok?'Approved — the clock has been corrected.':'Rejected.');
    await loadUnclosed_(); await loadAll(); return render();
  }
  if(e.target.id==='wallprint'){ window.print(); return; }
  if(e.target.id==='rotbuild'||e.target.id==='rotclear'){
    const sid=e.target.dataset.sess, s2=D.sessions.find(x=>x.id===sid);
    if(!s2) return;
    const callers=rotCallers(s2);
    if(!callers.length) return flash('No callers on this session yet.');
    if(e.target.id==='rotclear'){
      for(const c of callers) for(const n of [1,2,3]) edits[`cp|${sid}|${c.id}|${n}`]='';
      return render();
    }
    /* planRotation has existed since the rotation was reverse-engineered from
       Rachel's sheet and had no caller until now. */
    const plan=planRotation(callers.map(c=>({name:c.name,training:c.training})));
    plan.forEach((p,i)=>p.sections.forEach((pos,si)=>{
      edits[`cp|${sid}|${callers[i].id}|${si+1}`]=pos; }));
    flash('Rotation built — change any cell, then Save.');
    return render();
  }
  if(e.target.id==='wallpast'){ edits['ui|wallPast']=e.target.checked; render(); return; }
  if(e.target.id==='bpprev'||e.target.id==='bpnext'){
    const list=breakPlanSessions(), at=list.findIndex(([x])=>x.id===(D.sessions[sel]||{}).id);
    const to=list[(at<0?0:at)+(e.target.id==='bpnext'?1:-1)];
    if(to){ sel=to[1]; render(); }
    return;
  }

  if(e.target.id==='schedpast'){ edits['ui|schedPast']=e.target.checked; render(); return; }
  if(e.target.id==='showpast'){ edits['ui|showPast']=e.target.checked; render(); return; }
  if(e.target.id==='showinactive'){ edits['ui|showInactive']=e.target.checked; render(); return; }

  if(e.target.id==='addstaff'){
    const n=$('newname').value.trim();
    if(!n){ $('status').textContent='A name is required.'; return; }
    const { error }=await addStaff(n, $('newphone').value.trim(), $('newemail').value.trim());
    if(error){ $('status').textContent=error.message; return; }
    await loadAll(); $('status').textContent='Added '+n+'.'; return;
  }

  const tg=e.target.closest('[data-toggle]');
  if(tg){
    const p=D.staff.find(x=>x.id===tg.dataset.toggle);
    const { error }=await setStaffActive(p.id, !p.active);
    if(error){ $('status').textContent=error.message; return; }
    await loadAll(); return;
  }

  /* Availability: click a cell to flip yes/no. */
  const av=e.target.closest('[data-av]');
  if(av){ const [sid,dow,part]=av.dataset.av.split('|');
    /* Cycles yes -> no -> not answered, so a cell clicked by mistake can go
       back to unanswered instead of being left as a guess nobody made. */
    edits['av|'+av.dataset.av]=nextAvail(isAvailable(sid,+dow,part));
    $('bar').classList.add('on'); render(); return; }

  /* A person's name anywhere opens their detail; the back link clears it. */
  const pl=e.target.closest('[data-person]');
  if(pl){ e.preventDefault(); person=pl.dataset.person||null; view='staff';
    delete edits['ui|pvw']; delete edits['ui|ahmsg']; render(); return; }

  if(e.target.id==='mpetbtn'){
    if(edits['ui|petpick']) delete edits['ui|petpick']; else edits['ui|petpick']=true;
    delete edits['ui|mpetmsg'];
    return render();
  }
  const mpet=e.target.closest('[data-mpet]');
  if(mpet && person){
    const [pid,kind]=mpet.dataset.mpet.split('|');
    const { error }=await setStaffPet(person, pid, kind);
    if(error){
      edits['ui|mpetmsg']=/unique|duplicate/i.test(error.message)
        ? 'Somebody just took that one — pick another.' : error.message;
      return render();
    }
    /* Apply locally as well. In the live app loadAll() refetches and the
       server's answer wins; in the offline demo every write is a no-op by
       design, and loadAll() re-reads the same objects -- so without this line
       the demo reported "Done" while the character never changed, which is
       exactly the bug Angela hit on Abygail's page. */
    const stp=D.staff.find(x=>x.id===person);
    if(stp){ stp.pet=pid; stp.pet_kind=kind; }
    await loadAll();
    edits['ui|mpetmsg']=`Done — ${petName(pid)} it is.`;
    return render();
  }

  if(e.target.id==='pvwbtn'){
    edits['ui|pvw'] = edits['ui|pvw']===person ? null : person;
    if(!edits['ui|pvw']) delete edits['ui|pvw'];
    return render();
  }
  if(e.target.id==='ah-add'){
    const date=$('main').querySelector('#ah-date')?.value;
    const hall=$('main').querySelector('#ah-hall')?.value;
    const hours=Number($('main').querySelector('#ah-hours')?.value);
    const cat=$('main').querySelector('#ah-cat')?.value;
    const note=$('main').querySelector('#ah-note')?.value.trim();
    if(!date||!hours){ edits['ui|ahmsg']='Pick a day and enter hours.'; return render(); }
    const { data, error }=await addWorkedHours(person, hall, date, hours, cat, note);
    if(error||!data?.ok){ edits['ui|ahmsg']=error?.message||data?.error||'Could not save.'; return render(); }
    /* Reload so the hours table below shows the entry the moment it exists --
       an Add that does not visibly land reads as an Add that failed. */
    await loadAll();
    edits['ui|ahmsg']=data.merged
      ? `Added — that day now totals ${data.total_hours}h (${data.category}).`
      : `Added ${hours}h (${data.category}) on ${date}.`;
    return render();
  }

  /* A commission line selects that session. */
  const sr=e.target.closest('[data-sess]');
  if(sr){ sel=+sr.dataset.sess; render(); return; }

  /* A schedule card selects that session and scrolls to the roster. */
  const c=e.target.closest('.card'); if(!c) return; sel=+c.dataset.i; render();
  document.querySelector('#main h2:nth-of-type(2)')?.scrollIntoView({behavior:'smooth',block:'start'}); });
$('main').addEventListener('input',e=>{
  /* A range slider fires `input` as it is dragged; `change` only on release,
     which makes the demo clock feel broken. */
  /* On the break board, do NOT re-render: the scene reads demo.t on its own
     next frame, so the characters walk to their new state instead of being
     destroyed and rebuilt underneath the drag. */
  if(e.target.id==='dtime'){ demo.t=Number(e.target.value);
    if(demo.tab==='board' && typeof demoSceneLive==='function' && demoSceneLive())
      return demoSceneTime();
    render(); }
});
$('main').addEventListener('change',async e=>{

  if(e.target.id==='bpsel'){ sel=Number(e.target.value); render(); return; }
  /* The blast checkbox re-arms nothing -- it just changes who the armed count
     would cover, so an armed button recounts. */
  if(e.target.id==='pblastu'){
    if(e.target.checked) edits['ui|blastu']=true; else delete edits['ui|blastu'];
    if(edits['ui|blastarm']) render();
    return;
  }
  /* Pull: fill sales and attendance from the operational reconciliation. It
     lands as a PENDING edit, so Rachel still sees it and presses Save --
     nothing silently rewrites a figure a commission is computed from. */
  const pull=e.target.dataset.pull;
  if(pull){
    const box=e.target;
    if(!box.checked){ pulled.delete(pull); return render(); }
    const { data, error }=await pullSessionActuals(pull);
    if(error){ box.checked=false; return pullSay(pull, error.message); }
    if(!data?.found){ box.checked=false; pulled.delete(pull);
      return pullSay(pull, 'not available'); }
    if(data.total_sales!=null) edits[`res|${pull}|total_sales`]=String(data.total_sales);
    if(data.attendance!=null)  edits[`res|${pull}|attendance`]=String(data.attendance);
    pulled.add(pull);
    render();
    return pullSay(pull, `pulled ${data.slot?`from ${data.slot}`:''} — press Save`, true);
  }
  if(e.target.id==='dsess'){ demo=demoInit(e.target.value); demoSeen.clear(); return render(); }
  if(e.target.id==='dwho'){ demo.who=e.target.value; return render(); }
  if(e.target.id==='dtime'){ demo.t=Number(e.target.value);
    if(demo.tab==='board' && typeof demoSceneLive==='function' && demoSceneLive())
      return demoSceneTime();
    return render(); }

  const fwd=e.target.dataset.rpafwd;
  if(fwd){ if(e.target.checked) edits[`fwd|${fwd}`]=true; else delete edits[`fwd|${fwd}`];
           render(); return; }

  const cp=e.target.dataset.cp;
  if(cp){ edits[`cp|${cp}`]=e.target.value; render(); return; }

  const cap=e.target.dataset.cap;
  if(cap){ const [sid,rid]=cap.split('|');
    const { error }=await setCapability(sid, rid, e.target.checked);
    if(error){ $('status').textContent=error.message; return; }
    await loadAll(); return; }

  const key=e.target.dataset.a; if(!key) return;
  const [session_id,role_id,slot_index]=key.split('|');
  const staff_id=e.target.value||null;
  /* Assignments save immediately, so the bottom bar — which exists for
     PENDING edits waiting on a Save button — must not appear. Borrowing it
     made a Save/Discard pair flash up and vanish on every choice, implying
     there was something to press. Status goes in the header instead. */
  flash('Saving…');
  const { error }=await saveAssignment(session_id,role_id,slot_index,staff_id);
  if(error){ flash('Failed: '+error.message, 6000); return; }
  await loadAll();
  flash('Saved');
});

/* The modal is outside #main, so it needs its own listeners. */
function openModal(html){ $('modalbox').innerHTML=html; $('modal').hidden=false; }
function closeModal(){ $('modal').hidden=true; allocSel=null;
  for(const k of Object.keys(edits)) if(k.startsWith('al|')) delete edits[k]; }

$('modal').addEventListener('input',e=>{
  const t=e.target.dataset.al; if(!t) return;
  edits['al|'+t]=e.target.value===''?0:Number(e.target.value);
  let st=null,en=null; try{ st=e.target.selectionStart; en=e.target.selectionEnd; }catch{}
  if(st==null){ st=en=String(e.target.value??'').length; }
  const tok={k:t,start:st,end:en};
  openModal(renderAllocate());
  const el=document.querySelector(`[data-al="${CSS.escape(t)}"]`);
  if(el){ el.focus(); try{ el.setSelectionRange(tok.start,tok.end); }catch{} }
});

$('modal').addEventListener('click',async e=>{
  if(e.target.id==='closealloc'||e.target.classList.contains('modal-back')){ closeModal(); return; }
  if(e.target.id!=='confirmalloc') return;
  const s=D.sessions[allocSel];
  const onShift=new Set(D.assigns.filter(x=>x.session_id===s.id&&x.staff_id).map(x=>x.staff_id));
  const rows=D.staff.map(p=>{
    const k=`al|${s.id}|${p.id}`;
    const sh=k in edits?Number(edits[k]):(onShift.has(p.id)?1:0);
    return {staff_id:p.id, shares:sh};
  }).filter(r=>r.shares>0);
  const total=rows.reduce((n,r)=>n+r.shares,0);
  const sales=Number(s.total_sales), att=Number(s.attendance), tgt=Number(s.target_rpa||0);
  const rpa=att?sales/att:0;
  const pool=rpa>tgt?(rpa-tgt)*att*Number(s.comm_rate):0;
  if(!total||!pool) return;
  e.target.disabled=true; e.target.textContent='Saving…';
  const { error }=await confirmCommission(s,rows,total,pool);
  if(error){ e.target.disabled=false; e.target.textContent='Confirm Allocation';
             $('status').textContent=error.message; return; }
  closeModal(); await loadAll(); $('status').textContent='Allocation confirmed.';
});

/* The Monday fourteen days before this fortnight began. */
function prevStart(cur){
  const [y,m,d]=cur.starts_on.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d-14)).toISOString().slice(0,10);
}

/* Every slot in these sessions that has nobody in it, from the crew template
   plus any per-session override. */
function emptySlotsIn(sessions){
  const out=[];
  for(const s of sessions){
    const dw=dowOf(s);
    for(const r of D.roles){
      const tmpl=needFor(r.id,dw,s.part,s.hall_id) ?? 0;
      const over=D.sessionRoles.find(x=>x.session_id===s.id&&x.role_id===r.id)?.needed;
      const need=over ?? tmpl;
      for(let i=0;i<need;i++){
        const held=D.assigns.find(a=>a.session_id===s.id&&a.role_id===r.id
                                  &&a.slot_index===i&&a.staff_id);
        if(!held) out.push({ session_id:s.id, role_id:r.id, slot_index:i });
      }
    }
  }
  return out;
}

/* The fortnights. Loaded with everything else because the schedule screen
   cannot draw a single card without knowing which period it is showing. */
async function loadPeriods_(){
  const { data, error }=await loadPeriods();
  D.periods = (!error && Array.isArray(data)) ? data : [];
  if(!D.periods.length){
    /* First run: make the fortnight containing today so there is something to
       open onto, rather than an empty screen with a button. */
    const { error:e2 }=await ensurePeriod(null);
    if(!e2){ const r=await loadPeriods(); D.periods=Array.isArray(r.data)?r.data:[]; }
  }
  if(!periodId){
    const cur=D.periods.find(p=>p.is_current)||D.periods[0];
    periodId=cur?cur.id:null;
  }
}

/* Step to the fortnight before or after the one on screen, making it if it does
   not exist yet — which is how Rachel starts next fortnight's schedule. */
async function stepPeriod(days){
  const cur=currentPeriod(); if(!cur) return;
  const [y,m,d]=cur.starts_on.split('-').map(Number);
  const target=new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
  const { data, error }=await ensurePeriod(target);
  if(error) return flash(error.message);
  if(!data?.ok) return flash('Could not open that fortnight.');
  await loadPeriods_(); periodId=data.id; render();
}

/* Pulled separately from loadAll(): it is one RPC, only the Availability tab
   needs it, and it changes as people reply rather than when the page loads. */
/* Loaded on boot and refreshed after anything that could change it, so the
   badge is never stale in a way that matters. */
/* Fetched on arrival and after every action: it changes as the night ends and
   as people answer, so a figure cached at page load would be wrong by 11pm. */
async function loadUnclosed_(){
  const { data, error }=await loadUnclosed(null);
  D.unclosed = (!error && Array.isArray(data)) ? data : [];
}

async function loadOutbox_(){
  const { data, error }=await loadOutbox();
  D.outbox = error ? [] : (data||[]);
}

async function loadAttention_(){
  const { data, error }=await loadAttention();
  D.attention = (!error && data && data.ok) ? data : null;
  const b=$('attbadge');
  if(b){ const n=attentionCount(); b.textContent=n||''; b.classList.toggle('on', n>0); }
}

async function loadAvailStatus(){
  const { data, error }=await loadAvailabilityStatus();
  D.availStatus = (!error && data && data.ok) ? data : null;
}

/* Enter commits, Escape abandons. A contact field that only saved on blur
   would silently lose what somebody just typed when they clicked elsewhere. */
$('main').addEventListener('keydown', async e=>{
  const box=e.target.closest('[data-contact]'); if(!box) return;
  const [id,field]=box.dataset.contact.split('|');
  if(e.key==='Escape'){ delete edits[`c|${id}|${field}`]; return render(); }
  if(e.key!=='Enter') return;
  const value=box.value.trim();
  const { error }=await setStaffContact(id, field, value);
  if(error) return flash(error.message);
  const p=D.staff.find(x=>x.id===id); if(p) p[field]=value||null;
  delete edits[`c|${id}|${field}`];
  flash(value?`Saved ${field} for ${p?p.name:'them'}.`:`Cleared their ${field}.`);
  render();
});

$('main').addEventListener('change',e=>{
  if(e.target.id==='psel'){ periodId=e.target.value; sel=-1; render(); }
});

$('main').addEventListener('input',e=>{
  /* The availability-request fields are not pending edits — they are the
     arguments to one button. Keeping them out of `edits` stops the Save bar
     appearing for something Save does not save. */
  const ar=e.target.dataset.ar;
  if(ar){ edits['ar|'+ar]=ar==='cap'?Math.max(0,Number(e.target.value||0)):e.target.value; return; }
  const sh=e.target.dataset.sh; if(sh){ edits['sh|'+sh]=Number(e.target.value||0); render(); return; }
  const rp=e.target.dataset.rpa; if(rp){ edits['rpa|'+rp]=Number(e.target.value||0); $('bar').classList.add('on'); return; }
  const rs=e.target.dataset.res; if(rs){ edits['res|'+rs]=e.target.value; render(); return; }
  const k=e.target.dataset.k; if(!k) return;
  edits[k]=Number(e.target.value||0); $('bar').classList.add('on');
  $('status').textContent=`${Object.keys(edits).length} change(s)`; });

$('save').addEventListener('click',async()=>{
  $('save').disabled=true; $('status').textContent='Saving…';
  const fails=[];
  for(const [k,v] of Object.entries(edits)){
    if(!k.startsWith('av|')) continue;
    const [sid,dow,part]=k.slice(3).split('|');
    const { error }=await saveAvailability(sid,+dow,part,v);
    if(error) fails.push(error.message);
  }
  for(const [k,v] of Object.entries(edits)){
    if(!k.startsWith('cp|')) continue;
    const [,session_id,staff_id,section]=k.split('|');
    const { error }=await saveCallerPosition(session_id,staff_id,+section,v);
    if(error) fails.push(error.message);
  }
  for(const [k,needed] of Object.entries(edits)){
    if(k.startsWith('av|')||k.startsWith('sh|')||k.startsWith('res|')||k.startsWith('rpa|')
       ||k.startsWith('ui|')||k.startsWith('cp|')||k.startsWith('fwd|')) continue;
    const [h,role_id,dow,part]=k.split('|');
    const { error }=await saveHallRoleNeed(h,role_id,dow,part,needed);
    if(error) fails.push(error.message);
  }
  $('save').disabled=false; edits={};
  if(fails.length){ $('status').textContent='Failed: '+fails[0]; return; }
  await loadAll(); $('status').textContent='Saved.';
  setTimeout(()=>{ if($('status').textContent==='Saved.') $('status').textContent=''; },2500);
});
$('revert').addEventListener('click',()=>{ edits={}; render(); });

$('main').addEventListener('click',async e=>{
  if(e.target.id==='addday'){
    const dow=+$('ndow').value, part=$('npart').value, h=$('nhall').value;
    const { error }=await addHallDay(h,dow,part);
    if(error){ $('status').textContent=error.message; return; }
    await loadAll(); return;
  }
  if(e.target.id==='onlyhours'){ edits['ui|onlyWithHours']=e.target.checked; render(); return; }
  if(e.target.id==='xlsx'){ exportHours(); return; }

  const pd=e.target.closest('[data-period]');
  if(pd){ edits['ui|period']=Number(pd.dataset.period); render(); return; }

  const sl=e.target.closest('[data-slot]');
  if(sl){
    const [sid,rid,dir]=sl.dataset.slot.split('|');
    const s=D.sessions.find(x=>x.id===sid);
    const template=needFor(rid,dowOf(s),s.part,s.hall_id) ?? 0;
    const cur=D.sessionRoles.find(x=>x.session_id===sid&&x.role_id===rid)?.needed ?? template;
    const filled=D.assigns.filter(a=>a.session_id===sid&&a.role_id===rid&&a.staff_id).length;
    const next=dir==='+'?cur+1:Math.max(filled, cur-1);
    const { error }=await setSessionRoleCount(sid,rid,next);
    if(error){ $('status').textContent=error.message; return; }
    await loadAll(); return;
  }

  /* ---- contact details, edited where the gap is ---- */
  const ec=e.target.closest('[data-editc]');
  if(ec){
    e.preventDefault();
    const [id,field]=ec.dataset.editc.split('|');
    const p=D.staff.find(x=>x.id===id);
    edits[`c|${id}|${field}`]=p?.[field]||'';
    render();
    const box=$('main').querySelector(`[data-contact="${id}|${field}"]`);
    if(box){ box.focus(); box.select(); }
    return;
  }

  /* Sending is deliberate and separate from whatever queued the message. */
  if(e.target.id==='mcheck'||e.target.id==='msend'){
    const send=e.target.id==='msend';
    if(send){
      const n=msgCounts().queued;
      if(!confirm(`Send ${n} message${n===1?'':'s'} now?\n\nThis reaches real people.`)) return;
    }
    e.target.disabled=true;
    const { data, error }=await drainOutbox(send);
    e.target.disabled=false;
    if(error) return flash(error.message||'Could not reach the sender.');
    await loadOutbox_();
    flash(data?.dryRun
      ? `${data.pending} waiting: ${Object.entries(data.byChannel||{})
          .map(([k,v])=>`${v} by ${k}`).join(', ')||'none'}.`
      : `Sent ${data?.sent||0}${data?.failed?`, ${data.failed} failed`:''}${
          data?.skipped?`, ${data.skipped} texts still waiting on credentials`:''}.`);
    return render();
  }

  if(e.target.id==='markseen'){
    await markAttentionSeen(); await loadAttention_(); flash('Cleared.'); return render();
  }
  const gt=e.target.closest('[data-goto]');
  if(gt){
    /* Jump to the night in question rather than making her find it. */
    const i=D.sessions.findIndex(x=>x.session_date===gt.dataset.goto);
    if(i>=0){ sel=i; view='week';
      const p=(D.periods||[]).find(x=>gt.dataset.goto>=x.starts_on&&gt.dataset.goto<=x.ends_on);
      if(p) periodId=p.id;
      return render(); }
    flash('That night is not in the schedule any more.'); return;
  }
  if(e.target.closest('[data-goto-avail]')){ view='avail'; await loadAvailStatus(); return render(); }

  if(e.target.id==='fillclear'){ D.fillReport=null; return render(); }

  /* ---- building a fortnight faster ---- */
  if(e.target.id==='pcopy'||e.target.id==='pfill'||e.target.id==='pclear'){
    const cur=currentPeriod(); if(!cur) return;
    if(cur.status==='published' &&
       !confirm('This fortnight is already published and people have been told. Change it anyway?'))
      return;

    const inCur=x=>x.session_date>=cur.starts_on&&x.session_date<=cur.ends_on;
    const target=D.sessions.filter(inCur);

    if(e.target.id==='pclear'){
      const n=D.assigns.filter(a=>a.staff_id&&target.some(s=>s.id===a.session_id)).length;
      if(!n) return flash('Nothing to clear.');
      if(!confirm(`Empty ${n} filled slot${n===1?'':'s'} in this fortnight? The crew template is untouched.`)) return;
      let bad=0;
      for(const a of D.assigns.filter(a=>a.staff_id&&target.some(s=>s.id===a.session_id))){
        const { error }=await saveAssignment(a.session_id,a.role_id,a.slot_index,null);
        if(error) bad++;
      }
      await loadAll(); return flash(bad?`Cleared, ${bad} failed.`:`Cleared ${n}.`);
    }

    /* Everything the pure planners need, passed in rather than reached for,
       so they stay testable without a database. */
    const load={};
    for(const a of D.assigns) if(a.staff_id&&target.some(s=>s.id===a.session_id))
      load[a.staff_id]=(load[a.staff_id]||0)+1;
    const ctx={ staff:D.staff, assigns:D.assigns, canDo, isAvailable, dowOf, load };

    let out;
    if(e.target.id==='pcopy'){
      const from=D.sessions.filter(x=>x.session_date>=prevStart(cur)&&x.session_date<cur.starts_on);
      if(!from.length) return flash('There is no previous fortnight to copy from.');
      out=proposeCopy(ctx, from, target);
    }else{
      out=proposeFill(ctx, target, emptySlotsIn(target));
    }

    if(!out.place.length){
      return flash(out.skipped.length
        ? `Nothing could be placed. ${out.skipped.length} blocked — see the report.`
        : 'Every slot is already filled.');
    }
    let bad=0;
    for(const p of out.place){
      const { error }=await saveAssignment(p.session_id,p.role_id,p.slot_index,p.staff_id);
      if(error) bad++;
    }
    await loadAll();
    /* Say what was NOT done. A silent partial fill reads as a complete one. */
    D.fillReport=out.skipped;
    flash(`Placed ${out.place.length-bad}${bad?`, ${bad} failed`:''}${
      out.skipped.length?`. ${out.skipped.length} could not be placed — see below.`:'.'}`);
    return render();
  }

  /* ---- schedule periods ---- */
  if(e.target.id==='pstartgo'){
    const d=$('main').querySelector('#pstart')?.value;
    if(!d) return flash('Pick a day first.');
    /* Say something NOW. The RPC creates 14 days of sessions and can take a
       few seconds; a silent button reads as a broken one. */
    flash('Creating the fortnight…', 10000);
    const { data, error }=await startPeriodOn(d);
    if(error||!data?.ok) return flash(error?.message||data?.error||'Could not create it.', 6000);
    periodId=data.id;
    await loadPeriods_(); await loadAll();
    flash(`Fortnight ready — ${data.sessions} sessions, ${data.starts_on} to ${data.ends_on}.`, 6000);
    return render();
  }
  if(e.target.id==='pnew'){ 
    const { error }=await ensurePeriod(null);
    if(error) return flash(error.message);
    await loadPeriods_(); return render();
  }
  if(e.target.id==='pprev') return stepPeriod(-14);
  if(e.target.id==='pnext') return stepPeriod(14);
  if(e.target.id==='ppub'){
    const cur=currentPeriod(); if(!cur) return;
    const n=D.assigns.filter(a=>a.staff_id&&D.sessions.some(s=>s.id===a.session_id
      &&s.session_date>=cur.starts_on&&s.session_date<=cur.ends_on)).length;
    /* Publishing is what tells people. It is the one irreversible-feeling
       action in the app, so it asks first and says how many it will reach. */
    if(!confirm(`Publish this fortnight and tell everybody on it?\n\n`
      +`${n} shift${n===1?'':'s'} are assigned. Messages are queued, not sent — `
      +`you send them from the Messages tab.`)) return;
    const { data, error }=await publishPeriod(cur.id);
    if(error) return flash(error.message);
    if(data?.already) { await loadPeriods_(); return flash('Already published — nobody was messaged again.'); }
    await loadPeriods_(); await loadAttention_();
    flash(`Published. ${data.told} queued${data.unreachable?`, ${data.unreachable} unreachable`:''}.`);
    return render();
  }
  /* Text everybody the schedule. Two presses on purpose: the first arms the
     button and shows exactly how many phones it will reach, the second sends.
     One press that texts sixty people is a pocket-dial away from an incident. */
  if(e.target.id==='pblast'){
    const cur=currentPeriod(); if(!cur) return;
    if(!edits['ui|blastarm']){ edits['ui|blastarm']=true; delete edits['ui|blastmsg']; return render(); }
    delete edits['ui|blastarm'];
    const { data, error }=await scheduleBlast(cur.id, edits['ui|blastu']===true);
    if(error){ edits['ui|blastmsg']=error.message; return render(); }
    edits['ui|blastmsg']=`Texted ${data.texted} ${data.texted===1?'person':'people'} their ${data.dates} link`
      +(data.no_phone?.length?` — no number for ${data.no_phone.join(', ')}`:'');
    return render();
  }
  if(e.target.id==='pblastx'){ delete edits['ui|blastarm']; return render(); }

  if(e.target.id==='punpub'){
    const cur=currentPeriod(); if(!cur) return;
    const { error }=await setPeriod(cur.id,{status:'draft'});
    if(error) return flash(error.message);
    await loadPeriods_(); flash('Back to draft. Nobody was told.');
    return render();
  }

  /* ---- the fortnightly availability request ---- */
  if(e.target.id==='arcreate'){
    const start=edits['ar|start']||$('main').querySelector('[data-ar="start"]')?.value;
    const end  =edits['ar|end']  ||$('main').querySelector('[data-ar="end"]')?.value;
    const cap  =edits['ar|cap'] ?? 2;
    const note =edits['ar|note']||'';
    if(!start||!end) return flash('Pick a start and an end date.');
    const { data, error }=await createAvailabilityRequest(start,end,cap,note);
    if(error) return flash(error.message);
    if(!data?.ok) return flash(data?.error||'Could not create that request.');
    for(const k of Object.keys(edits)) if(k.startsWith('ar|')) delete edits[k];
    await loadAvailStatus();
    flash(`Asked ${data.asked} people about ${data.sessions} sessions.`);
    return render();
  }
  if(e.target.id==='arrefresh'){ await loadAvailStatus(); flash('Refreshed.'); return render(); }

  const arok=e.target.closest('[data-arok]');
  if(arok){
    const { error }=await reviewAvailability(D.availStatus.request.id, arok.dataset.arok);
    if(error) return flash(error.message);
    await loadAvailStatus(); return render();
  }

  const cp=e.target.closest('[data-arcopy]');
  if(cp){
    /* Built from wherever this page is sitting. Opened by double-clicking a
       file, that yields a file:// link that works on this computer and nowhere
       else — which is worth saying out loud rather than letting somebody text
       it to a runner and wonder why it died. */
    const url=location.href.replace(/[^/]*$/,'me.html')+'?t='+encodeURIComponent(cp.dataset.arcopy);
    try{ await navigator.clipboard.writeText(url); }
    catch{ return flash('Could not copy — the link is: '+url); }
    flash(location.protocol==='file:'
      ? 'Copied. Note this is a file link — it only opens on this computer until the page is hosted.'
      : 'Link copied.');
    return;
  }

  const al=e.target.closest('[data-alloc]');
  if(al){ allocSel=+al.dataset.alloc; openModal(renderAllocate()); return; }
  if(e.target.id==='closealloc'||e.target.classList.contains('modal-back')){ closeModal(); return; }

  const sv=e.target.closest('[data-saveres]');
  if(sv){
    const id=sv.dataset.saveres, patch={};
    for(const [k,v] of Object.entries(edits)){
      if(!k.startsWith(`res|${id}|`)) continue;
      patch[k.split('|')[2]] = v===''?null:Number(v);
    }
    if(Object.keys(patch).length){
      const { error }=await saveSessionResults(id,patch);
      if(error){ $('status').textContent=error.message; return; }
      /* "from now on" moves the hall default as well, so every later session of
         this weekday and part inherits the new target instead of Rachel having
         to retype it. The session she is looking at is set either way. */
      if(edits[`fwd|${id}`] && patch.target_rpa!=null){
        const s2=D.sessions.find(x=>x.id===id);
        const { error:e2 }=await saveRpaTarget(s2.hall_id, dowOf(s2), s2.part, patch.target_rpa);
        if(e2){ $('status').textContent=e2.message; return; }
        flash(`Target ${patch.target_rpa} saved, and set as the default for ${
          DOW[dowOf(s2)]} ${s2.part} at ${HALLNAME[s2.hall_id]}.`, 4000);
      }
      delete edits[`fwd|${id}`];
      for(const k of Object.keys(edits)) if(k.startsWith(`res|${id}|`)) delete edits[k];
      await loadAll(); $('status').textContent='Saved.';
    }
    return;
  }
  if(e.target.id==='saveres'){
    const s=D.sessions[sel]; const patch={};
    for(const [k,v] of Object.entries(edits)) if(k.startsWith('res|')) patch[k.slice(4)]=v===''?null:Number(v);
    if(Object.keys(patch).length){
      const { error }=await saveSessionResults(s.id,patch);
      if(error){ $('status').textContent=error.message; return; }
    }
    edits={}; await loadAll(); return;
  }
  if(e.target.id==='confirmcomm'){
    const s=D.sessions[sel], pool=poolFor(s);
    if(!pool){ $('status').textContent='No pool to distribute.'; return; }
    const roster=D.assigns.filter(a=>a.session_id===s.id&&a.staff_id);
    const rows=roster.map(a=>({staff_id:a.staff_id,
      shares:Number(shareEdit(s.id,a.staff_id,D.shares.find(x=>x.session_id===s.id&&x.staff_id===a.staff_id)))}))
      .filter(r=>r.shares>0);
    const total=rows.reduce((n,r)=>n+r.shares,0);
    if(!total){ $('status').textContent='No shares assigned.'; return; }
    if(!confirm(`Confirm ${'$'}${pool.toFixed(2)} across ${rows.length} people? Shares are frozen after this.`)) return;
    const { error }=await confirmCommission(s,rows,total,pool);
    if(error){ $('status').textContent=error.message; return; }
    edits={}; await loadAll(); $('status').textContent='Payout confirmed.'; return;
  }
  const del=e.target.dataset.del;
  if(del){
    const [dh,dow,part]=del.split('|');
    if(!confirm('Remove this session from the template? Assignments already made are not affected.')) return;
    await removeHallDay(dh,dow,part);
    await loadAll();
  }
});

$('signin').addEventListener('click',async()=>{
  const { error }=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('pw').value});
  if(error){ $('loginerr').textContent=error.message; return; } boot(); });
$('pw').addEventListener('keydown',e=>{ if(e.key==='Enter') $('signin').click(); });
$('signout').addEventListener('click',async()=>{ await sb.auth.signOut(); location.reload(); });

/* Entry point. Shows the login until there is a session, then loads. */
async function boot(){
  const { data:{ session } }=await sb.auth.getSession();
  if(!session){ $('login').hidden=false; $('shell').hidden=true; return; }
  $('login').hidden=true; $('shell').hidden=false;
  $('who').textContent=session.user.email;
  await loadPeriods_();
  await loadAll();
  await loadAttention_();
}
boot();


/* ---------------- CSV exports ---------------- */

/* Summary: one row per person, matching the Staff hours table.
   Detail: one row per person per session, so every day can be checked
   individually — which is the point of an HR export. */
/* One workbook, two sheets: the summary you check on screen, and every
   session behind it so HR compliance can be verified line by line. Both are
   built from the rows already rendered, so the file cannot disagree with the
   page it came from. */
function exportHours(){
  const X = window.__hoursExport;
  if(!X){ flash('Open Staff hours first.', 3000); return; }
  const { period:P, rows } = X;
  const inP = d => d>=P.start && d<=P.end;

  const summary = {
    name: 'Summary',
    headers: ['Person','Shifts','Scheduled hours','Clocked regular','Clocked 1.5x','Clocked 2x',
              'Clocked total','Commission','Rate adjustment per hour','Estimated OT adjustment'],
    rows: rows.map(r=>[
      r.s.name, r.sch.shifts, +r.sch.hours.toFixed(2),
      +r.clk.regular.toFixed(2), +r.clk.ot1_5.toFixed(2), +r.clk.ot2_0.toFixed(2),
      +r.clk.total.toFixed(2), +r.comm.toFixed(2), +r.rateAdj.toFixed(4), +r.otAdj.toFixed(2)]),
  };

  const detailRows=[];
  for(const r of rows){
    const byDate={};
    for(const t of D.time.filter(t=>t.staff_id===r.s.id && inP(t.work_date))){
      const hrs=Number(t.hours_worked||0);
      byDate[t.work_date]={date:t.work_date, clocked:hrs, sched:'', hall:'', part:'', role:'',
        chk:checkDay({hours:hrs, mealTaken:t.meal_taken, mealWaived:t.meal_waived,
          secondMealTaken:t.second_meal_taken, secondMealWaived:t.second_meal_waived,
          restsTaken:t.rest_breaks_taken}),
        ot:dailyOvertime(hrs), cat:t.category};
    }
    for(const a2 of D.assigns.filter(x=>x.staff_id===r.s.id)){
      const s=D.sessions.find(x=>x.id===a2.session_id);
      if(!s||!inP(s.session_date)) continue;
      const st=a2.scheduled_start||timeForRaw(a2.role_id,dowOf(s),s.part,s.hall_id);
      const en=a2.scheduled_end;
      const sh=(st&&en)?shiftHours(st.slice(0,5),en.slice(0,5)):null;
      const e = byDate[s.session_date] ||= {date:s.session_date, clocked:'', sched:'', chk:null, ot:null, cat:''};
      e.sched = sh==null?'':+sh.toFixed(2);
      e.hall = s.hall_id.toUpperCase(); e.part = s.part;
      e.role = D.roles.find(x=>x.id===a2.role_id)?.name || '';
      if(!e.chk && sh) e.chk = checkDay({hours:sh, restsTaken:0});
    }
    for(const e of Object.values(byDate).sort((x,y)=>x.date.localeCompare(y.date))){
      detailRows.push([
        r.s.name, e.date, e.hall||'', e.part||'', e.role||'',
        e.clocked===''?'':+Number(e.clocked).toFixed(2),
        e.sched===''?'':e.sched,
        e.cat||'',
        e.chk?e.chk.mealsRequired:'', e.chk?e.chk.restsRequired:'', e.chk?e.chk.restsTaken:'',
        e.chk? (e.clocked===''?'not clocked':(e.chk.ok?'compliant':'VIOLATION')) : '',
        e.chk&&e.clocked!==''?e.chk.problems.join('; '):'',
        e.ot&&e.clocked!==''?+e.ot.regular.toFixed(2):'',
        e.ot&&e.clocked!==''?+e.ot.ot1_5.toFixed(2):'',
        e.ot&&e.clocked!==''?+e.ot.ot2_0.toFixed(2):'',
        e.chk&&e.clocked!==''?e.chk.premiumHours:'',
      ]);
    }
  }

  const detail = {
    name: 'Session detail',
    headers: ['Person','Date','Hall','Session','Role','Clocked hours','Scheduled hours','Category',
              '30-min meals required','10-min rests required','Rests taken','Break compliance',
              'Break problems','Daily regular','Daily 1.5x','Daily 2x','Premium hours owed'],
    rows: detailRows,
  };

  try {
    downloadWorkbook(`staff-hours_${P.start}_to_${P.end}.xlsx`, [summary, detail]);
    flash(`Exported ${rows.length} people and ${detailRows.length} sessions`, 3000);
  } catch (err) {
    flash(err.message, 6000);
  }
}
