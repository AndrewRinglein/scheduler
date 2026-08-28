/* Config, shared helpers, and app state.
   Everything here is used by more than one view, which is the only reason it
   is here rather than in the view that needs it. */

const SUPABASE_URL='https://lkcfbgnuodqzvowschjn.supabase.co';
const SUPABASE_KEY='sb_publishable_t3vO3q1Y7PRH3qVp_64dfg_L4Zr1fIT';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

let view='week', hall='sc', sel=0, edits={}, person=null, allocSel=null;
/* The fortnight currently being looked at. Rachel builds two weeks as one
   bundle, so the schedule screen shows exactly one period at a time rather
   than an endless run of cards. null means "whichever contains today". */
let periodId=null;
let D={roles:[],times:[],needs:[],days:[],staff:[],caps:[],time:[],rpa:[],shares:[],payouts:[],avail:[],sessionRoles:[],sessions:[],assigns:[],calling:{},periods:[],declines:[],unclosed:null};

/* Today, as an ISO date in local time — not UTC, which would roll the day
   over at 5pm here and hide tonight's session. */
function todayISO(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* The schedule shows today forward. Past sessions stay in the database and
   remain visible in Commission, where the history is the point. */
const isUpcoming = s => s.session_date >= todayISO();
function firstUpcomingIndex(){
  const i = D.sessions.findIndex(isUpcoming);
  return i === -1 ? Math.max(0, D.sessions.length - 1) : i;
}

/* Are there unsaved edits?

   `ui|` keys are screen state -- show past, show inactive -- parked in `edits`
   because that is what render() already reads. The save loop skips them, so
   counting them here lit the "unsaved changes" bar and claimed "1 change(s)"
   for ticking a checkbox that changes nothing. */
const isUiKey = k => k.startsWith('ui|');
const dirty=()=>Object.keys(edits).some(k=>!isUiKey(k));

/* Derived lookups. Views call these; none of them touch the network. */

const label=s=>{const d=new Date(s.session_date+'T12:00:00');
  return `${DOW[d.getDay()]} ${d.getMonth()+1}/${d.getDate()}`+(s.part!=='single'?` ${s.part}`:'');};
const forSession=s=>D.assigns.filter(a=>a.session_id===s.id);
const dowOf=s=>new Date(s.session_date+'T12:00:00').getDay();
const timeForRaw=(rid,dw,pt,h)=>{const t=D.times.find(x=>x.hall_id===h&&x.role_id===rid&&x.dow===dw&&x.part===pt);return t?t.start_time:null;};
const timeFor=(rid,dw,pt,h)=>{const t=D.times.find(x=>x.hall_id===h&&x.role_id===rid&&x.dow===dw&&x.part===pt);return t?t.start_time.slice(0,5):null;};
const needFor=(rid,dw,pt,h)=>D.needs.find(x=>x.hall_id===h&&x.role_id===rid&&x.dow===dw&&x.part===pt)?.needed ?? null;

/* True when the start/end for this role was guessed to make it schedulable
   rather than supplied by the hall. Shown as a "?" so a placeholder is never
   mistaken for a confirmed time — these drive break deadlines and paid hours. */
const isPlaceholderTime=(rid,dw,pt,h)=>
  !!D.times.find(x=>x.hall_id===h&&x.role_id===rid&&x.dow===dw&&x.part===pt)?.is_placeholder;

/* "Callers/Strip" -> "caller", "MOD" -> "MOD". Acronyms keep their case;
   everything else reads as the one person you are about to add. */
function addLabel(name){
  const first=String(name).split('/')[0].trim();
  if(/^[A-Z0-9]+$/.test(first)) return first;          // MOD, and any future acronym
  return first.replace(/s$/,'').toLowerCase();
}

/* ---------------- views ---------------- */

/* Default share: one each, matching how it has actually been done.
   1,300 of the 1,372 historical share rows are exactly 1.0. The exceptions are
   partial shares — 0.5 mostly, presumably part-shifts — never a double share.
   Adjustable per person; this is only the starting point. */
function defaultShares(){ return 1.0; }
const HALLNAME={sc:'Santa Clara', rwc:'Redwood City'};

/* A person's assigned character, shown beside their name.
   The sprite art is not uploaded yet, so this renders a named chip; it will
   swap to an <img> once the library is in storage, and no call site changes. */
/* The characters live next to the pages in sched/art/. Relative, not absolute,
   because these pages are opened by double-clicking a file — an http URL would
   work in a browser and nowhere else. 40 cats, 20 dogs, 6 monsters; a "-d"
   suffix distinguishes the dog from the cat of the same name (biscuit the cat,
   biscuit-d the dog) and is stripped for display. */
const PET_ART_BASE = 'art';
/* Where a character's art lives. pets/ is the original cats-and-dogs library,
   monsters/ the managers' creatures, chars/ everything added since -- heroes,
   critters, robots, snacks and the smaller monsters. */
const PET_KIND_DIR = { boss: 'monsters',
  hero: 'chars', critter: 'chars', robot: 'chars', snack: 'chars', monster: 'chars' };
function petSrc(pet, kind, pose){
  const key = `${PET_KIND_DIR[kind] || 'pets'}/${pet}-${pose || 'sit'}`;
  /* Prefer the embedded copy. A relative path only resolves when the page was
     loaded from a real file:// or http:// context with the art sitting beside
     it — and these pages get opened in ways where it does not, which shows up
     as every character being a broken image with nothing in the console. The
     data URL cannot fail that way. The path stays as a fallback so the pages
     still work if the art is ever served properly. */
  if (typeof ART === 'object' && ART && ART[key]) return ART[key];
  return `${PET_ART_BASE}/${key}.png`;
}
/* biscuit-d is still "biscuit" to the person who owns it. */
function petName(pet){ return String(pet || '').replace(/-d$/, ''); }

/* Role names are stored the way they head a column -- "Flash Runners",
   "Callers/Strip" -- because that is where they are mostly read. Against ONE
   person's name they have to be singular, or the board says Nancy is a Flash
   Runners. Each slash-separated part is singularised on its last word:
   "Flash Runners" -> "Flash Runner", "Callers/Strip" -> "Caller/Strip",
   "MOD" and "Paymaster" untouched. */
function roleOne(name){
  return String(name || '').split('/').map(part => {
    const words = part.split(' ');
    const last = words[words.length - 1];
    if (/[^s]s$/.test(last) && last.length > 3) words[words.length - 1] = last.slice(0, -1);
    return words.join(' ');
  }).join('/');
}

function petChip(staffId){
  const p = D.staff.find(x => x.id === staffId);
  if (!p || !p.pet) return '<span class="pet-none" title="No character chosen yet">?</span>';
  /* NO loading="lazy". These pages are opened by double-clicking a file, and a
     lazily-loaded image on a file:// page is never fetched at all — the browser
     does not even attempt the request, so every character silently renders as a
     broken image. Verified in Chromium: 0 of 5 load with it, 5 of 5 without. */
  return `<img class="pet${p.pet_kind==='boss'?' boss':''}"
    src="${esc(petSrc(p.pet, p.pet_kind))}" alt="${esc(petName(p.pet))}"
    title="${esc(petName(p.pet))}">`;
}

/* The standard way to render a person: character then name. */
function personLabel(staffId, name){
  return `${petChip(staffId)}<span>${esc(name ?? '')}</span>`;
}

/* Manager of Record.

   These three roles can carry more than one person on a session, and "how did
   the MOD do" has no answer when two names sit in the role. The one in the top
   slot is the one the session is judged against. It is DERIVED from slot order
   rather than stored beside it, so it cannot disagree with the schedule. */
const MOR_ROLES = ['MOD', 'Paymaster', 'Flash Manager'];
const isMorRole = roleId => MOR_ROLES.includes(D.roles.find(r => r.id === roleId)?.name);

/* The lowest filled slot held by somebody who is NOT training.

   Not slot 0: emptying the top chair must promote the person below rather than
   leave the session with no manager of record. And not a trainee: the flag
   names who the session is judged against, and somebody learning the job
   cannot be that. Where a trainee is the only person in the role the answer is
   NOBODY — an honest gap the manager can see, rather than a name that would
   quietly carry the session's numbers. */
/* All four manager desks. Somebody who is MOD and Opener is genuinely split
   even though Opener itself keeps no manager of record, so Opener counts when
   working out who is wearing two hats. */
const MGR_DESKS = ['MOD', 'Paymaster', 'Flash Manager', 'Opener/Swing Shift'];
function mgrHats(sessionId, staffId){
  return D.assigns.filter(a => a.session_id === sessionId && a.staff_id === staffId
    && MGR_DESKS.includes(D.roles.find(r => r.id === a.role_id)?.name)).length;
}

function morSlot(sessionId, roleId){
  const eligible = D.assigns.filter(a =>
    a.session_id === sessionId && a.role_id === roleId && a.staff_id && !a.is_training);
  if (!eligible.length) return null;
  /* Fewest hats first, then the top slot. Two people in a role and one of them
     is also covering another desk: the undivided one holds the record. */
  eligible.sort((a, b) =>
    mgrHats(sessionId, a.staff_id) - mgrHats(sessionId, b.staff_id)
    || a.slot_index - b.slot_index);
  return eligible[0].slot_index;
}
const isMor = (sessionId, roleId, slot) =>
  isMorRole(roleId) && morSlot(sessionId, roleId) === slot;

/* Everyone can do Flash Runners; it is never stored as a capability row.
   Any other role has to be added to a person explicitly. */
const UNIVERSAL_ROLE='Flash Runners';
function isUniversal(roleId){
  return D.roles.find(r=>r.id===roleId)?.name===UNIVERSAL_ROLE;
}
function canDo(staffId, roleId){
  if(isUniversal(roleId)) return true;
  const c=D.caps.find(x=>x.staff_id===staffId&&x.role_id===roleId);
  return !!c && (c.can_do||c.is_deputy);
}
function extraRoles(staffId){
  return D.caps.filter(c=>c.staff_id===staffId&&(c.can_do||c.is_deputy))
    .map(c=>D.roles.find(r=>r.id===c.role_id)).filter(Boolean)
    .sort((a,b)=>a.sort-b.sort);
}
