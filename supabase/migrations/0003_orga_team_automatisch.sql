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
