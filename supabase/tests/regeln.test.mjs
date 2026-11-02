// Testet das Festival-Orga-Schema mit einer nachgebauten Supabase-Umgebung in PGlite
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

// Alle übergebenen Migrationen der Reihe nach
const migration = process.argv.slice(2).map(f => readFileSync(f, 'utf8')).join('\n')
  .replace("create extension if not exists pgcrypto with schema extensions;", '')
const db = new PGlite()

// Supabase nachbauen: Rollen, auth.users, auth.uid(), Standardrechte
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function extensions.gen_random_bytes(n int) returns bytea language sql volatile as $$
    select decode(string_agg(lpad(to_hex((random()*255)::int), 2, '0'), ''), 'hex') from generate_series(1, n) $$;
  grant usage on schema public, auth, extensions to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant execute on function extensions.gen_random_bytes(int) to public;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`)
await db.exec(migration)

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg) } }
// Als bestimmtes Gerät handeln
async function as(uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`)
  try { return await fn() } finally { await db.exec('reset role') }
}
const q = async (sql, params) => (await db.query(sql, params)).rows
const expectError = async (fn, msg) => { try { await fn(); ok(false, msg) } catch (e) { ok(true, `${msg} (${e.message.slice(0, 70)})`) } }

const U = n => `00000000-0000-0000-0000-00000000000${n}`
for (let i = 1; i <= 7; i++) await db.query('insert into auth.users values ($1)', [U(i)])

console.log('Einrichtung')
const codes = Object.fromEntries((await q("select * from public.create_collective('Testkollektiv')")).map(r => [r.art, r.code]))
ok(codes.admin && codes.crew && codes.helfer, `Codes erzeugt: ${JSON.stringify(codes)}`)
await expectError(() => as(U(1), () => q("select * from public.create_collective('Fremd')")), 'App darf kein Kollektiv anlegen')

console.log('Beitreten')
const info = await as(null, () => q('select * from public.invite_info($1)', [codes.helfer.toLowerCase()]))
ok(info[0]?.zugang === 'helfer' && info[0]?.kollektiv === 'Testkollektiv', 'invite_info ohne Anmeldung, Kleinschreibung egal')
const admin = (await as(U(1), () => q('select * from public.join_with_code($1, $2)', [codes.admin, 'Alex Admin'])))[0]
ok(admin.access === 'admin', 'Admin-Link macht zum Admin')
await expectError(() => as(U(2), () => q('select * from public.join_with_code($1, $2)', [codes.admin, 'Nochmal'])), 'Admin-Link gilt nur einmal')
const crew = (await as(U(2), () => q('select * from public.join_with_code($1, $2)', [codes.crew, 'Sam Crew'])))[0]
ok(crew.access === 'crew', 'Crew-Link macht zu Crew')
const helfer = (await as(U(3), () => q('select * from public.join_with_code($1, $2)', [codes.helfer, 'Jo Helfer'])))[0]
ok(helfer.access === 'helfer', 'Helfer:innen-Link macht zu Helfer:in')
await expectError(() => as(U(3), () => q('select * from public.join_with_code($1, $2)', [codes.helfer, 'Doppelt'])), 'Gerät kann nicht zweimal beitreten')
await expectError(() => as(U(4), () => q('select * from public.join_with_code($1, $2)', ['FALSCH12', 'X'])), 'Falscher Code wird abgelehnt')

const g = Object.fromEntries((await q('select name, id from public.gewerke')).map(r => [r.name, r.id]))
const inOrga = async id => (await q("select 1 from public.gewerk_members gm join public.gewerke g on g.id = gm.gewerk_id where gm.profile_id = $1 and g.kind = 'orga'", [id])).length === 1
ok(await inOrga(admin.id), 'Admin ist über den Link automatisch in der Gruppe Crew')
ok(await inOrga(crew.id), 'Crew ist über den Link automatisch in der Gruppe Crew')
ok(!(await inOrga(helfer.id)), 'Wer über den Helfer:innen-Link kommt, ist nicht automatisch in der Gruppe Crew')
// Crew ins Bar-Team, dann Bar-Link
await as(U(1), () => q('insert into public.gewerk_members values ($1, $2)', [g.Barschichten, crew.id]))
const barCode = (await as(U(2), () => q('select public.gewerk_invite($1) c', [g.Barschichten])))[0].c
const barHelfer = (await as(U(4), () => q('select * from public.join_with_code($1, $2)', [barCode, 'Lou Bar'])))[0]
const lm = await q('select * from public.gewerk_members where profile_id = $1', [barHelfer.id])
ok(lm.length === 1 && lm[0].gewerk_id === g.Barschichten, 'Bar-Link setzt direkt ins Bar-Team')
await expectError(() => as(U(2), () => q('select public.gewerk_invite($1)', [g.Crew])), 'Kein Helfer:innen-Link für die Gruppe Crew')
await expectError(() => as(U(3), () => q('select public.gewerk_invite($1)', [g.Aufbau])), 'Helfer:in darf keine Links erzeugen')

