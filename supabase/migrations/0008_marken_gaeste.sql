-- Festival-Orga: Getränkemarken und öffentliche Gäste-Seite

-- ---------- Getränkemarken ----------
-- Wie viele Marken jemand fürs ganze Festival bekommt: die höchste Zahl aus Zugang, Bereichen und persönlicher Zahl.
-- Standardwerte sind Beispiele und lassen sich in den Einstellungen ändern.
alter table public.collectives
  add column tokens_helfer int not null default 1 check (tokens_helfer between 0 and 20),
  add column tokens_crew int not null default 1 check (tokens_crew between 0 and 20),
  add column tokens_admin int not null default 1 check (tokens_admin between 0 and 20),
  add column guest_text text check (char_length(guest_text) <= 1000),
  add column guest_packlist text[] not null default '{}';
grant update (tokens_helfer, tokens_crew, tokens_admin, guest_text, guest_packlist) on public.collectives to authenticated;

alter table public.gewerke add column tokens int not null default 0 check (tokens between 0 and 20);
update public.gewerke set tokens = 3 where kind = 'djs';
-- Auch für neu angelegte Kollektive: der Bereich DJs startet mit 3 Marken (Beispielwert)
create function public.gewerk_default_tokens() returns trigger language plpgsql as $$
begin
  if new.kind = 'djs' and new.tokens = 0 then new.tokens := 3; end if;
  return new;
end $$;
create trigger gewerke_default_tokens before insert on public.gewerke for each row execute function public.gewerk_default_tokens();

alter table public.profiles add column tokens_override int check (tokens_override between 0 and 20);

create table public.token_redemptions (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  redeemed_at timestamptz not null default now()
);
create index on public.token_redemptions (profile_id);
alter table public.token_redemptions enable row level security;
-- Die eigenen Einlösungen sieht man selbst, alle sieht die Crew (Protokoll an der Bar). Eingelöst wird nur über redeem_token().
create policy "Einlösungen lesen" on public.token_redemptions
  for select to authenticated
  using (profile_id = public.my_profile_id() or (collective_id = public.my_collective() and public.is_lead()));

