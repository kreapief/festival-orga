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