console.log('Rechte')
await as(U(3), async () => {
  const inv = await q('select * from public.invites')
  ok(inv.length === 0, 'Helfer:in sieht keine Einladungslinks')
  await q("update public.profiles set access = 'admin' where user_id = auth.uid()").then(() => ok(false, 'Helfer:in kann eigenen Zugang ändern'), e => ok(true, `Helfer:in kann eigenen Zugang nicht ändern (${e.message.slice(0, 40)})`))
  await q("update public.profiles set name = 'Jo Neu' where user_id = auth.uid()")
})
ok((await q('select name from public.profiles where id = $1', [helfer.id]))[0].name === 'Jo Neu', 'Eigenen Namen ändern geht')
await as(U(3), () => q("update public.profiles set name = 'Gehackt' where id = $1", [admin.id]))
ok((await q('select name from public.profiles where id = $1', [admin.id]))[0].name === 'Alex Admin', 'Fremden Namen ändern geht nicht')
await as(U(2), async () => {
  const inv = await q('select access from public.invites where gewerk_id is null')
  ok(inv.every(i => i.access === 'helfer') && inv.length === 1, 'Crew sieht nur den Helfer:innen-Link')
})
await expectError(() => as(U(2), () => q("select public.set_access($1, 'admin')", [helfer.id])), 'Crew darf keinen Zugang vergeben')
await expectError(() => as(U(3), () => q('insert into public.gewerk_members values ($1, $2)', [g.Aufbau, helfer.id])), 'Helfer:in kann sich nicht selbst in Teams holen')
await as(U(1), () => q('insert into public.gewerk_members values ($1, $2)', [g.Crew, helfer.id]))
ok(await inOrga(helfer.id), 'Admin kann eine Helfer:in in die Gruppe Crew holen')
await expectError(() => as(U(3), () => q("insert into public.tasks (collective_id, created_by, title) values ($1, public.my_profile_id(), 'x')", [admin.collective_id])), 'Wer in der Gruppe Crew ist, hat dadurch keine Crew-Rechte')
await as(U(1), () => q('delete from public.gewerk_members where gewerk_id = $1 and profile_id = $2', [g.Crew, helfer.id]))
await as(U(2), () => q('insert into public.gewerk_members values ($1, $2)', [g.Crew, barHelfer.id]))
ok(await inOrga(barHelfer.id), 'Crew-Leute holen Leute in die Gruppe Crew')
await expectError(() => as(U(4), () => q('insert into public.gewerk_members values ($1, $2)', [g.Crew, helfer.id])), 'Eine Helfer:in in der Gruppe Crew holt niemanden nach')
await as(U(2), () => q('delete from public.gewerk_members where gewerk_id = $1 and profile_id = $2', [g.Crew, barHelfer.id]))
await as(U(2), () => q('insert into public.gewerk_members values ($1, $2)', [g.DJs, helfer.id]))
ok((await q('select 1 from public.gewerk_members where gewerk_id = $1 and profile_id = $2', [g.DJs, helfer.id])).length === 1, 'Crew kann DJs festlegen')
await expectError(() => as(U(2), () => q('insert into public.gewerk_members values ($1, $2)', [g.Aufbau, helfer.id])), 'Crew kann nicht in fremde Bereiche holen')

console.log('Aufgaben')
const mk = (uid, title, gew, who = []) => as(uid, async () => {
  const t = (await q(`insert into public.tasks (collective_id, created_by, title, gewerk_id) values ($1, public.my_profile_id(), $2, $3) returning id`, [admin.collective_id, title, gew]))[0]
  for (const p of who) await q('insert into public.task_assignees (task_id, profile_id) values ($1, $2)', [t.id, p])
  return t.id
})
await expectError(() => mk(U(3), 'Helfer legt an', g.Barschichten), 'Helfer:in kann keine Aufgaben anlegen')
const tJo = await mk(U(2), 'Für Jo', g.Barschichten, [helfer.id])
const tLou = await mk(U(2), 'Für Lou', g.Barschichten, [barHelfer.id])
const tOffenBar = await mk(U(2), 'Offen Bar', g.Barschichten)
const tOffenAufbau = await mk(U(1), 'Offen Aufbau', g.Aufbau)
const seenBy = async uid => (await as(uid, () => q('select title from public.tasks order by title'))).map(r => r.title)
ok(JSON.stringify(await seenBy(U(3))) === JSON.stringify(['Für Jo']), `Jo sieht nur die eigene: ${await seenBy(U(3))}`)
ok(JSON.stringify(await seenBy(U(4))) === JSON.stringify(['Für Lou', 'Offen Bar']), `Lou sieht eigene + offene aus der Bar: ${await seenBy(U(4))}`)
ok((await seenBy(U(2))).length === 4, 'Crew sieht alle')

