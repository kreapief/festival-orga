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
for (let i = 1; i <= 9; i++) await db.query('insert into auth.users values ($1)', [U(i)])

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
await expectError(() => as(U(9), () => q('select * from public.join_with_code($1, $2)', [codes.helfer, ' jo HELFER '])), 'Gleicher Name (auch anders geschrieben) wird abgelehnt')
await expectError(() => as(U(4), () => q('select * from public.join_with_code($1, $2)', ['FALSCH12', 'X'])), 'Falscher Code wird abgelehnt')

const g = Object.fromEntries((await q('select name, id from public.gewerke')).map(r => [r.name, r.id]))
const inOrga = async id => (await q("select 1 from public.gewerk_members gm join public.gewerke g on g.id = gm.gewerk_id where gm.profile_id = $1 and g.kind = 'orga'", [id])).length === 1
ok(await inOrga(admin.id), 'Admin ist über den Link automatisch in der Gruppe Orga')
ok(await inOrga(crew.id), 'Crew ist über den Link automatisch in der Gruppe Orga')
ok(!(await inOrga(helfer.id)), 'Wer über den Helfer:innen-Link kommt, ist nicht automatisch in der Gruppe Orga')
// Crew ins Bar-Team, dann Bar-Link
await as(U(1), () => q('insert into public.gewerk_members values ($1, $2)', [g.Barschichten, crew.id]))
const barCode = (await as(U(2), () => q('select public.gewerk_invite($1) c', [g.Barschichten])))[0].c
const barHelfer = (await as(U(4), () => q('select * from public.join_with_code($1, $2)', [barCode, 'Lou Bar'])))[0]
const lm = await q('select * from public.gewerk_members where profile_id = $1', [barHelfer.id])
ok(lm.length === 1 && lm[0].gewerk_id === g.Barschichten, 'Bar-Link setzt direkt ins Bar-Team')
await expectError(() => as(U(2), () => q('select public.gewerk_invite($1)', [g.Orga])), 'Kein Helfer:innen-Link für die Gruppe Orga')
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
await as(U(1), () => q('insert into public.gewerk_members values ($1, $2)', [g.Orga, helfer.id]))
ok(await inOrga(helfer.id), 'Admin kann eine Helfer:in in die Gruppe Orga holen')
await expectError(() => as(U(3), () => q("insert into public.tasks (collective_id, created_by, title) values ($1, public.my_profile_id(), 'x')", [admin.collective_id])), 'Wer in der Gruppe Orga ist, hat dadurch keine Crew-Rechte')
await as(U(1), () => q('delete from public.gewerk_members where gewerk_id = $1 and profile_id = $2', [g.Orga, helfer.id]))
await as(U(2), () => q('insert into public.gewerk_members values ($1, $2)', [g.Orga, barHelfer.id]))
ok(await inOrga(barHelfer.id), 'Crew-Leute holen Leute in die Gruppe Orga')
await expectError(() => as(U(4), () => q('insert into public.gewerk_members values ($1, $2)', [g.Orga, helfer.id])), 'Eine Helfer:in in der Gruppe Orga holt niemanden nach')
await as(U(2), () => q('delete from public.gewerk_members where gewerk_id = $1 and profile_id = $2', [g.Orga, barHelfer.id]))
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

console.log('Zugang ändern und Gruppe Orga')
await as(U(1), () => q("select public.set_access($1, 'crew')", [barHelfer.id]))
ok(await inOrga(barHelfer.id), 'Wer zur Crew wird, kommt in die Gruppe Orga')
await as(U(1), () => q("select public.set_access($1, 'helfer')", [barHelfer.id]))
ok(await inOrga(barHelfer.id), 'Wer wieder Helfer:in wird, bleibt in der Gruppe Orga, bis jemand ihn herausnimmt')
await as(U(1), () => q('delete from public.gewerk_members where gewerk_id = $1 and profile_id = $2', [g.Orga, barHelfer.id]))
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

