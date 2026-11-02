-- Festival-Orga: komplette Einrichtung (0001 bis 0007). Einmal im SQL-Editor von Supabase ausführen.

-- Festival-Orga: Grundgerüst
-- Anmeldung nur über das Gerät (anonyme Supabase-Anmeldung), verknüpft mit einem Profil.
-- Wer was sehen und ändern darf, regeln die Policies unten (Row Level Security).

create extension if not exists pgcrypto with schema extensions;

create type public.access_level as enum ('admin', 'crew', 'helfer');
create type public.prio_level as enum ('hoch', 'mittel', 'niedrig');

-- ---------- Tabellen ----------

create table public.collectives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  -- Das Gerät, mit dem die Person gerade angemeldet ist. Ein Wiederanmelde-Link hängt das Profil um.
  user_id uuid unique references auth.users on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 60),
  access public.access_level not null default 'helfer',
  photo_url text,
  created_at timestamptz not null default now()
);

create table public.gewerke (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  name text not null,
  -- 'orga' und 'djs' haben Sonderregeln, alle anderen Bereiche sind gleich
  kind text check (kind in ('orga', 'djs')),
  sort int not null default 0,
  unique (collective_id, name)
);

create table public.gewerk_members (
  gewerk_id uuid not null references public.gewerke on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  primary key (gewerk_id, profile_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  code text not null unique,
  access public.access_level not null,
  -- Bereich-Link: wer darüber kommt, landet direkt im Team
  gewerk_id uuid references public.gewerke on delete cascade,
  -- Admin-Einladung gilt nur einmal
  single_use boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.relogin_tokens (
  token text primary key,
  profile_id uuid not null references public.profiles on delete cascade,
  created_by uuid references public.profiles on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  gewerk_id uuid references public.gewerke on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  due_date date,
  due_time time,
  prio public.prio_level not null default 'mittel',
  created_by uuid references public.profiles on delete set null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.task_assignees (
  task_id uuid not null references public.tasks on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  claimed boolean not null default false,
  reported_done boolean not null default false,
  primary key (task_id, profile_id)
);

create index on public.profiles (collective_id);
create index on public.tasks (collective_id);
create index on public.task_assignees (profile_id);
create index on public.gewerk_members (profile_id);

-- ---------- Hilfsfunktionen (umgehen RLS gezielt, damit Policies sich nicht gegenseitig aufrufen) ----------

create function public.my_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where user_id = auth.uid()
$$;

create function public.my_collective() returns uuid
language sql stable security definer set search_path = public as $$
  select collective_id from profiles where user_id = auth.uid()
$$;

create function public.my_access() returns public.access_level
language sql stable security definer set search_path = public as $$
  select access from profiles where user_id = auth.uid()
$$;

create function public.is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_access() in ('admin', 'crew'), false)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_access() = 'admin', false)
$$;

create function public.in_gewerk(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from gewerk_members where gewerk_id = g and profile_id = public.my_profile_id())
$$;

-- Darf ich Leute in diesen Bereich holen? Admin immer, Crew in eigenen Bereichen und bei den DJs
create function public.can_manage_gewerk(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or (public.my_access() = 'crew' and (public.in_gewerk(g) or exists (select 1 from gewerke where id = g and kind = 'djs')))
$$;

-- Helfer:innen sehen eigene Aufgaben und offene Aufgaben aus ihren Bereichen
create function public.can_see_task(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks
    where id = t and collective_id = public.my_collective()
      and (
        public.is_lead()
        or exists (select 1 from task_assignees where task_id = t and profile_id = public.my_profile_id())
        or (not exists (select 1 from task_assignees where task_id = t) and public.in_gewerk(gewerk_id))
      )
  )
$$;

create function public.is_assignee(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from task_assignees where task_id = t and profile_id = public.my_profile_id())
$$;

create function public.has_assignees(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from task_assignees where task_id = t)
$$;

create function public.random_code(len int default 8) returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- ohne 0/O und 1/I, damit man nichts verwechselt
  b bytea := gen_random_bytes(len);
  result text := '';
begin
  for i in 0 .. len - 1 loop
    result := result || substr(chars, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return result;
end $$;

-- ---------- Row Level Security ----------

alter table public.collectives enable row level security;
alter table public.profiles enable row level security;
alter table public.gewerke enable row level security;
alter table public.gewerk_members enable row level security;
alter table public.invites enable row level security;
alter table public.relogin_tokens enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;

create policy "eigenes Kollektiv lesen" on public.collectives
  for select to authenticated using (id = public.my_collective());

create policy "Team lesen" on public.profiles
  for select to authenticated using (collective_id = public.my_collective());
-- Nur Name und Foto selbst ändern; den Zugang ändert der Admin über set_access()
create policy "eigenes Profil ändern" on public.profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (name, photo_url) on public.profiles to authenticated;

create policy "Bereiche lesen" on public.gewerke
  for select to authenticated using (collective_id = public.my_collective());
create policy "Bereiche verwalten" on public.gewerke
  for all to authenticated using (collective_id = public.my_collective() and public.is_admin())
  with check (collective_id = public.my_collective() and public.is_admin());

create policy "Teams lesen" on public.gewerk_members
  for select to authenticated
  using (exists (select 1 from gewerke where id = gewerk_id and collective_id = public.my_collective()));
create policy "ins Team holen" on public.gewerk_members
  for insert to authenticated
  with check (
    public.can_manage_gewerk(gewerk_id)
    and exists (select 1 from profiles p where p.id = profile_id and p.collective_id = public.my_collective()
      -- Ins Orga-Team nur Crew und Admin
      and (p.access in ('admin', 'crew') or not exists (select 1 from gewerke where id = gewerk_id and kind = 'orga')))
  );
create policy "aus Team nehmen" on public.gewerk_members
  for delete to authenticated using (public.can_manage_gewerk(gewerk_id));

-- Crew sieht die Helfer:innen-Links, der Admin alle
create policy "Einladungen lesen" on public.invites
  for select to authenticated
  using (collective_id = public.my_collective() and (public.is_admin() or (public.is_lead() and access = 'helfer')));

-- relogin_tokens: kein direkter Zugriff, nur über Funktionen

-- Prüft die Zeile selbst (nicht über can_see_task), damit auch eine gerade angelegte Aufgabe sofort lesbar ist
create policy "Aufgaben lesen" on public.tasks
  for select to authenticated
  using (collective_id = public.my_collective() and (
    public.is_lead() or public.is_assignee(id) or (not public.has_assignees(id) and public.in_gewerk(gewerk_id))
  ));
create policy "Aufgaben anlegen" on public.tasks
  for insert to authenticated
  with check (collective_id = public.my_collective() and public.is_lead() and created_by = public.my_profile_id());
-- Ändern und abhaken: wer die Aufgabe erstellt hat, oder ein Admin
create policy "Aufgaben ändern" on public.tasks
  for update to authenticated
  using (collective_id = public.my_collective() and (created_by = public.my_profile_id() or public.is_admin()));
create policy "Aufgaben löschen" on public.tasks
  for delete to authenticated
  using (collective_id = public.my_collective() and (created_by = public.my_profile_id() or public.is_admin()));

create policy "Zuständige lesen" on public.task_assignees
  for select to authenticated using (public.can_see_task(task_id));
create policy "Zuständige eintragen" on public.task_assignees
  for insert to authenticated with check (public.is_lead() and public.can_see_task(task_id));
create policy "Zuständige austragen" on public.task_assignees
  for delete to authenticated using (public.is_lead() and public.can_see_task(task_id));

-- ---------- Funktionen, die die App aufruft ----------

-- Über einen Einladungslink beitreten. Zugang und Bereich kommen aus dem Link.
create function public.join_with_code(p_code text, p_name text) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  inv invites;
  prof profiles;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if exists (select 1 from profiles where user_id = auth.uid()) then raise exception 'Dieses Gerät ist schon angemeldet'; end if;
  select * into inv from invites where code = upper(trim(p_code)) and active;
  if not found then raise exception 'Dieser Einladungslink gilt nicht mehr. Frag die Crew nach einem neuen.'; end if;

  insert into profiles (collective_id, user_id, name, access)
  values (inv.collective_id, auth.uid(), trim(p_name), inv.access)
  returning * into prof;

  if inv.gewerk_id is not null then
    insert into gewerk_members (gewerk_id, profile_id) values (inv.gewerk_id, prof.id);
  end if;
  if inv.single_use then update invites set active = false where id = inv.id; end if;
  return prof;
end $$;

-- Crew oder Admin erzeugt einen Link, mit dem eine Person auf einem neuen Gerät wieder reinkommt.
create function public.create_relogin_link(p_profile uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  t text;
begin
  if not public.is_lead() then raise exception 'Nur Crew und Admin dürfen das'; end if;
  if not exists (select 1 from profiles where id = p_profile and collective_id = public.my_collective()) then
    raise exception 'Person nicht gefunden';
  end if;
  t := public.random_code(16);
  insert into relogin_tokens (token, profile_id, created_by, expires_at)
  values (t, p_profile, public.my_profile_id(), now() + interval '24 hours');
  return t;
end $$;

-- Auf dem neuen Gerät: Profil übernehmen. Das alte Gerät ist danach abgemeldet.
create function public.claim_relogin(p_token text) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  rt relogin_tokens;
  prof profiles;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into rt from relogin_tokens where token = upper(trim(p_token)) for update;
  if not found or rt.used_at is not null or rt.expires_at < now() then
    raise exception 'Dieser Link ist abgelaufen oder wurde schon benutzt. Frag die Crew nach einem neuen.';
  end if;
  -- Falls dieses Gerät schon an einem anderen Profil hing, lösen
  update profiles set user_id = null where user_id = auth.uid();
  update profiles set user_id = auth.uid() where id = rt.profile_id returning * into prof;
  update relogin_tokens set used_at = now() where token = rt.token;
  return prof;
end $$;

create function public.set_access(p_profile uuid, p_access public.access_level) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur der Admin darf das'; end if;
  if p_profile = public.my_profile_id() then raise exception 'Den eigenen Zugang kannst du nicht ändern'; end if;
  update profiles set access = p_access where id = p_profile and collective_id = public.my_collective();
end $$;

create function public.renew_invite(p_invite uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text := public.random_code(8);
begin
  if not public.is_admin() then raise exception 'Nur der Admin darf das'; end if;
  update invites set code = c where id = p_invite and collective_id = public.my_collective();
  return c;
end $$;

-- Zuständige Person meldet: Ich bin fertig
create function public.report_task_done(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update task_assignees set reported_done = true where task_id = p_task and profile_id = public.my_profile_id();
  if not found then raise exception 'Du bist bei dieser Aufgabe nicht eingetragen'; end if;
end $$;

-- Offene Aufgabe übernehmen (ich mach das)
create function public.claim_task(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  select * into t from tasks where id = p_task and collective_id = public.my_collective();
  if not found then raise exception 'Aufgabe nicht gefunden'; end if;
  if exists (select 1 from task_assignees where task_id = p_task) then raise exception 'Die Aufgabe hat schon jemand'; end if;
  if not (public.is_lead() or public.in_gewerk(t.gewerk_id)) then raise exception 'Die Aufgabe gehört nicht zu deinen Bereichen'; end if;
  insert into task_assignees (task_id, profile_id, claimed) values (p_task, public.my_profile_id(), true);
end $$;

-- Link für einen Bereich: wer darüber kommt, ist Helfer:in und gleich im Team
create function public.gewerk_invite(p_gewerk uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
  g gewerke;
begin
  if not public.is_lead() then raise exception 'Nur Crew und Admin dürfen das'; end if;
  select * into g from gewerke where id = p_gewerk and collective_id = public.my_collective();
  if not found then raise exception 'Bereich nicht gefunden'; end if;
  if g.kind = 'orga' then raise exception 'Fürs Orga-Team gibt es keinen Helfer:innen-Link'; end if;
  select code into c from invites where gewerk_id = p_gewerk and active;
  if found then return c; end if;
  insert into invites (collective_id, code, access, gewerk_id)
  values (g.collective_id, public.random_code(8), 'helfer', p_gewerk) returning code into c;
  return c;
end $$;

-- Für die Anmeldeseite: wofür lädt dieser Link ein? Darf auch ohne Anmeldung gefragt werden.
create function public.invite_info(p_code text)
returns table (zugang public.access_level, bereich text, kollektiv text)
language sql stable security definer set search_path = public as $$
  select i.access, g.name, c.name
  from invites i join collectives c on c.id = i.collective_id left join gewerke g on g.id = i.gewerk_id
  where i.code = upper(trim(p_code)) and i.active
$$;
grant execute on function public.invite_info(text) to anon, authenticated;

-- Ersteinrichtung: nur im SQL-Editor von Supabase ausführen, nicht aus der App
create function public.create_collective(p_name text)
returns table (art text, code text)
language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  g text;
  i int := 0;
begin
  insert into collectives (name) values (p_name) returning id into c;
  foreach g in array array['Orga','Barschichten','Aufbau','Designs','Deko','Essen','Social Media','Spiele Olympiade','Glücksrad','Shuttle','DJs','Awareness'] loop
    insert into gewerke (collective_id, name, kind, sort)
    values (c, g, case g when 'Orga' then 'orga' when 'DJs' then 'djs' end, i);
    i := i + 1;
  end loop;
  insert into invites (collective_id, code, access, single_use) values (c, public.random_code(8), 'admin', true);
  insert into invites (collective_id, code, access) values (c, public.random_code(8), 'crew');
  insert into invites (collective_id, code, access) values (c, public.random_code(8), 'helfer');
  return query select i2.access::text, i2.code from invites i2 where i2.collective_id = c order by i2.access;
end $$;

revoke execute on function public.create_collective(text) from public, anon, authenticated;
revoke execute on function public.random_code(int) from public, anon, authenticated;
revoke execute on function public.join_with_code(text, text) from anon;
revoke execute on function public.claim_relogin(text) from anon;

-- Festival-Orga: Festivaltage, Schichten, Line-up und Termine

-- ---------- Festivaltage ----------
-- Schichten und Slots speichern nur den Festivaltag (0 = erster Tag). Das Datum ergibt sich aus fest_start.
alter table public.collectives
  add column fest_start date,
  add column fest_days int not null default 3 check (fest_days between 1 and 14);

create policy "Festival einstellen" on public.collectives
  for update to authenticated
  using (id = public.my_collective() and public.is_admin())
  with check (id = public.my_collective() and public.is_admin());
revoke update on public.collectives from authenticated;
grant update (name, fest_start, fest_days) on public.collectives to authenticated;

-- ---------- DJ-Infos ----------
alter table public.profiles
  add column act_name text check (char_length(act_name) <= 60),
  add column act_genre text check (char_length(act_genre) <= 60);

-- DJ selbst, Crew oder Admin
create function public.set_act(p_profile uuid, p_name text, p_genre text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_lead() or p_profile = public.my_profile_id()) then
    raise exception 'DJ-Infos ändern nur der DJ selbst, Crew oder Admin';
  end if;
  update profiles set act_name = nullif(trim(p_name), ''), act_genre = nullif(trim(p_genre), '')
  where id = p_profile and collective_id = public.my_collective();
end $$;

-- ---------- Tabellen ----------

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  gewerk_id uuid references public.gewerke on delete set null,
  area text not null check (char_length(trim(area)) between 1 and 60),
  day int not null check (day >= 0),
  start_time time not null,
  end_time time not null,
  need int not null default 1 check (need between 1 and 50),
  created_at timestamptz not null default now()
);

create table public.shift_members (
  shift_id uuid not null references public.shifts on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  primary key (shift_id, profile_id)
);

create table public.lineup_slots (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  day int not null check (day >= 0),
  start_time time not null,
  end_time time not null,
  profile_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  date date not null,
  time time,
  title text not null check (char_length(trim(title)) between 1 and 120),
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create index on public.shifts (collective_id);
create index on public.shift_members (profile_id);
create index on public.lineup_slots (collective_id);
create index on public.events (collective_id, date);

-- Schichten plant der Admin und die Crew des jeweiligen Bereichs. Schichten ohne Bereich plant jede Crew.
create function public.can_manage_shift(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.my_access() = 'crew' and (g is null or public.in_gewerk(g)))
$$;

-- ---------- Row Level Security ----------

alter table public.shifts enable row level security;
alter table public.shift_members enable row level security;
alter table public.lineup_slots enable row level security;
alter table public.events enable row level security;

-- Alle im Team sehen alle Schichten (für die Tagesübersicht: wer ist wann wo)
create policy "Schichten lesen" on public.shifts
  for select to authenticated using (collective_id = public.my_collective());
create policy "Schichten planen" on public.shifts
  for all to authenticated
  using (collective_id = public.my_collective() and public.can_manage_shift(gewerk_id))
  with check (collective_id = public.my_collective() and public.can_manage_shift(gewerk_id));

create policy "Schichtbesetzung lesen" on public.shift_members
  for select to authenticated
  using (exists (select 1 from shifts s where s.id = shift_id and s.collective_id = public.my_collective()));
-- Andere eintragen nur, wer die Schicht plant. Sich selbst eintragen geht über join_shift().
create policy "Schicht zuteilen" on public.shift_members
  for insert to authenticated
  with check (
    exists (select 1 from shifts s where s.id = shift_id and s.collective_id = public.my_collective() and public.can_manage_shift(s.gewerk_id))
    and exists (select 1 from profiles p where p.id = profile_id and p.collective_id = public.my_collective())
  );
create policy "aus Schicht austragen" on public.shift_members
  for delete to authenticated
  using (
    profile_id = public.my_profile_id()
    or exists (select 1 from shifts s where s.id = shift_id and s.collective_id = public.my_collective() and public.can_manage_shift(s.gewerk_id))
  );

-- Das Line-up sehen alle, planen tun Admin und Crew
create policy "Line-up lesen" on public.lineup_slots
  for select to authenticated using (collective_id = public.my_collective());
create policy "Line-up planen" on public.lineup_slots
  for all to authenticated
  using (collective_id = public.my_collective() and public.is_lead())
  with check (
    collective_id = public.my_collective() and public.is_lead()
    and exists (select 1 from profiles p where p.id = profile_id and p.collective_id = public.my_collective())
  );

create policy "Termine lesen" on public.events
  for select to authenticated using (collective_id = public.my_collective());
create policy "Termine planen" on public.events
  for all to authenticated
  using (collective_id = public.my_collective() and public.is_lead())
  with check (collective_id = public.my_collective() and public.is_lead());

-- ---------- Funktionen ----------

-- Selbst in eine freie Schicht eintragen
create function public.join_shift(p_shift uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s shifts;
begin
  if public.my_profile_id() is null then raise exception 'Nicht angemeldet'; end if;
  select * into s from shifts where id = p_shift and collective_id = public.my_collective() for update;
  if not found then raise exception 'Schicht nicht gefunden'; end if;
  if exists (select 1 from shift_members where shift_id = p_shift and profile_id = public.my_profile_id()) then return; end if;
  if (select count(*) from shift_members where shift_id = p_shift) >= s.need then
    raise exception 'Die Schicht ist leider schon voll';
  end if;
  insert into shift_members (shift_id, profile_id) values (p_shift, public.my_profile_id());
end $$;

-- Festival-Orga: Crew und Admin gehören automatisch zum Bereich „Orga“

-- Beitreten: Wer über einen Crew- oder Admin-Link kommt, ist gleich im Orga-Team.
create or replace function public.join_with_code(p_code text, p_name text) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  inv invites;
  prof profiles;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if exists (select 1 from profiles where user_id = auth.uid()) then raise exception 'Dieses Gerät ist schon angemeldet'; end if;
  select * into inv from invites where code = upper(trim(p_code)) and active;
  if not found then raise exception 'Dieser Einladungslink gilt nicht mehr. Frag die Crew nach einem neuen.'; end if;

  insert into profiles (collective_id, user_id, name, access)
  values (inv.collective_id, auth.uid(), trim(p_name), inv.access)
  returning * into prof;

  if inv.gewerk_id is not null then
    insert into gewerk_members (gewerk_id, profile_id) values (inv.gewerk_id, prof.id);
  end if;
  if inv.access in ('admin', 'crew') then
    insert into gewerk_members (gewerk_id, profile_id)
    select id, prof.id from gewerke where collective_id = inv.collective_id and kind = 'orga'
    on conflict do nothing;
  end if;
  if inv.single_use then update invites set active = false where id = inv.id; end if;
  return prof;
end $$;

-- Zugang ändern: Wer Crew oder Admin wird, kommt ins Orga-Team. Wer zur Helfer:in wird, verlässt es.
create or replace function public.set_access(p_profile uuid, p_access public.access_level) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur der Admin darf das'; end if;
  if p_profile = public.my_profile_id() then raise exception 'Den eigenen Zugang kannst du nicht ändern'; end if;
  update profiles set access = p_access where id = p_profile and collective_id = public.my_collective();
  if p_access in ('admin', 'crew') then
    insert into gewerk_members (gewerk_id, profile_id)
    select id, p_profile from gewerke where collective_id = public.my_collective() and kind = 'orga'
    on conflict do nothing;
  else
    delete from gewerk_members
    where profile_id = p_profile and gewerk_id in (select id from gewerke where collective_id = public.my_collective() and kind = 'orga');
  end if;
end $$;

-- Bestehende Crew und Admins nachtragen
insert into public.gewerk_members (gewerk_id, profile_id)
select g.id, p.id from public.profiles p
join public.gewerke g on g.collective_id = p.collective_id and g.kind = 'orga'
where p.access in ('admin', 'crew')
on conflict do nothing;

-- Festival-Orga: Der Bereich „Orga“ heißt jetzt „Crew“ (wie die Rolle).
-- Wer Crew-Rechte hat, ist automatisch in der Gruppe Crew. Wer in der Gruppe Crew ist, hat dadurch
-- aber noch keine Crew-Rechte: Der Admin (und die Crew-Leute dort) dürfen auch Helfer:innen in die Gruppe holen.

update public.gewerke set name = 'Crew' where kind = 'orga' and name = 'Orga';

drop policy if exists "ins Team holen" on public.gewerk_members;
create policy "ins Team holen" on public.gewerk_members
  for insert to authenticated
  with check (
    public.can_manage_gewerk(gewerk_id)
    and exists (select 1 from profiles p where p.id = profile_id and p.collective_id = public.my_collective())
  );

-- Zugang ändern: Wer Crew oder Admin wird, kommt in die Gruppe Crew.
-- Wer wieder Helfer:in wird, bleibt dort, bis jemand ihn herausnimmt.
create or replace function public.set_access(p_profile uuid, p_access public.access_level) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur der Admin darf das'; end if;
  if p_profile = public.my_profile_id() then raise exception 'Den eigenen Zugang kannst du nicht ändern'; end if;
  update profiles set access = p_access where id = p_profile and collective_id = public.my_collective();
  if p_access in ('admin', 'crew') then
    insert into gewerk_members (gewerk_id, profile_id)
    select id, p_profile from gewerke where collective_id = public.my_collective() and kind = 'orga'
    on conflict do nothing;
  end if;
end $$;

create or replace function public.gewerk_invite(p_gewerk uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
  g gewerke;
begin
  if not public.is_lead() then raise exception 'Nur Crew und Admin dürfen das'; end if;
  select * into g from gewerke where id = p_gewerk and collective_id = public.my_collective();
  if not found then raise exception 'Bereich nicht gefunden'; end if;
  if g.kind = 'orga' then raise exception 'Für die Gruppe Crew gibt es keinen Helfer:innen-Link'; end if;
  select code into c from invites where gewerk_id = p_gewerk and active;
  if found then return c; end if;
  insert into invites (collective_id, code, access, gewerk_id)
  values (g.collective_id, public.random_code(8), 'helfer', p_gewerk) returning code into c;
  return c;
end $$;

-- Für neue Kollektive: der Bereich heißt gleich Crew
create or replace function public.create_collective(p_name text)
returns table (art text, code text)
language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  g text;
  i int := 0;
begin
  insert into collectives (name) values (p_name) returning id into c;
  foreach g in array array['Crew','Barschichten','Aufbau','Designs','Deko','Essen','Social Media','Spiele Olympiade','Glücksrad','Shuttle','DJs','Awareness'] loop
    insert into gewerke (collective_id, name, kind, sort)
    values (c, g, case g when 'Crew' then 'orga' when 'DJs' then 'djs' end, i);
    i := i + 1;
  end loop;
  insert into invites (collective_id, code, access, single_use) values (c, public.random_code(8), 'admin', true);
  insert into invites (collective_id, code, access) values (c, public.random_code(8), 'crew');
  insert into invites (collective_id, code, access) values (c, public.random_code(8), 'helfer');
  return query select i2.access::text, i2.code from invites i2 where i2.collective_id = c order by i2.access;
end $$;

-- Festival-Orga: Die Rolle heißt „Crew“, die Gruppe (der Chat) heißt „Orga“.
-- Wer Crew-Rechte hat, ist automatisch in der Gruppe Orga. Wer in der Gruppe Orga ist, hat dadurch keine Crew-Rechte.

update public.gewerke set name = 'Orga' where kind = 'orga';

create or replace function public.gewerk_invite(p_gewerk uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
  g gewerke;
begin
  if not public.is_lead() then raise exception 'Nur Crew und Admin dürfen das'; end if;
  select * into g from gewerke where id = p_gewerk and collective_id = public.my_collective();
  if not found then raise exception 'Bereich nicht gefunden'; end if;
  if g.kind = 'orga' then raise exception 'Für die Gruppe Orga gibt es keinen Helfer:innen-Link'; end if;
  select code into c from invites where gewerk_id = p_gewerk and active;
  if found then return c; end if;
  insert into invites (collective_id, code, access, gewerk_id)
  values (g.collective_id, public.random_code(8), 'helfer', p_gewerk) returning code into c;
  return c;
end $$;

create or replace function public.create_collective(p_name text)
returns table (art text, code text)
language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  g text;
  i int := 0;
begin
  insert into collectives (name) values (p_name) returning id into c;
  foreach g in array array['Orga','Barschichten','Aufbau','Designs','Deko','Essen','Social Media','Spiele Olympiade','Glücksrad','Shuttle','DJs','Awareness'] loop
    insert into gewerke (collective_id, name, kind, sort)
    values (c, g, case g when 'Orga' then 'orga' when 'DJs' then 'djs' end, i);
    i := i + 1;
  end loop;
  insert into invites (collective_id, code, access, single_use) values (c, public.random_code(8), 'admin', true);
  insert into invites (collective_id, code, access) values (c, public.random_code(8), 'crew');
  insert into invites (collective_id, code, access) values (c, public.random_code(8), 'helfer');
  return query select i2.access::text, i2.code from invites i2 where i2.collective_id = c order by i2.access;
end $$;

-- Festival-Orga: Chat-Räume, Ordner-Links (Google Drive) und Archiv für erledigte Aufgaben

-- ---------- Aufgaben: wann erledigt ----------
alter table public.tasks add column done_at timestamptz;
update public.tasks set done_at = now() where done and done_at is null;

create function public.tasks_done_at() returns trigger
language plpgsql as $$
begin
  if new.done and not coalesce(old.done, false) then new.done_at := now();
  elsif not new.done then new.done_at := null;
  end if;
  return new;
end $$;
create trigger tasks_done_at before update of done on public.tasks
  for each row execute function public.tasks_done_at();

-- ---------- Chat ----------
-- Ein Raum ist entweder 'helfer' (alle im Team) oder die ID eines Bereichs.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  channel text not null,
  profile_id uuid not null references public.profiles on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.messages (collective_id, channel, created_at desc);

create table public.chat_reads (
  profile_id uuid not null references public.profiles on delete cascade,
  channel text not null,
  read_at timestamptz not null default 'epoch',
  primary key (profile_id, channel)
);

-- Darf ich in diesem Raum lesen und schreiben? Helfer:innen-Raum: alle. Bereichs-Raum: Crew und Admin immer, sonst wer im Bereich ist.
create function public.can_chat(ch text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_profile_id() is not null and (
    ch = 'helfer'
    or exists (
      select 1 from gewerke g
      where g.id::text = ch and g.collective_id = public.my_collective()
        and (public.is_lead() or public.in_gewerk(g.id))
    )
  )
$$;

alter table public.messages enable row level security;
alter table public.chat_reads enable row level security;

create policy "Nachrichten lesen" on public.messages
  for select to authenticated using (collective_id = public.my_collective() and public.can_chat(channel));
create policy "Nachrichten schreiben" on public.messages
  for insert to authenticated
  with check (collective_id = public.my_collective() and profile_id = public.my_profile_id() and public.can_chat(channel));
-- Löschen: die eigene Nachricht oder der Admin
create policy "Nachrichten löschen" on public.messages
  for delete to authenticated
  using (collective_id = public.my_collective() and (profile_id = public.my_profile_id() or public.is_admin()));
-- chat_reads: kein direkter Zugriff, nur über mark_read()

-- Übersicht für die Raumliste: alle meine Räume mit letzter Nachricht und Zahl der ungelesenen
create function public.chat_overview()
returns table (channel text, last_body text, last_at timestamptz, last_name text, unread bigint)
language sql stable security definer set search_path = public as $$
  with mine as (
    select 'helfer'::text as channel where public.my_profile_id() is not null
    union all
    select g.id::text from gewerke g
    where g.collective_id = public.my_collective() and (public.is_lead() or public.in_gewerk(g.id))
  )
  select m.channel, l.body, l.created_at, p.name,
    (select count(*) from messages x
      where x.collective_id = public.my_collective() and x.channel = m.channel and x.profile_id <> public.my_profile_id()
        and x.created_at > coalesce((select r.read_at from chat_reads r where r.profile_id = public.my_profile_id() and r.channel = m.channel), 'epoch'))
  from mine m
  left join lateral (
    select x.body, x.created_at, x.profile_id from messages x
    where x.collective_id = public.my_collective() and x.channel = m.channel order by x.created_at desc limit 1
  ) l on true
  left join profiles p on p.id = l.profile_id
$$;

-- Als gelesen markieren, bis zur zuletzt gesehenen Nachricht
create function public.mark_read(ch text, upto timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_chat(ch) then raise exception 'Diesen Raum darfst du nicht lesen'; end if;
  insert into chat_reads (profile_id, channel, read_at) values (public.my_profile_id(), ch, upto)
  on conflict (profile_id, channel) do update set read_at = greatest(chat_reads.read_at, excluded.read_at);
end $$;

-- ---------- Ordner-Links (Google Drive) ----------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references public.collectives on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  note text check (char_length(note) <= 200),
  url text check (url is null or url ~* '^https://[^ ]+$'),
  crew_only boolean not null default false,
  sort int not null default 0
);
create index on public.folders (collective_id);
alter table public.folders enable row level security;

-- Ordner nur für die Crew sieht die Helfer:in gar nicht erst (auch nicht den Link)
create policy "Ordner lesen" on public.folders
  for select to authenticated using (collective_id = public.my_collective() and (not crew_only or public.is_lead()));
create policy "Ordner verwalten" on public.folders
  for all to authenticated
  using (collective_id = public.my_collective() and public.is_admin())
  with check (collective_id = public.my_collective() and public.is_admin());

-- Jedes Kollektiv bekommt einen Fotoordner (für alle) und einen Orga-Ordner (nur Crew)
create function public.seed_folders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into folders (collective_id, name, note, crew_only, sort) values
    (new.id, 'Fotos', 'Alle Fotos fürs Team', false, 0),
    (new.id, 'Orga-Ordner', 'Logos, Designs, Verträge und alles Wichtige', true, 1);
  return new;
end $$;
create trigger collectives_seed_folders after insert on public.collectives
  for each row execute function public.seed_folders();

insert into public.folders (collective_id, name, note, crew_only, sort)
select c.id, f.name, f.note, f.crew_only, f.sort from public.collectives c,
  (values ('Fotos', 'Alle Fotos fürs Team', false, 0), ('Orga-Ordner', 'Logos, Designs, Verträge und alles Wichtige', true, 1)) as f(name, note, crew_only, sort)
where not exists (select 1 from public.folders x where x.collective_id = c.id);

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