await as(U(3), () => q('update public.tasks set done = true where id = $1', [tJo]))
ok(!(await q('select done from public.tasks where id = $1', [tJo]))[0].done, 'Zuständige Helfer:in kann nicht selbst abhaken')
await as(U(3), () => q('select public.report_task_done($1)', [tJo]))
ok((await q('select reported_done from public.task_assignees where task_id = $1', [tJo]))[0].reported_done, '„Ich bin fertig“ wird gespeichert')
await expectError(() => as(U(4), () => q('select public.report_task_done($1)', [tJo])), 'Fremde können nicht fertig melden')
await as(U(2), () => q('update public.tasks set done = true where id = $1', [tJo]))
ok((await q('select done from public.tasks where id = $1', [tJo]))[0].done, 'Ersteller:in kann abhaken')
await as(U(1), () => q('update public.tasks set done = false where id = $1', [tJo]))
ok(!(await q('select done from public.tasks where id = $1', [tJo]))[0].done, 'Admin kann abhaken')
await expectError(() => as(U(4), () => q('select public.claim_task($1)', [tOffenAufbau])), 'Übernehmen nur aus eigenen Bereichen')
await as(U(4), () => q('select public.claim_task($1)', [tOffenBar]))
ok((await q('select claimed from public.task_assignees where task_id = $1 and profile_id = $2', [tOffenBar, barHelfer.id]))[0]?.claimed, 'Lou übernimmt offene Bar-Aufgabe')
await expectError(() => as(U(1), () => q('select public.claim_task($1)', [tOffenBar])), 'Vergebene Aufgabe kann man nicht übernehmen')

console.log('Zugang ändern und Gruppe Crew')
await as(U(1), () => q("select public.set_access($1, 'crew')", [barHelfer.id]))
ok(await inOrga(barHelfer.id), 'Wer zur Crew wird, kommt in die Gruppe Crew')
await as(U(1), () => q("select public.set_access($1, 'helfer')", [barHelfer.id]))
ok(await inOrga(barHelfer.id), 'Wer wieder Helfer:in wird, bleibt in der Gruppe Crew, bis jemand ihn herausnimmt')
await as(U(1), () => q('delete from public.gewerk_members where gewerk_id = $1 and profile_id = $2', [g.Crew, barHelfer.id]))
ok((await q('select 1 from public.gewerk_members where profile_id = $1 and gewerk_id = $2', [barHelfer.id, g.Barschichten])).length === 1, 'Andere Bereiche bleiben dabei unberührt')

console.log('Wiederanmelden')
await expectError(() => as(U(3), () => q('select public.create_relogin_link($1)', [helfer.id])), 'Helfer:in kann keine Wiederanmelde-Links erzeugen')
const tok = (await as(U(2), () => q('select public.create_relogin_link($1) t', [helfer.id])))[0].t
ok((await as(U(3), () => q('select * from public.relogin_tokens'))).length === 0, 'Wiederanmelde-Links sind nicht direkt lesbar')
const claimed = (await as(U(5), () => q('select * from public.claim_relogin($1)', [tok.toLowerCase()])))[0]
ok(claimed.id === helfer.id, 'Neues Gerät übernimmt das Profil')
ok((await seenBy(U(5))).includes('Für Jo'), 'Auf dem neuen Gerät sind die Aufgaben da')
ok((await seenBy(U(3))).length === 0, 'Altes Gerät ist abgemeldet')
await expectError(() => as(U(6), () => q('select * from public.claim_relogin($1)', [tok])), 'Link gilt nur einmal')
await db.exec(`insert into public.relogin_tokens values ('ABGELAUFEN', '${helfer.id}', null, now() - interval '1 hour', null)`)
await expectError(() => as(U(6), () => q('select * from public.claim_relogin($1)', ['ABGELAUFEN'])), 'Abgelaufener Link wird abgelehnt')

console.log('Festivaltage')
const JO = U(5) // Jo ist nach dem Wiederanmelden auf Gerät 5
await as(U(1), () => q("update public.collectives set fest_start = '2027-07-16', fest_days = 3"))
ok((await q('select fest_start::text f from public.collectives'))[0].f === '2027-07-16', 'Admin stellt die Festivaltage ein')
await as(U(2), () => q("update public.collectives set fest_days = 9"))
ok((await q('select fest_days from public.collectives'))[0].fest_days === 3, 'Crew kann die Festivaltage nicht ändern')