console.log('Aufgaben-Archiv')
await as(U(2), () => q('update public.tasks set done = true where id = $1', [tLou]))
ok((await q('select done_at from public.tasks where id = $1', [tLou]))[0].done_at !== null, 'Beim Abhaken wird das Datum gemerkt')
await as(U(2), () => q('update public.tasks set done = false where id = $1', [tLou]))
ok((await q('select done_at from public.tasks where id = $1', [tLou]))[0].done_at === null, 'Beim Wieder-Öffnen wird es gelöscht')

console.log('Chat')
const say = (uid, ch, body, asProfile) => as(uid, () => q('insert into public.messages (collective_id, channel, profile_id, body) values ($1, $2, ' + (asProfile ? '$4' : 'public.my_profile_id()') + ', $3)', asProfile ? [admin.collective_id, ch, body, asProfile] : [admin.collective_id, ch, body]))
await say(JO, 'helfer', 'Hallo alle')
ok(true, 'Helfer:in schreibt im Helfer:innen-Raum')
await say(U(4), g.Barschichten, 'Bar-Nachricht')
await say(JO, g.DJs, 'DJ-Nachricht')
await expectError(() => say(JO, g.Barschichten, 'darf ich nicht'), 'Helfer:in schreibt nicht in fremdem Bereichs-Raum')
await expectError(() => say(JO, 'helfer', 'als Admin getarnt', admin.id), 'Niemand schreibt im Namen anderer')
await expectError(() => say(JO, 'gibt-es-nicht', 'x'), 'Unbekannte Räume gibt es nicht')
const chans = async uid => (await as(uid, () => q('select distinct channel from public.messages order by channel'))).map(r => r.channel)
const cJo = await chans(JO), cLou = await chans(U(4))
ok(cJo.length === 2 && cJo.every(c => c === 'helfer' || c === g.DJs), 'Helfer:in liest nur Helfer:innen-Raum und eigene Bereiche')
ok(cLou.includes(g.Barschichten) && !cLou.includes(g.DJs), 'Bar-Helfer:in liest die Bar, aber nicht die DJs')
await say(U(2), g.Aufbau, 'Crew schreibt auch in fremdem Bereich')
ok((await chans(U(2))).length === 4, 'Crew liest und schreibt in jedem Raum')
const ov = async uid => Object.fromEntries((await as(uid, () => q('select * from public.chat_overview()'))).map(r => [r.channel, r]))
const ovLou = await ov(U(4))
ok(Object.keys(ovLou).length === 2 && ovLou.helfer.unread == 1 && ovLou[g.Barschichten].unread == 0, 'Raumliste: eigene Räume, ungelesen ohne eigene Nachrichten')
ok(ovLou.helfer.last_name === 'Jo Neu' && ovLou.helfer.last_body === 'Hallo alle', 'Raumliste zeigt letzte Nachricht mit Namen')
ok(Object.keys(await ov(U(1))).length === 13, 'Admin sieht alle 13 Räume')
await as(U(4), () => q('select public.mark_read($1, now())', ['helfer']))
ok((await ov(U(4))).helfer.unread == 0, 'Als gelesen markieren setzt die Zahl auf 0')
await say(JO, 'helfer', 'Noch eine')
ok((await ov(U(4))).helfer.unread == 1, 'Eine neue Nachricht zählt wieder')
await expectError(() => as(U(4), () => q('select public.mark_read($1, now())', [g.DJs])), 'Fremde Räume lassen sich nicht als gelesen markieren')
await as(JO, () => q("delete from public.messages where body = 'Noch eine'"))
ok((await q("select 1 from public.messages where body = 'Noch eine'")).length === 0, 'Eigene Nachricht löschen geht')
await as(U(4), () => q("delete from public.messages where body = 'Hallo alle'"))
ok((await q("select 1 from public.messages where body = 'Hallo alle'")).length === 1, 'Fremde Nachricht löschen geht nicht')
await as(U(1), () => q("delete from public.messages where body = 'Hallo alle'"))
ok((await q("select 1 from public.messages where body = 'Hallo alle'")).length === 0, 'Admin löscht jede Nachricht')

