-- Local development seed only (not applied to hosted projects).
-- Admin/teacher accounts are created with `npm run bootstrap-admin` + the admin UI, as in production.
insert into public.campuses (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Main Campus')
on conflict (id) do nothing;

insert into public.academic_terms (campus_id, name, starts_on, ends_on)
values ('00000000-0000-4000-8000-000000000001', 'Autumn 2026', '2026-08-15', '2026-12-20');
