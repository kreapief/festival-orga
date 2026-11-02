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