console.log('Ordner (Drive-Links)')
const names = async uid => (await as(uid, () => q('select name from public.folders order by sort'))).map(r => r.name).join(', ')
ok(await names(JO) === 'Fotos', 'Helfer:in sieht nur den Fotoordner')
ok(await names(U(2)) === 'Fotos, Orga-Ordner', 'Crew sieht Foto- und Orga-Ordner')
await as(U(2), () => q("update public.folders set url = 'https://drive.google.com/x' where name = 'Fotos'"))
ok((await q("select url from public.folders where name = 'Fotos'"))[0].url === null, 'Crew kann Ordner-Links nicht ändern')
await as(U(1), () => q("update public.folders set url = 'https://drive.google.com/drive/folders/abc' where name = 'Orga-Ordner'"))
ok((await q("select url from public.folders where name = 'Orga-Ordner'"))[0].url?.startsWith('https://'), 'Admin trägt den Link ein')
ok(!(await as(JO, () => q('select url from public.folders'))).some(r => r.url?.includes('abc')), 'Der Orga-Link bleibt vor Helfer:innen verborgen')
await expectError(() => as(U(1), () => q("update public.folders set url = 'http://unsicher.de' where name = 'Fotos'")), 'Nur sichere https-Links werden angenommen')
await expectError(() => as(U(1), () => q("update public.folders set url = 'javascript:alert(1)' where name = 'Fotos'")), 'Keine Skript-Links')
await q("select * from public.create_collective('Zweit-Kollektiv')")
ok((await q("select count(*) n from public.folders f join public.collectives c on c.id = f.collective_id where c.name = 'Zweit-Kollektiv'"))[0].n == 2, 'Neue Kollektive bekommen automatisch beide Ordner')

console.log('Mitteilungen')
const notes = async uid => (await as(uid, () => q('select body, link, read_at from public.notifications order by created_at'))).map(r => r)
const lastBodies = async (uid, n = 20) => (await notes(uid)).map(r => r.body).slice(-n)
await q("delete from public.notifications")
// Schicht: Crew teilt Lou ein
const nSh = (await as(U(2), () => q('insert into public.shifts (collective_id, gewerk_id, area, day, start_time, end_time, need) values ($1, $2, $3, 1, $4, $5, 2) returning id', [admin.collective_id, g.Barschichten, 'Bar Nacht', '22:00', '23:59'])))[0].id
await as(U(2), () => q('insert into public.shift_members values ($1, $2)', [nShHelper(), barHelfer.id]))
function nShHelper() { return nSh }
let b = await lastBodies(U(4))
ok(b.length === 1 && b[0].startsWith('Du bist eingeteilt: Bar Nacht, Sa 17.07. 22:00–23:59 Uhr'), 'Eingeteilt: Meldung mit Tag und Uhrzeit (' + b[0] + ')')
ok((await notes(U(4)))[0].link === 'schichten', 'Die Meldung führt zu den Schichten')
// Selbst eintragen: keine Meldung an sich selbst
await as(JO, () => q('select public.join_shift($1)', [nSh]))
ok((await lastBodies(JO)).length === 0, 'Wer sich selbst einträgt, bekommt keine Meldung')
// Ändern: alle in der Schicht bekommen eine Meldung
await as(U(2), () => q("update public.shifts set start_time = '21:00' where id = $1", [nSh]))
ok((await lastBodies(U(4))).at(-1)?.startsWith('Deine Schicht wurde geändert: Bar Nacht'), 'Geänderte Schicht: Meldung an Eingeteilte')
ok((await lastBodies(JO)).at(-1)?.startsWith('Deine Schicht wurde geändert'), 'Auch wer sich selbst eingetragen hat, erfährt von der Änderung')
await as(U(2), () => q("update public.shifts set need = 5 where id = $1", [nSh]))
ok((await lastBodies(U(4))).length === 2, 'Unwichtige Änderung (Personenzahl) löst keine Meldung aus')
// Herausnehmen
await as(U(2), () => q('delete from public.shift_members where shift_id = $1 and profile_id = $2', [nSh, barHelfer.id]))
ok((await lastBodies(U(4))).at(-1)?.startsWith('Du wurdest aus der Schicht genommen'), 'Herausgenommen: Meldung')
// Löschen: genau eine Meldung, keine doppelte
const before = (await notes(JO)).length
await as(U(2), () => q('delete from public.shifts where id = $1', [nSh]))
const afterJo = (await lastBodies(JO)).slice(before)
ok(afterJo.length === 1 && afterJo[0].startsWith('Deine Schicht wurde gelöscht'), 'Gelöschte Schicht: genau eine Meldung (' + afterJo.join(' | ') + ')')

