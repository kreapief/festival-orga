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
