-- Festival-Orga: Mitteilungen. Wer etwas betrifft, bekommt automatisch eine Nachricht in der App.
-- Die Mitteilungen entstehen in der Datenbank selbst (Auslöser), nicht in der Oberfläche.
-- So entgehen sie niemandem, egal wer die Änderung auslöst.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  body text not null,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on public.notifications (profile_id, created_at desc);
alter table public.notifications enable row level security;

create policy "eigene Mitteilungen lesen" on public.notifications
  for select to authenticated using (profile_id = public.my_profile_id());
create policy "eigene Mitteilungen löschen" on public.notifications
  for delete to authenticated using (profile_id = public.my_profile_id());
create policy "eigene als gelesen markieren" on public.notifications
  for update to authenticated using (profile_id = public.my_profile_id()) with check (profile_id = public.my_profile_id());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Eine Mitteilung anlegen. Wer die Änderung selbst auslöst, bekommt keine.
create function public.notify(p_profile uuid, p_body text, p_link text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c uuid;
begin
  if p_profile is null or p_profile = public.my_profile_id() then return; end if;
  select collective_id into c from profiles where id = p_profile;
  if c is null then return; end if;
  insert into notifications (collective_id, profile_id, body, link) values (c, p_profile, p_body, p_link);
end $$;
revoke execute on function public.notify(uuid, text, text) from public, anon, authenticated;

-- „Fr 17.07.“ für einen Festivaltag
create function public.day_label(c uuid, d int) returns text
language sql stable security definer set search_path = public as $$
  select case when fest_start is null then 'Tag ' || (d + 1)
    else (array['So','Mo','Di','Mi','Do','Fr','Sa'])[extract(dow from fest_start + d)::int + 1] || ' ' || to_char(fest_start + d, 'DD.MM.') end
  from collectives where id = c
$$;
revoke execute on function public.day_label(uuid, int) from public, anon, authenticated;

create function public.time_range(a time, b time) returns text
language sql immutable as $$ select to_char(a, 'HH24:MI') || '–' || to_char(b, 'HH24:MI') || ' Uhr' $$;

-- ---------- Schichten ----------
create function public.trg_shift_member_added() returns trigger
language plpgsql security definer set search_path = public as $$
declare s shifts;
begin
  select * into s from shifts where id = new.shift_id;
  perform public.notify(new.profile_id, 'Du bist eingeteilt: ' || s.area || ', ' || public.day_label(s.collective_id, s.day) || ' ' || public.time_range(s.start_time, s.end_time), 'schichten');
  return new;
end $$;
create trigger shift_member_added after insert on public.shift_members for each row execute function public.trg_shift_member_added();

-- Beim Löschen einer ganzen Schicht gibt es nur die eine Meldung „gelöscht“, nicht zusätzlich „herausgenommen“
create function public.trg_shift_member_removed() returns trigger
language plpgsql security definer set search_path = public as $$
declare s shifts;
begin
  select * into s from shifts where id = old.shift_id;
  if found then
    perform public.notify(old.profile_id, 'Du wurdest aus der Schicht genommen: ' || s.area || ', ' || public.day_label(s.collective_id, s.day) || ' ' || public.time_range(s.start_time, s.end_time), 'schichten');
  end if;
  return old;
end $$;
create trigger shift_member_removed after delete on public.shift_members for each row execute function public.trg_shift_member_removed();

create function public.trg_shift_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  if (old.area, old.day, old.start_time, old.end_time) is distinct from (new.area, new.day, new.start_time, new.end_time) then
    for m in select profile_id from shift_members where shift_id = new.id loop
      perform public.notify(m, 'Deine Schicht wurde geändert: ' || new.area || ', ' || public.day_label(new.collective_id, new.day) || ' ' || public.time_range(new.start_time, new.end_time), 'schichten');
    end loop;
  end if;
  return new;
end $$;
create trigger shift_changed after update on public.shifts for each row execute function public.trg_shift_changed();

create function public.trg_shift_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  for m in select profile_id from shift_members where shift_id = old.id loop
    perform public.notify(m, 'Deine Schicht wurde gelöscht: ' || old.area || ', ' || public.day_label(old.collective_id, old.day) || ' ' || public.time_range(old.start_time, old.end_time), 'schichten');
  end loop;
  return old;
end $$;
create trigger shift_deleted before delete on public.shifts for each row execute function public.trg_shift_deleted();

-- ---------- Timetable ----------
create function public.trg_slot_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare txt text;
begin
  if tg_op = 'INSERT' then
    perform public.notify(new.profile_id, 'Du stehst im Timetable: ' || public.day_label(new.collective_id, new.day) || ' ' || public.time_range(new.start_time, new.end_time), 'lineup');
    return new;
  elsif tg_op = 'DELETE' then
    perform public.notify(old.profile_id, 'Dein Slot im Timetable wurde gelöscht: ' || public.day_label(old.collective_id, old.day) || ' ' || public.time_range(old.start_time, old.end_time), 'lineup');
    return old;
  end if;
  txt := public.day_label(new.collective_id, new.day) || ' ' || public.time_range(new.start_time, new.end_time);
  if old.profile_id is distinct from new.profile_id then
    perform public.notify(old.profile_id, 'Dein Slot im Timetable wurde entfernt: ' || public.day_label(old.collective_id, old.day) || ' ' || public.time_range(old.start_time, old.end_time), 'lineup');
    perform public.notify(new.profile_id, 'Du stehst im Timetable: ' || txt, 'lineup');
  elsif (old.day, old.start_time, old.end_time) is distinct from (new.day, new.start_time, new.end_time) then
    perform public.notify(new.profile_id, 'Dein Slot im Timetable wurde geändert: ' || txt, 'lineup');
  end if;
  return new;
end $$;
create trigger slot_changed after insert or update or delete on public.lineup_slots for each row execute function public.trg_slot_changed();

-- ---------- Aufgaben ----------
create function public.trg_assignee_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare t tasks; who text;
begin
  if tg_op = 'DELETE' then
    select * into t from tasks where id = old.task_id;
    if found then perform public.notify(old.profile_id, 'Du wurdest bei der Aufgabe ausgetragen: ' || t.title, 'aufgaben'); end if;
    return old;
  end if;
  select * into t from tasks where id = new.task_id;
  select name into who from profiles where id = new.profile_id;
  if tg_op = 'INSERT' then
    if new.claimed then
      perform public.notify(t.created_by, who || ' hat die Aufgabe übernommen: ' || t.title, 'aufgaben');
    else
      perform public.notify(new.profile_id, 'Dir wurde eine Aufgabe zugeteilt: ' || t.title, 'aufgaben');
    end if;
  elsif new.reported_done and not old.reported_done then
    perform public.notify(t.created_by, who || ' hat die Aufgabe als fertig gemeldet: ' || t.title, 'aufgaben');
  end if;
  return new;
end $$;
create trigger assignee_changed after insert or update or delete on public.task_assignees for each row execute function public.trg_assignee_changed();

create function public.trg_task_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  if tg_op = 'DELETE' then
    for m in select profile_id from task_assignees where task_id = old.id loop
      perform public.notify(m, 'Eine Aufgabe von dir wurde gelöscht: ' || old.title, 'aufgaben');
    end loop;
    return old;
  end if;
  for m in select profile_id from task_assignees where task_id = new.id loop
    if new.done and not old.done then
      perform public.notify(m, 'Aufgabe als erledigt abgehakt: ' || new.title, 'aufgaben');
    elsif old.done and not new.done then
      perform public.notify(m, 'Aufgabe ist wieder offen: ' || new.title, 'aufgaben');
    elsif (old.title, old.due_date, old.due_time, old.prio) is distinct from (new.title, new.due_date, new.due_time, new.prio) then
      perform public.notify(m, 'Aufgabe geändert: ' || new.title, 'aufgaben');
    end if;
  end loop;
  return new;
end $$;
create trigger task_changed after update on public.tasks for each row execute function public.trg_task_changed();
create trigger task_deleted before delete on public.tasks for each row execute function public.trg_task_changed();

-- ---------- Team und Zugang ----------
create function public.trg_team_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare g gewerke;
begin
  if tg_op = 'INSERT' then
    select * into g from gewerke where id = new.gewerk_id;
    perform public.notify(new.profile_id, 'Du bist jetzt im Team ' || g.name, 'bereiche/' || g.id);
    return new;
  end if;
  select * into g from gewerke where id = old.gewerk_id;
  if found then perform public.notify(old.profile_id, 'Du bist nicht mehr im Team ' || g.name, 'bereiche'); end if;
  return old;
end $$;
create trigger team_changed after insert or delete on public.gewerk_members for each row execute function public.trg_team_changed();

create function public.trg_access_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.access is distinct from new.access then
    perform public.notify(new.id, 'Dein Zugang ist jetzt: ' || case new.access when 'admin' then 'Admin' when 'crew' then 'Crew' else 'Helfer:in' end, 'profil');
  end if;
  return new;
end $$;
create trigger access_changed after update of access on public.profiles for each row execute function public.trg_access_changed();