// Timetable
await q("delete from public.notifications")
const slot = (await as(U(2), () => q("insert into public.lineup_slots (collective_id, day, start_time, end_time, profile_id) values ($1, 2, '20:00', '21:30', $2) returning id", [admin.collective_id, helfer.id])))[0].id
ok((await lastBodies(JO)).at(-1)?.startsWith('Du stehst im Timetable: So 18.07. 20:00–21:30 Uhr'), 'Neuer Slot: Meldung an den DJ')
await as(U(2), () => q("update public.lineup_slots set start_time = '20:30' where id = $1", [slot]))
ok((await lastBodies(JO)).at(-1)?.startsWith('Dein Slot im Timetable wurde geändert'), 'Slot verschoben: Meldung')
await as(U(2), () => q('delete from public.lineup_slots where id = $1', [slot]))
ok((await lastBodies(JO)).at(-1)?.startsWith('Dein Slot im Timetable wurde gelöscht'), 'Slot gelöscht: Meldung')

// Aufgaben
await q("delete from public.notifications")
const t1 = await mk(U(2), 'Mitteilungs-Aufgabe', g.Barschichten, [barHelfer.id])
ok((await lastBodies(U(4))).at(-1) === 'Dir wurde eine Aufgabe zugeteilt: Mitteilungs-Aufgabe', 'Aufgabe zugeteilt: Meldung')
await as(U(4), () => q('select public.report_task_done($1)', [t1]))
ok((await lastBodies(U(2))).at(-1) === 'Lou Bar hat die Aufgabe als fertig gemeldet: Mitteilungs-Aufgabe', 'Fertig gemeldet: Meldung an die Ersteller:in')
await as(U(2), () => q('update public.tasks set done = true where id = $1', [t1]))
ok((await lastBodies(U(4))).at(-1) === 'Aufgabe als erledigt abgehakt: Mitteilungs-Aufgabe', 'Abgehakt: Meldung an die Zuständigen')
const open = await mk(U(2), 'Offene Mitteilungs-Aufgabe', g.Barschichten)
await as(U(4), () => q('select public.claim_task($1)', [open]))
ok((await lastBodies(U(2))).at(-1) === 'Lou Bar hat die Aufgabe übernommen: Offene Mitteilungs-Aufgabe', 'Übernommen: Meldung an die Ersteller:in')
await as(U(2), () => q('delete from public.tasks where id = $1', [open]))
ok((await lastBodies(U(4))).at(-1) === 'Eine Aufgabe von dir wurde gelöscht: Offene Mitteilungs-Aufgabe', 'Aufgabe gelöscht: genau eine Meldung')
ok((await lastBodies(U(4))).filter(x => x.includes('Offene Mitteilungs-Aufgabe')).length === 1, 'Beim Löschen keine zusätzliche „ausgetragen“-Meldung')

// Team und Zugang
await q("delete from public.notifications")
await as(U(1), () => q("select public.set_access($1, 'crew')", [barHelfer.id]))
const lb = await lastBodies(U(4))
ok(lb.includes('Dein Zugang ist jetzt: Crew') && lb.some(x => x.startsWith('Du bist jetzt im Team Orga')), 'Zugang geändert: Meldung, und die Gruppe Orga')
await as(U(1), () => q("select public.set_access($1, 'helfer')", [barHelfer.id]))
await as(U(1), () => q('delete from public.gewerk_members where gewerk_id = $1 and profile_id = $2', [g.Orga, barHelfer.id]))