console.log('Schichten')
const mkShift = (uid, area, gew, need = 2) => as(uid, async () =>
  (await q('insert into public.shifts (collective_id, gewerk_id, area, day, start_time, end_time, need) values ($1, $2, $3, 0, $4, $5, $6) returning id',
    [admin.collective_id, gew, area, '18:00', '22:00', need]))[0].id)
const sBar = await mkShift(U(2), 'Bar', g.Barschichten, 2)
ok(!!sBar, 'Crew plant eine Schicht im eigenen Bereich')
await expectError(() => mkShift(U(2), 'Aufbau', g.Aufbau), 'Crew plant keine Schicht in fremden Bereichen')
await expectError(() => mkShift(JO, 'Bar', g.Barschichten), 'Helfer:in kann keine Schichten anlegen')
const sAware = await mkShift(U(2), 'Awareness', null, 1)
ok(!!sAware, 'Schicht ohne Bereich plant jede Crew')
ok((await as(JO, () => q('select id from public.shifts'))).length === 2, 'Helfer:in sieht alle Schichten (Tagesübersicht)')
await as(JO, () => q('select public.join_shift($1)', [sAware]))
ok((await q('select 1 from public.shift_members where shift_id = $1 and profile_id = $2', [sAware, helfer.id])).length === 1, 'Helfer:in trägt sich selbst ein')
await expectError(() => as(U(4), () => q('select public.join_shift($1)', [sAware])), 'Volle Schicht nimmt niemanden mehr')
await expectError(() => as(JO, () => q('insert into public.shift_members values ($1, $2)', [sBar, barHelfer.id])), 'Helfer:in kann keine anderen eintragen')
await as(U(2), () => q('insert into public.shift_members values ($1, $2)', [sBar, barHelfer.id]))
ok((await q('select 1 from public.shift_members where shift_id = $1 and profile_id = $2', [sBar, barHelfer.id])).length === 1, 'Crew teilt jemanden zu')
await as(JO, () => q('delete from public.shift_members where shift_id = $1 and profile_id = $2', [sBar, barHelfer.id]))
ok((await q('select 1 from public.shift_members where shift_id = $1 and profile_id = $2', [sBar, barHelfer.id])).length === 1, 'Helfer:in kann andere nicht austragen')
await as(JO, () => q('delete from public.shift_members where shift_id = $1 and profile_id = $2', [sAware, helfer.id]))
ok((await q('select 1 from public.shift_members where shift_id = $1 and profile_id = $2', [sAware, helfer.id])).length === 0, 'Helfer:in trägt sich selbst aus')

console.log('Line-up und DJ-Infos')
await expectError(() => as(JO, () => q("insert into public.lineup_slots (collective_id, day, start_time, end_time, profile_id) values ($1, 0, '22:00', '23:30', $2)", [admin.collective_id, helfer.id])), 'Helfer:in plant kein Line-up')
await as(U(2), () => q("insert into public.lineup_slots (collective_id, day, start_time, end_time, profile_id) values ($1, 0, '22:00', '23:30', $2)", [admin.collective_id, helfer.id]))
ok((await as(U(4), () => q('select id from public.lineup_slots'))).length === 1, 'Crew plant Slot, alle sehen ihn')
await as(JO, () => q("select public.set_act($1, 'DJ Jo', 'Techno')", [helfer.id]))
ok((await q('select act_genre from public.profiles where id = $1', [helfer.id]))[0].act_genre === 'Techno', 'DJ ändert eigene Infos')
await expectError(() => as(U(4), () => q("select public.set_act($1, 'Fake', 'Schlager')", [helfer.id])), 'Andere Helfer:in ändert keine fremden DJ-Infos')
await as(U(2), () => q("select public.set_act($1, '', 'House')", [helfer.id]))
const act = (await q('select act_name, act_genre from public.profiles where id = $1', [helfer.id]))[0]
ok(act.act_name === null && act.act_genre === 'House', 'Crew ändert DJ-Infos, leerer Name wird entfernt')

console.log('Termine')
await expectError(() => as(JO, () => q("insert into public.events (collective_id, date, title) values ($1, '2026-11-20', 'Treffen')", [admin.collective_id])), 'Helfer:in legt keine Termine an')
await as(U(2), () => q("insert into public.events (collective_id, date, title) values ($1, '2026-11-20', 'Orga-Treffen')", [admin.collective_id]))
ok((await as(JO, () => q('select title from public.events'))).length === 1, 'Crew legt Termin an, alle sehen ihn')

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`)
process.exit(fail ? 1 : 0)
