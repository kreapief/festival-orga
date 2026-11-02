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