// Datenschutz: nur die eigenen
const mine = await as(U(2), () => q('select profile_id from public.notifications'))
ok(mine.every(r => r.profile_id === crew.id), 'Man sieht nur die eigenen Mitteilungen')
await expectError(() => as(U(2), () => q("insert into public.notifications (collective_id, profile_id, body) values ($1, $2, 'Fälschung')", [admin.collective_id, crew.id])), 'Niemand kann sich Mitteilungen selbst anlegen')
const own = (await as(U(2), () => q('select id from public.notifications limit 1')))[0]
if (own) {
  await as(U(2), () => q('update public.notifications set read_at = now() where id = $1', [own.id]))
  ok((await q('select read_at from public.notifications where id = $1', [own.id]))[0].read_at !== null, 'Als gelesen markieren geht')
  await expectError(() => as(U(2), () => q("update public.notifications set body = 'umgeschrieben' where id = $1", [own.id])), 'Der Text lässt sich nicht ändern')
}
const foreign = (await q('select id from public.notifications where profile_id <> $1 limit 1', [crew.id]))[0]
if (foreign) {
  await as(U(2), () => q('update public.notifications set read_at = now() where id = $1', [foreign.id]))
  ok((await q('select read_at from public.notifications where id = $1', [foreign.id]))[0].read_at === null, 'Fremde Mitteilungen lassen sich nicht abhaken')
}

console.log('Getränkemarken')
await q("delete from public.notifications")
const tokOf = async uid => (await as(uid, () => q('select * from public.my_tokens()')))[0]
ok((await tokOf(JO)).total === 3, 'Wer bei den DJs ist, bekommt 3 Marken (höchste Zahl gewinnt)')
ok((await tokOf(U(4))).total === 1 && (await tokOf(U(4))).used === 0, 'Helfer:in bekommt 1 Marke, noch keine eingelöst')
const redeem = uid => as(uid, () => q('select public.redeem_token() as t'))
const at = (await redeem(U(4)))[0].t
ok(at instanceof Date || typeof at === 'string', 'Einlösen gibt den Zeitpunkt zurück')
ok((await tokOf(U(4))).used === 1, 'Danach ist 1 Marke eingelöst')
await expectError(() => redeem(U(4)), 'Mehr als erlaubt lässt sich nicht einlösen')
await redeem(JO); await redeem(JO); await redeem(JO)
await expectError(() => redeem(JO), 'Auch bei 3 Marken ist bei der vierten Schluss')
ok((await as(U(4), () => q('select * from public.token_redemptions'))).length === 1, 'Man sieht nur die eigenen Einlösungen')
ok((await as(U(2), () => q('select * from public.token_redemptions'))).length === 4, 'Crew sieht alle Einlösungen (Protokoll)')
await expectError(() => as(U(4), () => q('insert into public.token_redemptions (collective_id, profile_id) values ($1, $2)', [admin.collective_id, barHelfer.id])), 'Einlösungen lassen sich nicht selbst anlegen')
await expectError(() => as(U(4), () => q('select public.refund_token($1)', [barHelfer.id])), 'Helfer:in gibt sich keine Marke zurück')
await as(U(2), () => q('select public.refund_token($1)', [barHelfer.id]))
ok((await tokOf(U(4))).used === 0, 'Crew gibt eine Marke zurück')
ok((await lastBodies(U(4))).at(-1) === 'Dir wurde eine Getränkemarke zurückgegeben', 'Rückgabe: Meldung an die Person')
await expectError(() => as(U(2), () => q('select public.refund_token($1)', [barHelfer.id])), 'Ohne eingelöste Marke gibt es nichts zurückzugeben')
ok((await as(U(2), () => q('select * from public.person_tokens($1)', [barHelfer.id]))).length === 1, 'Crew sieht Zahl und Stand einer Person')
ok((await as(U(4), () => q('select * from public.person_tokens($1)', [helfer.id]))).length === 0, 'Helfer:in sieht den Stand anderer nicht')
await expectError(() => as(U(2), () => q('select public.set_tokens($1, 9)', [barHelfer.id])), 'Crew setzt keine persönliche Zahl')
await as(U(1), () => q('select public.set_tokens($1, 5)', [barHelfer.id]))
ok((await tokOf(U(4))).total === 5, 'Admin setzt eine persönliche Zahl')
await as(U(1), () => q('select public.set_tokens($1, null)', [barHelfer.id]))
ok((await tokOf(U(4))).total === 1, 'Ohne persönliche Zahl gilt wieder Zugang und Bereich')
await as(U(1), () => q('update public.collectives set tokens_helfer = 2'))
ok((await tokOf(U(4))).total === 2, 'Admin ändert die Zahl für alle Helfer:innen')
await as(U(2), () => q('update public.collectives set tokens_helfer = 9'))
ok((await tokOf(U(4))).total === 2, 'Crew kann die Zahlen nicht ändern')
await as(U(1), () => q('update public.collectives set tokens_helfer = 1'))
await as(U(1), () => q('update public.gewerke set tokens = 4 where id = $1', [g.Barschichten]))
ok((await tokOf(U(4))).total === 4, 'Zahl pro Bereich: Bar-Helfer:in bekommt 4')
await as(U(1), () => q('update public.gewerke set tokens = 0 where id = $1', [g.Barschichten]))

