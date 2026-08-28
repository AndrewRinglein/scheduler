-- 018 — reconcile staff against the August 2026 Employee List.
--
-- The list is 66 people, first and last name. Our sched_staff rows carry a
-- DISPLAY name only — first names, with an initial where two people share one
-- ('James C.', 'Michael S.'), which is how Rachel's spreadsheet named them and
-- how the schedule reads on screen. Rather than overwrite that with full names
-- and make every dropdown longer, this adds first_name/last_name alongside it.
-- Display stays short; identity becomes unambiguous; future list reconciliation
-- can match on a real key instead of guessing at nicknames.

begin;

alter table public.sched_staff add column if not exists first_name text;
alter table public.sched_staff add column if not exists last_name  text;
alter table public.sched_staff add column if not exists on_roster  boolean not null default false;

comment on column public.sched_staff.on_roster is
  'True when the person appears on the current employee list. Anyone false was kept for their history but deactivated.';

-- 51 matched by first name; email corroborates most of them.
update public.sched_staff s set first_name = v.f, last_name = v.l, on_roster = true
from (values
  ('Alex', 'Alex', 'Hurely'),
  ('Alonso', 'Alonso', 'Rojas'),
  ('Amanda', 'Amanda', 'Howard'),
  ('Andrea', 'Andrea', 'Marquez'),
  ('Cameron', 'Cameron', 'Manning'),
  ('Cindy', 'Cindy', 'Bejar'),
  ('Claudia', 'Claudia', 'Romero'),
  ('Cody', 'Cody', 'Fouche'),
  ('Dante', 'Dante', 'Orne'),
  ('Elena', 'Elena', 'Ballesteros'),
  ('Esteban', 'Esteban', 'Cisneros'),
  ('Esther', 'Esther', 'Orozco-Alvarez'),
  ('Ethan', 'Ethan', 'Lorenz'),
  ('Gaby', 'Gabriela', 'Arreola'),
  ('Gina', 'Gina', 'Costa'),
  ('Giovanna', 'Giovanna', 'Vargas'),
  ('Hector', 'Hector', 'Torres'),
  ('Ian', 'Ian', 'Dutra'),
  ('Iraina', 'Iraina', 'Sheffie'),
  ('James C.', 'James', 'Cunha'),
  ('James G.', 'James', 'Gavin'),
  ('JD', 'JD', 'Poulson'),
  ('Jordy', 'Jordy', 'Chanon'),
  ('Jose', 'Jose', 'Pineda'),
  ('Justin', 'Justin', 'Todd'),
  ('Katie', 'Katie', 'Ren'),
  ('Kaylyn', 'Kaylyn', 'Sangston'),
  ('Kristen', 'Kristen', 'Burbridge'),
  ('Malaya', 'Malaya', 'Montejano'),
  ('Michael L.', 'Michael', 'Long'),
  ('Michael S.', 'Michael', 'Segura'),
  ('Nancy', 'Nancy', 'Scott'),
  ('Nate', 'Nate', 'Gonzalez'),
  ('Nathan', 'Nathan', 'Lee'),
  ('Osbaldo', 'Osbaldo', 'Orozco-Alvarez'),
  ('Paolo', 'Paolo', 'Alvarez'),
  ('Paula', 'Paula', 'Antonelli'),
  ('Raman', 'Raman', 'Kaur'),
  ('Ruthie', 'Ruth', 'Powell'),
  ('Sagit', 'Sagit', 'Andrews'),
  ('Sammy', 'Samantha', 'Alcazar'),
  ('Sarah', 'Sarah', 'Bylsma'),
  ('Sergiy', 'Serigy', 'Holmer'),
  ('Shelly', 'Shelly', 'Gross'),
  ('Tatiana', 'Tatiana', 'Andrade'),
  ('Thao', 'Thao', 'Nguyen'),
  ('Tibet', 'Tibet', 'Leon'),
  ('Tiffany', 'Tiffany', 'Sherman'),
  ('Tim', 'Tim', 'Aslan'),
  ('Virginia', 'Virginia', 'Parker'),
  ('Wayne', 'Wayne', 'Mezinis')
) as v(display, f, l) where s.name = v.display;

-- 15 on the list with no row yet. No contact details, no pet, no
-- role capability — they start blank and get filled in like any new hire.
-- Two Nicoles, so those two carry an initial the way the existing pairs do.
insert into public.sched_staff (name, first_name, last_name, active, on_roster)
values
  ('Sakie', 'Sakie', 'Belluscio', true, true),
  ('Diana', 'Diana', 'Cisneros-Calles', true, true),
  ('Nicole D.', 'Nicole', 'Damon', true, true),
  ('Madeleine', 'Madeleine', 'Ersnt', true, true),
  ('Yaniv', 'Yaniv', 'Gottlib', true, true),
  ('Madyson', 'Madyson', 'Gross', true, true),
  ('Emma', 'Emma', 'Hartigan', true, true),
  ('Abygail', 'Abygail', 'Lan', true, true),
  ('Donovan', 'Donovan', 'Moses-Batson', true, true),
  ('Andy', 'Andy', 'Nguyen', true, true),
  ('Jonah', 'Jonah', 'Polissar', true, true),
  ('Noah', 'Noah', 'Rojas', true, true),
  ('Nicole S.', 'Nicole', 'Smith', true, true),
  ('Abel', 'Abel', 'Tariku', true, true),
  ('Doris', 'Doris', 'Zebroski', true, true)
on conflict do nothing;

-- Everyone not on the list keeps every shift, hour and payout they ever had --
-- deleting them would tear holes in 238 assignment rows and the commission
-- history. They are deactivated, which is what 'no longer an employee' means
-- in a system that has to survive a payroll audit.
update public.sched_staff
   set active = false, deactivated_at = coalesce(deactivated_at, now())
 where not on_roster and active;

-- The four test people I clocked in to verify the break board are among those
-- deactivated. break_board keys off an OPEN time entry, not off active, so
-- leaving them punched in would keep them on the TV forever. Close them.
update public.sched_time_entries t
   set clock_out = clock_in, hours_worked = 0, note =
       coalesce(t.note || ' | ', '') || 'closed by migration 018 (test fixture)'
  from public.sched_staff s
 where s.id = t.staff_id and t.clock_out is null and not s.on_roster;

commit;
