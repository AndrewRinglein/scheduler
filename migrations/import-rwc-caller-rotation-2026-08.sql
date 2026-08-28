-- RWC caller rotation, 11-13 and 18-20 August 2026.
-- From the two "Calling Schedule" tabs of Angela's spreadsheet.
--
-- Two translations, both deliberate:
--
--   "Cart" is her word for the strips cart; the column already stores that
--   duty as "Strips/Support", which is what the app labels and validates, so
--   the import uses the stored name rather than adding a synonym nobody else
--   understands.
--
--   Her sheet writes a mid-section handover with a slash -- "Calling/Verifying"
--   means this person starts the section on the mic and finishes verifying,
--   while somebody else comes the other way. That cannot be stored with a
--   slash, because "Strips/Support" already contains one and "Calling/Cart"
--   would come out as "Calling/Strips/Support" and read as three duties. An
--   arrow says it unambiguously, and caller-rotation.js now validates a
--   section at its start AND its end rather than treating the whole string as
--   one duty -- which used to report "0 callers" for the middle section of
--   every single RWC night.
--
-- One typo in the source is corrected: "Veirfying" on 20 August.

begin;

delete from public.sched_caller_positions cp
using public.sched_sessions s
where s.id = cp.session_id and s.hall_id = 'rwc'
  and s.session_date between date '2026-08-11' and date '2026-08-20';

insert into public.sched_caller_positions (session_id, staff_id, section, position)
select s.id, p.id, v.section, v.pos
from (values
    ('2026-08-11','Cody',1,'Calling'),
    ('2026-08-11','Cody',2,'Calling → Verifying'),
    ('2026-08-11','Cody',3,'Verifying'),
    ('2026-08-11','Kaylyn',1,'Strips/Support'),
    ('2026-08-11','Kaylyn',2,'Verifying → Calling'),
    ('2026-08-11','Kaylyn',3,'Calling'),
    ('2026-08-11','Paula',1,'Verifying'),
    ('2026-08-11','Paula',2,'Strips/Support'),
    ('2026-08-11','Paula',3,'Strips/Support'),
    ('2026-08-12','Kaylyn',1,'Calling'),
    ('2026-08-12','Kaylyn',2,'Calling → Strips/Support'),
    ('2026-08-12','Kaylyn',3,'Strips/Support'),
    ('2026-08-12','Cody',1,'Verifying'),
    ('2026-08-12','Cody',2,'Strips/Support → Calling'),
    ('2026-08-12','Cody',3,'Calling'),
    ('2026-08-12','Paula',1,'Strips/Support'),
    ('2026-08-12','Paula',2,'Verifying'),
    ('2026-08-12','Paula',3,'Strips/Support'),
    ('2026-08-13','Cody',1,'Calling'),
    ('2026-08-13','Cody',2,'Calling → Verifying'),
    ('2026-08-13','Cody',3,'Strips/Support'),
    ('2026-08-13','Wayne',1,'Verifying'),
    ('2026-08-13','Wayne',2,'Verifying → Calling'),
    ('2026-08-13','Wayne',3,'Calling'),
    ('2026-08-13','Paula',1,'Strips/Support'),
    ('2026-08-13','Paula',2,'Strips/Support'),
    ('2026-08-13','Paula',3,'Verifying'),
    ('2026-08-18','Cody',1,'Calling'),
    ('2026-08-18','Cody',2,'Calling → Strips/Support'),
    ('2026-08-18','Cody',3,'Verifying'),
    ('2026-08-18','Kaylyn',1,'Verifying'),
    ('2026-08-18','Kaylyn',2,'Strips/Support → Calling'),
    ('2026-08-18','Kaylyn',3,'Calling'),
    ('2026-08-18','Paula',1,'Strips/Support'),
    ('2026-08-18','Paula',2,'Verifying'),
    ('2026-08-18','Paula',3,'Strips/Support'),
    ('2026-08-19','Kaylyn',1,'Calling'),
    ('2026-08-19','Kaylyn',2,'Calling → Verifying'),
    ('2026-08-19','Kaylyn',3,'Strips/Support'),
    ('2026-08-19','Cody',1,'Verifying'),
    ('2026-08-19','Cody',2,'Verifying → Calling'),
    ('2026-08-19','Cody',3,'Calling'),
    ('2026-08-19','Paula',1,'Strips/Support'),
    ('2026-08-19','Paula',2,'Strips/Support'),
    ('2026-08-19','Paula',3,'Verifying'),
    ('2026-08-20','Cody',1,'Calling'),
    ('2026-08-20','Cody',2,'Calling → Verifying'),
    ('2026-08-20','Cody',3,'Verifying'),
    ('2026-08-20','Wayne',1,'Strips/Support'),
    ('2026-08-20','Wayne',2,'Verifying → Calling'),
    ('2026-08-20','Wayne',3,'Calling'),
    ('2026-08-20','Paula',1,'Verifying'),
    ('2026-08-20','Paula',2,'Strips/Support'),
    ('2026-08-20','Paula',3,'Strips/Support')
) as v(d, nm, section, pos)
join public.sched_sessions s on s.hall_id = 'rwc' and s.session_date = v.d::date
join public.sched_staff   p on p.name = v.nm;

commit;