console.log('Aufgaben für alle')
const mkAll = (title, gew) => as(U(2), async () => (await q('insert into public.tasks (collective_id, created_by, title, gewerk_id) values ($1, public.my_profile_id(), $2, $3) returning id', [admin.collective_id, title, gew]))[0].id)
const tAll = await mkAll('Für alle: Tische tragen', null)
const tAufbau = await mkAll('Nur Aufbau: Kabel', g.Aufbau)
const tOrga = await mkAll('Nur Orga: Budget', g.Orga)
const titlesOf = async uid => (await as(uid, () => q('select title from public.tasks'))).map(r => r.title)
ok((await titlesOf(JO)).includes('Für alle: Tische tragen'), 'Helfer:in sieht eine offene Aufgabe „an alle“')
ok(!(await titlesOf(JO)).includes('Nur Aufbau: Kabel') && !(await titlesOf(JO)).includes('Nur Orga: Budget'), 'Helfer:in sieht keine Aufgaben fremder Bereiche')
ok((await titlesOf(U(4))).includes('Für alle: Tische tragen') && !(await titlesOf(U(4))).includes('Nur Orga: Budget'), 'Auch andere Helfer:innen sehen nur „an alle“ und ihre Bereiche')
await as(JO, () => q('select public.claim_task($1)', [tAll]))
ok((await q('select claimed from public.task_assignees where task_id = $1 and profile_id = $2', [tAll, helfer.id]))[0]?.claimed, 'Helfer:in übernimmt eine Aufgabe „an alle“')
await expectError(() => as(U(4), () => q('select public.claim_task($1)', [tAll])), 'Danach ist sie für andere vergeben')
ok(!(await titlesOf(U(4))).includes('Für alle: Tische tragen'), 'Und für andere nicht mehr offen sichtbar')
await expectError(() => as(JO, () => q('select public.claim_task($1)', [tOrga])), 'Eine Orga-Aufgabe lässt sich nicht übernehmen')
ok((await titlesOf(U(2))).length >= 3, 'Crew sieht alle Aufgaben')
await q('delete from public.tasks where id in ($1, $2, $3)', [tAll, tAufbau, tOrga])

