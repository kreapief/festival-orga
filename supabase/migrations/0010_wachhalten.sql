-- Festival-Orga: Datenbank wachhalten
-- Supabase pausiert kostenlose Projekte ohne Datenbank-Aktivität. Ein reines Lesen zählt vermutlich nicht,
-- darum schreibt diese Funktion bei jedem Aufruf eine Zeile. Sie liefert nichts Internes zurück.
create table public.wachhalten (
  id int primary key default 1 check (id = 1),
  zuletzt timestamptz not null default now(),
  anzahl bigint not null default 0
);
alter table public.wachhalten enable row level security;
-- Keine Policy: von außen kommt niemand an die Tabelle, nur die Funktion darunter schreibt.

create function public.wachhalten() returns timestamptz
language sql security definer set search_path = public as $$
  insert into wachhalten (id, zuletzt, anzahl) values (1, now(), 1)
  on conflict (id) do update set zuletzt = now(), anzahl = wachhalten.anzahl + 1
  returning zuletzt
$$;
grant execute on function public.wachhalten() to anon, authenticated;
