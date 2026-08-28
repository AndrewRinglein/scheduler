-- RWC schedule, 11-13 and 18-20 August 2026, from Angela's spreadsheet
-- (RCV Schedule 8_11_26 - 8_20_26.xlsx). Her sheet is the source of truth;
-- what sat on 18-20 August came from the PTO availability guess and is
-- replaced wholesale.
--
-- Times are the sheet's own, not the template's: Paymaster and Flash Manager
-- 2pm-11pm, Callers and Flash Runners 3:15pm-11pm, Bingo Opener 1pm. The
-- asterisk in the sheet means an early start at 2pm for buy-ins, which sets
-- BOTH scheduled_start and the early_start flag -- the flag is what the wall
-- chart reads and the time is what payroll reads, and they have to agree.
-- The MOD row carries no time, so it keeps 2pm to midnight, matching every
-- other MOD row already in the table.
--
-- "Nicole" in the sheet is Nicole D., confirmed by Angela. Nicole S. is
-- inactive and was not who was meant.
--
-- Joining on name rather than pasting UUIDs is deliberate: a mistyped UUID
-- inserts silently against the wrong person, a mistyped name inserts nothing
-- at all and the row count gives it away.
--
-- DELETE and INSERT are two statements on purpose. Done as one CTE they race
-- on sched_assignments_session_id_role_id_slot_index_key, because a single
-- statement sees one snapshot: the insert cannot see the delete.

begin;

delete from public.sched_assignments a
using public.sched_sessions s
where s.id = a.session_id and s.hall_id = 'rwc'
  and s.session_date between date '2026-08-11' and date '2026-08-20';

insert into public.sched_assignments
  (session_id, role_id, staff_id, slot_index, scheduled_start, scheduled_end,
   early_start, response)
