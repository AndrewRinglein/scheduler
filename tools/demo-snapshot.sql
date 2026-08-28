-- The query behind sched/demo-data.json.
--
-- Run it in the Supabase SQL editor and save the single text column over
-- sched/demo-data.json, then `node tools/build-demo.mjs`. Widen the date
-- window to move the demo to a different fortnight.
--
-- Only the columns the app actually reads are selected, and the two embedded
-- joins (sched_staff/sched_sessions) are built by hand so the shape matches
-- what PostgREST returns for loadAll()'s select strings. If loadAll grows a
-- table, add it here and to the T map in tools/build-demo.mjs, or that table
-- silently reads as empty in the demo.
with win as (select id, hall_id, session_date, part, status, comm_rate, day_type
             from public.sched_sessions
             where session_date between '2026-08-10' and '2026-08-23')
select json_build_object(
 'roles',(select json_agg(json_build_object('id',id,'name',name,'sort',sort,'fixed_count',fixed_count,'min_on_floor',min_on_floor,'cover_group',cover_group)) from public.sched_roles),
 'days',(select json_agg(json_build_object('hall_id',hall_id,'dow',dow,'part',part,'active',active)) from public.sched_hall_days),
 'needs',(select json_agg(json_build_object('hall_id',hall_id,'role_id',role_id,'dow',dow,'part',part,'needed',needed)) from public.sched_hall_role_needs),
 'times',(select json_agg(json_build_object('hall_id',hall_id,'role_id',role_id,'dow',dow,'part',part,'start_time',start_time,'end_time',end_time)) from public.sched_hall_role_times),
 'staff',(select json_agg(json_build_object('id',id,'name',name,'first_name',first_name,'active',active,'pet',pet,'pet_kind',pet_kind,'phone',phone,'email',email,'on_roster',on_roster)) from public.sched_staff),
 'caps',(select json_agg(json_build_object('staff_id',staff_id,'role_id',role_id,'can_do',can_do,'is_deputy',is_deputy)) from public.sched_staff_role_capability),
 'sessions',(select json_agg(w) from win w),
 'assigns',(select json_agg(json_build_object('id',a.id,'session_id',a.session_id,'role_id',a.role_id,'staff_id',a.staff_id,'slot_index',a.slot_index,'early_start',a.early_start,'is_training',a.is_training,'response',a.response,'scheduled_start',a.scheduled_start,'scheduled_end',a.scheduled_end,'sched_staff',json_build_object('name',st.name),'sched_sessions',json_build_object('hall_id',w.hall_id)))
    from public.sched_assignments a join win w on w.id=a.session_id
    left join public.sched_staff st on st.id=a.staff_id),
 'cpos',(select json_agg(json_build_object('session_id',cp.session_id,'staff_id',cp.staff_id,'section',cp.section,'position',cp.position,'sched_staff',json_build_object('name',st.name),'sched_sessions',json_build_object('hall_id',w.hall_id,'session_date',w.session_date,'part',w.part)))
    from public.sched_caller_positions cp join win w on w.id=cp.session_id
    join public.sched_staff st on st.id=cp.staff_id),
 'periods',(select json_agg(json_build_object('id',id,'starts_on',starts_on,'ends_on',ends_on,'label',label,'status',status,'note',note,'published_at',published_at)) from public.sched_periods)
)::text as snap;