console.log('Timetable ohne Konto')
const freeSlot = (await as(U(2), () => q("insert into public.lineup_slots (collective_id, day, start_time, end_time, profile_id, act_name, act_genre) values ($1, 0, '19:00', '20:00', null, 'DJ Ohne Konto', 'Dub') returning id", [admin.collective_id])))[0].id
ok(!!freeSlot, 'Crew trägt einen Namen ohne Konto ein')
await expectError(() => as(U(2), () => q("insert into public.lineup_slots (collective_id, day, start_time, end_time) values ($1, 0, '19:00', '20:00')", [admin.collective_id])), 'Ein Slot braucht einen Namen oder ein Konto')
await expectError(() => as(U(2), () => q("insert into public.lineup_slots (collective_id, day, start_time, end_time, act_name) values ($1, 0, '19:00', '20:00', '   ')", [admin.collective_id])), 'Ein leerer Name zählt nicht')
await expectError(() => as(JO, () => q("insert into public.lineup_slots (collective_id, day, start_time, end_time, act_name) values ($1, 0, '19:00', '20:00', 'Hacker')", [admin.collective_id])), 'Helfer:in trägt keine Slots ein')
ok((await as(JO, () => q('select act_name from public.lineup_slots where id = $1', [freeSlot])))[0].act_name === 'DJ Ohne Konto', 'Alle sehen den Namen im Timetable')
await as(U(2), () => q("update public.lineup_slots set start_time = '19:30' where id = $1", [freeSlot]))
ok(true, 'Ein Slot ohne Konto lässt sich ändern (keine Meldung an niemanden)')
await as(U(2), () => q('update public.lineup_slots set profile_id = $2 where id = $1', [freeSlot, helfer.id]))
ok((await as(JO, () => q('select profile_id from public.lineup_slots where id = $1', [freeSlot])))[0].profile_id === helfer.id, 'Später lässt sich das Konto verknüpfen')
await as(U(2), () => q('update public.lineup_slots set profile_id = null where id = $1', [freeSlot]))

console.log('Gäste-Seite')
const gp = async () => (await as(null, () => q('select public.guest_page() as g')))[0].g
let g1 = await gp()
ok(g1.name === 'Testkollektiv' && Array.isArray(g1.slots) && Array.isArray(g1.packlist), 'Ohne Konto lässt sich die Gäste-Seite abrufen')
ok(g1.fotos.length === 0, 'Ohne freigegebenen Link keine Fotos')
ok(g1.slots.some(sl => sl.name === 'DJ Ohne Konto' && sl.genre === 'Dub'), 'Ein Name ohne Konto erscheint auf der Gäste-Seite')
await as(U(1), () => q("update public.folders set url = 'https://drive.google.com/fotos', guest_visible = true where name = 'Fotos'"))
await as(U(1), () => q("update public.collectives set guest_text = 'Willkommen!', guest_packlist = array['Zelt', 'Becher']"))
g1 = await gp()
ok(g1.fotos.length === 1 && g1.fotos[0].url === 'https://drive.google.com/fotos', 'Freigegebener Foto-Link erscheint')
ok(g1.text === 'Willkommen!' && g1.packlist.length === 2, 'Text und Packliste erscheinen')
ok(!JSON.stringify(g1).includes('abc'), 'Der Orga-Ordner erscheint nie')
await expectError(() => as(U(1), () => q("update public.folders set guest_visible = true where name = 'Orga-Ordner'")), 'Ein Crew-Ordner lässt sich nicht für Gäste freigeben')
ok((await as(null, () => q('select * from public.profiles'))).length === 0, 'Ohne Konto sieht man keine Personen')
ok((await as(null, () => q('select * from public.tasks'))).length === 0, 'Ohne Konto sieht man keine Aufgaben')
ok((await as(null, () => q('select * from public.invites'))).length === 0, 'Ohne Konto sieht man keine Einladungscodes')
ok(!JSON.stringify(g1).includes('user_id') && !JSON.stringify(g1).includes(admin.id), 'Die Gäste-Seite enthält keine Konto-Kennungen')
await as(U(2), () => q("update public.collectives set guest_text = 'Gehackt'"))
ok((await gp()).text === 'Willkommen!', 'Crew kann den Gäste-Text nicht ändern')

console.log('Namen')
const jo2 = (await as(U(9), () => q('select * from public.join_with_code($1, $2)', [codes.helfer, 'Jo H.'])))[0]
ok(jo2.name === 'Jo H.', 'Mit Zusatz geht derselbe Vorname')
await expectError(() => as(U(9), () => q("update public.profiles set name = 'alex admin' where user_id = $1", [U(9)])), 'Umbenennen auf einen vergebenen Namen geht nicht')

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`)
process.exit(fail ? 1 : 0)
