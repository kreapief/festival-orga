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
