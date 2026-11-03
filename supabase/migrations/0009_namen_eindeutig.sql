-- Festival-Orga: Jeder Name gibt es pro Kollektiv nur einmal (Groß-/Kleinschreibung egal)
create unique index profiles_name_eindeutig on public.profiles (collective_id, lower(btrim(name)));

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
  if exists (select 1 from profiles where collective_id = inv.collective_id and lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'Den Namen % gibt es hier schon. Schreib noch deinen Nachnamen oder einen Buchstaben dazu, zum Beispiel „% M.“.', btrim(p_name), btrim(p_name);
  end if;

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
revoke execute on function public.join_with_code(text, text) from anon;