create function public.token_allowance(p uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(pr.tokens_override, greatest(
    case pr.access when 'admin' then c.tokens_admin when 'crew' then c.tokens_crew else c.tokens_helfer end,
    coalesce((select max(g.tokens) from gewerk_members gm join gewerke g on g.id = gm.gewerk_id where gm.profile_id = pr.id), 0)))
  from profiles pr join collectives c on c.id = pr.collective_id where pr.id = p
$$;
revoke execute on function public.token_allowance(uuid) from public, anon, authenticated;

create function public.my_tokens() returns table (total int, used int)
language sql stable security definer set search_path = public as $$
  select coalesce(public.token_allowance(public.my_profile_id()), 0),
         (select count(*)::int from token_redemptions where profile_id = public.my_profile_id())
$$;

-- Eine Marke einlösen. Gibt den Zeitpunkt zurück, damit die Bar die Uhr sieht.
create function public.redeem_token() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_profile_id();
  at timestamptz;
begin
  if me is null then raise exception 'Nicht angemeldet'; end if;
  -- Zwei gleichzeitige Wischer dürfen nicht beide durchgehen
  perform pg_advisory_xact_lock(hashtext(me::text));
  if (select used from public.my_tokens()) >= (select total from public.my_tokens()) then
    raise exception 'Du hast keine Marken mehr.';
  end if;
  insert into token_redemptions (collective_id, profile_id) values (public.my_collective(), me) returning redeemed_at into at;
  return at;
end $$;

-- Crew oder Admin gibt versehentlich eingelöste Marke zurück (die zuletzt eingelöste)
create function public.refund_token(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r uuid;
begin
  if not public.is_lead() then raise exception 'Nur Crew und Admin dürfen das'; end if;
  select id into r from token_redemptions where profile_id = p_profile and collective_id = public.my_collective() order by redeemed_at desc limit 1;
  if r is null then raise exception 'Diese Person hat keine Marke eingelöst'; end if;
  delete from token_redemptions where id = r;
  perform public.notify(p_profile, 'Dir wurde eine Getränkemarke zurückgegeben', 'marken');
end $$;

-- Crew und Admin sehen, wie viele Marken eine Person hat und wie viele schon eingelöst sind
create function public.person_tokens(p_profile uuid) returns table (total int, used int)
language sql stable security definer set search_path = public as $$
  select public.token_allowance(p_profile), (select count(*)::int from token_redemptions where profile_id = p_profile)
  where public.is_lead() and exists (select 1 from profiles where id = p_profile and collective_id = public.my_collective())
$$;

-- Persönliche Zahl für eine Person (leer lassen = es gilt Zugang und Bereich)
create function public.set_tokens(p_profile uuid, p_n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur der Admin darf das'; end if;
  update profiles set tokens_override = p_n where id = p_profile and collective_id = public.my_collective();
end $$;

-- ---------- Timetable: auch Namen ohne Konto ----------
-- Wer noch kein Konto hat, wird als Name eingetragen. Spätere Verknüpfung mit dem Konto: Slot ändern und DJ auswählen.
alter table public.lineup_slots
  alter column profile_id drop not null,
  add column act_name text check (char_length(act_name) <= 60),
  add column act_genre text check (char_length(act_genre) <= 60),
  add constraint lineup_slot_hat_name check (profile_id is not null or nullif(trim(act_name), '') is not null);

drop policy "Line-up planen" on public.lineup_slots;
create policy "Line-up planen" on public.lineup_slots
  for all to authenticated
  using (collective_id = public.my_collective() and public.is_lead())
  with check (
    collective_id = public.my_collective() and public.is_lead()
    and (profile_id is null or exists (select 1 from profiles p where p.id = profile_id and p.collective_id = public.my_collective()))
  );

-- ---------- Öffentliche Gäste-Seite ----------
alter table public.folders add column guest_visible boolean not null default false;
update public.folders set guest_visible = true where name = 'Fotos' and not crew_only;
alter table public.folders add constraint folders_guest_not_crew check (not (guest_visible and crew_only));

-- Alles, was Gäste ohne Konto sehen dürfen, in einem Aufruf. Nur freigegebene Dinge, keine Konten, keine Orga-Daten.
create function public.guest_page() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', c.name, 'fest_start', c.fest_start, 'fest_days', c.fest_days,
    'text', c.guest_text, 'packlist', to_jsonb(c.guest_packlist),
    'fotos', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'url', f.url) order by f.sort)
        from folders f where f.collective_id = c.id and f.guest_visible and not f.crew_only and f.url is not null), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'start', s.start_time, 'end', s.end_time, 'name', coalesce(nullif(trim(s.act_name), ''), p.act_name, p.name), 'genre', coalesce(s.act_genre, p.act_genre)) order by s.day, s.start_time)
        from lineup_slots s left join profiles p on p.id = s.profile_id where s.collective_id = c.id), '[]'::jsonb))
  from collectives c order by c.created_at limit 1
$$;
grant execute on function public.guest_page() to anon, authenticated;


-- ---------- Aufgaben „an alle“ ----------
-- Eine Aufgabe ohne Bereich sehen alle im Team, solange sie offen ist, und jede:r kann sie übernehmen.
-- Aufgaben für einen Bereich (z. B. Orga oder Aufbau) sehen nur Crew, Admin, Zuständige und Leute aus diesem Bereich.
drop policy "Aufgaben lesen" on public.tasks;
create policy "Aufgaben lesen" on public.tasks
  for select to authenticated
  using (collective_id = public.my_collective() and (
    public.is_lead() or public.is_assignee(id)
    or (not public.has_assignees(id) and (gewerk_id is null or public.in_gewerk(gewerk_id)))
  ));

create or replace function public.can_see_task(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks
    where id = t and collective_id = public.my_collective()
      and (
        public.is_lead()
        or exists (select 1 from task_assignees where task_id = t and profile_id = public.my_profile_id())
        or (not exists (select 1 from task_assignees where task_id = t) and (gewerk_id is null or public.in_gewerk(gewerk_id)))
      )
  )
$$;

create or replace function public.claim_task(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  select * into t from tasks where id = p_task and collective_id = public.my_collective();
  if not found then raise exception 'Aufgabe nicht gefunden'; end if;
  if exists (select 1 from task_assignees where task_id = p_task) then raise exception 'Die Aufgabe hat schon jemand'; end if;
  if not (public.is_lead() or t.gewerk_id is null or public.in_gewerk(t.gewerk_id)) then raise exception 'Die Aufgabe gehört nicht zu deinen Bereichen'; end if;
  insert into task_assignees (task_id, profile_id, claimed) values (p_task, public.my_profile_id(), true);
end $$;