select s.id, r.id, p.id, v.slot, v.st::time, v.en::time, v.early, 'pending'
from (values
    ('2026-08-11','MOD','Shelly',0,'14:00','00:00',false),
    ('2026-08-12','MOD','Shelly',0,'14:00','00:00',false),
    ('2026-08-13','MOD','Shelly',0,'14:00','00:00',false),
    ('2026-08-18','MOD','Shelly',0,'14:00','00:00',false),
    ('2026-08-19','MOD','Shelly',0,'14:00','00:00',false),
    ('2026-08-20','MOD','Shelly',0,'14:00','00:00',false),
    ('2026-08-11','Opener/Swing Shift','Sammy',0,'13:00','00:00',false),
    ('2026-08-12','Opener/Swing Shift','Sammy',0,'13:00','00:00',false),
    ('2026-08-13','Opener/Swing Shift','Sammy',0,'13:00','00:00',false),
    ('2026-08-18','Opener/Swing Shift','Sammy',0,'13:00','00:00',false),
    ('2026-08-19','Opener/Swing Shift','Sammy',0,'13:00','00:00',false),
    ('2026-08-20','Opener/Swing Shift','Sammy',0,'13:00','00:00',false),
    ('2026-08-11','Paymaster','Wayne',0,'14:00','23:00',false),
    ('2026-08-12','Paymaster','Paolo',0,'14:00','23:00',false),
    ('2026-08-13','Paymaster','Paolo',0,'14:00','23:00',false),
    ('2026-08-18','Paymaster','Wayne',0,'14:00','23:00',false),
    ('2026-08-19','Paymaster','Paolo',0,'14:00','23:00',false),
    ('2026-08-20','Paymaster','Paolo',0,'14:00','23:00',false),
    ('2026-08-11','Flash Manager','Cindy',0,'14:00','23:00',false),
    ('2026-08-12','Flash Manager','Nicole D.',0,'14:00','23:00',false),
    ('2026-08-13','Flash Manager','Nicole D.',0,'14:00','23:00',false),
    ('2026-08-18','Flash Manager','Nicole D.',0,'14:00','23:00',false),
    ('2026-08-19','Flash Manager','Cindy',0,'14:00','23:00',false),
    ('2026-08-20','Flash Manager','Cindy',0,'14:00','23:00',false),
    ('2026-08-11','Callers/Strip','Cody',0,'14:00','23:00',true),
    ('2026-08-11','Callers/Strip','Kaylyn',1,'14:00','23:00',true),
    ('2026-08-11','Callers/Strip','Paula',2,'15:15','23:00',false),
    ('2026-08-12','Callers/Strip','Cody',0,'14:00','23:00',true),
    ('2026-08-12','Callers/Strip','Kaylyn',1,'14:00','23:00',true),
    ('2026-08-12','Callers/Strip','Paula',2,'15:15','23:00',false),
    ('2026-08-13','Callers/Strip','Cody',0,'15:15','23:00',false),
    ('2026-08-13','Callers/Strip','Wayne',1,'14:00','23:00',true),
    ('2026-08-13','Callers/Strip','Paula',2,'15:15','23:00',false),
    ('2026-08-18','Callers/Strip','Cody',0,'15:15','23:00',false),
    ('2026-08-18','Callers/Strip','Kaylyn',1,'14:00','23:00',true),
    ('2026-08-18','Callers/Strip','Paula',2,'15:15','23:00',false),
    ('2026-08-19','Callers/Strip','Cody',0,'15:15','23:00',false),
    ('2026-08-19','Callers/Strip','Kaylyn',1,'14:00','23:00',true),
    ('2026-08-19','Callers/Strip','Paula',2,'15:15','23:00',false),
    ('2026-08-20','Callers/Strip','Cody',0,'15:15','23:00',false),
    ('2026-08-20','Callers/Strip','Wayne',1,'14:00','23:00',true),
    ('2026-08-20','Callers/Strip','Paula',2,'15:15','23:00',false),
    ('2026-08-11','Flash Runners','Abygail',0,'14:00','23:00',true),
    ('2026-08-11','Flash Runners','Tibet',1,'15:15','23:00',false),
    ('2026-08-11','Flash Runners','Dante',2,'15:15','23:00',false),
    ('2026-08-11','Flash Runners','Jordy',3,'15:15','23:00',false),
    ('2026-08-11','Flash Runners','Alex',4,'15:15','23:00',false),
    ('2026-08-12','Flash Runners','Abygail',0,'14:00','23:00',true),
    ('2026-08-12','Flash Runners','Tibet',1,'15:15','23:00',false),
    ('2026-08-12','Flash Runners','Dante',2,'15:15','23:00',false),
    ('2026-08-12','Flash Runners','James G.',3,'15:15','23:00',false),
    ('2026-08-12','Flash Runners','Elena',4,'15:15','23:00',false),
    ('2026-08-13','Flash Runners','Abygail',0,'14:00','23:00',true),
    ('2026-08-13','Flash Runners','Tibet',1,'15:15','23:00',false),
    ('2026-08-13','Flash Runners','Cindy',2,'14:00','23:00',true),
    ('2026-08-13','Flash Runners','Alex',3,'15:15','23:00',false),
    ('2026-08-13','Flash Runners','Elena',4,'15:15','23:00',false),
    ('2026-08-18','Flash Runners','Abygail',0,'14:00','23:00',true),
    ('2026-08-18','Flash Runners','Tibet',1,'15:15','23:00',false),
    ('2026-08-18','Flash Runners','Giovanna',2,'15:15','23:00',false),
    ('2026-08-18','Flash Runners','Jordy',3,'15:15','23:00',false),
    ('2026-08-18','Flash Runners','Emma',4,'14:00','23:00',true),
    ('2026-08-19','Flash Runners','Abygail',0,'14:00','23:00',true),
    ('2026-08-19','Flash Runners','Nicole D.',1,'15:15','23:00',false),
    ('2026-08-19','Flash Runners','Giovanna',2,'15:15','23:00',false),
    ('2026-08-19','Flash Runners','James G.',3,'15:15','23:00',false),
    ('2026-08-19','Flash Runners','Emma',4,'14:00','23:00',true),
    ('2026-08-20','Flash Runners','Abygail',0,'14:00','23:00',true),
    ('2026-08-20','Flash Runners','Nicole D.',1,'15:15','23:00',false),
    ('2026-08-20','Flash Runners','Giovanna',2,'15:15','23:00',false),
    ('2026-08-20','Flash Runners','Alex',3,'15:15','23:00',false),
    ('2026-08-20','Flash Runners','Emma',4,'14:00','23:00',true)
) as v(d, role_name, nm, slot, st, en, early)
join public.sched_sessions s on s.hall_id = 'rwc' and s.session_date = v.d::date
join public.sched_roles   r on r.name = v.role_name
join public.sched_staff   p on p.name = v.nm;

insert into public.sched_staff_role_capability (staff_id, role_id, can_do)
select p.id, r.id, true
from (values
    ('Abygail','Flash Runners'),
    ('Alex','Flash Runners'),
    ('Cindy','Flash Manager'),
    ('Cindy','Flash Runners'),
    ('Cody','Callers/Strip'),
    ('Dante','Flash Runners'),
    ('Elena','Flash Runners'),
    ('Emma','Flash Runners'),
    ('Giovanna','Flash Runners'),
    ('James G.','Flash Runners'),
    ('Jordy','Flash Runners'),
    ('Kaylyn','Callers/Strip'),
    ('Nicole D.','Flash Manager'),
    ('Nicole D.','Flash Runners'),
    ('Paolo','Paymaster'),
    ('Paula','Callers/Strip'),
    ('Sammy','Opener/Swing Shift'),
    ('Shelly','MOD'),
    ('Tibet','Flash Runners'),
    ('Wayne','Callers/Strip'),
    ('Wayne','Paymaster')
) as v(nm, role_name)
join public.sched_staff p on p.name = v.nm
join public.sched_roles r on r.name = v.role_name
on conflict (staff_id, role_id) do update set can_do = true;

commit;
