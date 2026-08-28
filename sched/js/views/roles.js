/* The shared job-role catalogue. */
function viewRoles(){
  return `<h2>Job roles — shared across both halls</h2><div class="panel">`+
    D.roles.map(r=>{
      const fixed=r.fixed_count, floor=r.min_on_floor;
      // A single-person role is just that: one on shift. It carries no break
      // commentary, because there is nothing to say — cover is a question for
      // roles that have more than one body in them.
      const desc = fixed===null
        ? 'headcount set per session'
        : `${fixed} on shift`;
      // The only thing still worth surfacing is a genuine contradiction:
      // requiring more people on the floor than are ever rostered.
      const broken = fixed!==null && fixed>1 && floor>fixed;
      return `<div class="rolerow">
        <div><div class="rolename">${esc(r.name)}</div></div>
        <div><span class="rtime">${desc}</span>
        ${broken?`<div class="note stop">Impossible: ${floor} must stay on the floor but only ${fixed} are rostered.</div>`:''}
        </div></div>`;
    }).join('')+`</div>
    <div class="note warn" style="margin-top:12px">Role names are shared between halls, so a person's
    capability means the same thing at either site. How many of each a session needs is per hall and
    per day — see <strong>Sessions &amp; crew</strong>.</div>`;
}