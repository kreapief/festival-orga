// Nur für die Entwicklung (npm run dev, Adresse mit ?demo=helfer|crew|admin):
// ersetzt Supabase durch Beispieldaten im Browser, damit man die Oberfläche ohne Datenbank durchklicken kann.
// Rechte prüft der Demo-Modus nicht, die stecken in der echten Datenbank (siehe npm run test:db).
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>
const id = () => crypto.randomUUID()
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const tomorrow = new Date(Date.now() + 864e5)

const C = 'c1'
const G = ['Orga', 'Barschichten', 'Aufbau', 'Designs', 'Deko', 'Essen', 'Social Media', 'Spiele Olympiade', 'Glücksrad', 'Shuttle', 'DJs', 'Awareness']
const gid = (name: string) => 'g' + G.indexOf(name)
const P = (n: number, name: string, access: string, extra: Row = {}) =>
  ({ id: 'p' + n, collective_id: C, user_id: 'u' + n, name, access, photo_url: null, act_name: null, act_genre: null, tokens_override: null, ...extra })

const db: Record<string, Row[]> = {
  collectives: [{ id: C, name: 'Beispiel-Kollektiv', fest_start: iso(tomorrow), fest_days: 3, tokens_helfer: 1, tokens_crew: 1, tokens_admin: 1, guest_text: 'Schön, dass du da bist! Hier findest du alles zum Festival.', guest_packlist: ['Zelt', 'Schlafsack', 'Becher'] }],
  profiles: [P(1, 'Alex Beispiel', 'admin'), P(2, 'Sam Muster', 'crew'), P(3, 'Jo Testperson', 'helfer'),
    P(4, 'Kim Platzhalter', 'helfer', { act_genre: 'Techno' }), P(5, 'Lou Skizze', 'helfer')],
  gewerke: G.map((name, i) => ({ id: 'g' + i, name, kind: name === 'Orga' ? 'orga' : name === 'DJs' ? 'djs' : null, sort: i, tokens: name === 'DJs' ? 3 : 0 })),
  gewerk_members: [{ gewerk_id: gid('Orga'), profile_id: 'p1' }, { gewerk_id: gid('Barschichten'), profile_id: 'p2' }, { gewerk_id: gid('Barschichten'), profile_id: 'p3' },
    { gewerk_id: gid('DJs'), profile_id: 'p4' }, { gewerk_id: gid('Barschichten'), profile_id: 'p5' }],
  invites: [{ id: 'i1', code: 'CREWDEMO', access: 'crew', gewerk_id: null, active: true }, { id: 'i2', code: 'HELFDEMO', access: 'helfer', gewerk_id: null, active: true }],
  tasks: [
    { id: 't1', collective_id: C, gewerk_id: gid('Barschichten'), title: 'Kassenbestand prüfen', due_date: iso(new Date()), due_time: '20:00', prio: 'hoch', created_by: 'p2', done: false, done_at: null },
    { id: 't2', collective_id: C, gewerk_id: gid('Barschichten'), title: 'Becher bestellen', due_date: iso(tomorrow), due_time: null, prio: 'mittel', created_by: 'p2', done: false, done_at: null },
    { id: 't4', collective_id: C, gewerk_id: null, title: 'Tische zum Gelände tragen', due_date: iso(tomorrow), due_time: '15:00', prio: 'hoch', created_by: 'p2', done: false, done_at: null },
    { id: 't3', collective_id: C, gewerk_id: gid('Barschichten'), title: 'Preisliste drucken', due_date: iso(new Date()), due_time: null, prio: 'niedrig', created_by: 'p2', done: true, done_at: new Date(Date.now() - 36e5 * 5).toISOString() },
  ],
  task_assignees: [{ task_id: 't1', profile_id: 'p3', claimed: false, reported_done: false }],
  shifts: [
    { id: 's1', collective_id: C, gewerk_id: gid('Barschichten'), area: 'Bar', day: 0, start_time: '18:00:00', end_time: '22:00:00', need: 3 },
    { id: 's2', collective_id: C, gewerk_id: gid('Barschichten'), area: 'Bar', day: 1, start_time: '14:00:00', end_time: '18:00:00', need: 2 },
    { id: 's3', collective_id: C, gewerk_id: gid('Awareness'), area: 'Awareness', day: 0, start_time: '20:00:00', end_time: '00:00:00', need: 2 },
  ],
  shift_members: [{ shift_id: 's1', profile_id: 'p3' }, { shift_id: 's1', profile_id: 'p5' }],
  lineup_slots: [{ id: 'l1', collective_id: C, day: 0, start_time: '22:00:00', end_time: '23:30:00', profile_id: 'p4', act_name: null, act_genre: null },
    { id: 'l2', collective_id: C, day: 0, start_time: '20:30:00', end_time: '22:00:00', profile_id: null, act_name: 'DJ Ohne Konto', act_genre: 'Dub' }],
  token_redemptions: [],
  messages: [
    { id: 'm1', collective_id: C, channel: 'helfer', profile_id: 'p1', body: 'Willkommen im Team! Hier könnt ihr euch austauschen.', created_at: new Date(Date.now() - 36e5 * 26).toISOString() },
    { id: 'm2', collective_id: C, channel: 'helfer', profile_id: 'p5', body: 'Wann ist das erste Treffen?', created_at: new Date(Date.now() - 36e5 * 3).toISOString() },
    { id: 'm3', collective_id: C, channel: 'helfer', profile_id: 'p2', body: 'Dienstag um 19 Uhr, Termin steht im Kalender.', created_at: new Date(Date.now() - 36e5).toISOString() },
    { id: 'm4', collective_id: C, channel: gid('Barschichten'), profile_id: 'p2', body: 'Wer bringt den Kassenkoffer mit?', created_at: new Date(Date.now() - 36e5 * 2).toISOString() },
  ],
  folders: [
    { id: 'f1', collective_id: C, name: 'Fotos', note: 'Alle Fotos fürs Team', url: 'https://drive.google.com/drive/folders/demo', crew_only: false, guest_visible: true, sort: 0 },
    { id: 'f2', collective_id: C, name: 'Orga-Ordner', note: 'Logos, Designs, Verträge und alles Wichtige', url: null, crew_only: true, guest_visible: false, sort: 1 },
  ],
  notifications: [
    { id: 'n1', profile_id: 'p3', body: 'Du bist eingeteilt: Bar, Di 03.11. 18:00–22:00 Uhr', link: 'schichten', created_at: new Date(Date.now() - 36e5).toISOString(), read_at: null },
    { id: 'n2', profile_id: 'p3', body: 'Dir wurde eine Aufgabe zugeteilt: Kassenbestand prüfen', link: 'aufgaben', created_at: new Date(Date.now() - 36e5 * 5).toISOString(), read_at: new Date().toISOString() },
    { id: 'n3', profile_id: 'p2', body: 'Jo Testperson hat die Aufgabe als fertig gemeldet: Kassenbestand prüfen', link: 'aufgaben', created_at: new Date(Date.now() - 36e5 * 2).toISOString(), read_at: null },
    { id: 'n4', profile_id: 'p1', body: 'Sam Muster hat die Aufgabe übernommen: Becher bestellen', link: 'aufgaben', created_at: new Date(Date.now() - 36e5).toISOString(), read_at: null },
  ],
  events: [{ id: 'e1', collective_id: C, date: iso(new Date()), time: '19:00:00', title: 'Orga-Treffen' }],
}
// Eingebettete Tabellen in select('*, kind(spalten)')
const CHILD_KEY: Record<string, string> = { task_assignees: 'task_id', shift_members: 'shift_id' }

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private filters: ((r: Row) => boolean)[] = []
  private embeds: string[] = []
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: Row | Row[] = {}
  private one = false
  constructor(private table: string, private base: (r: Row) => boolean = () => true) {}
  select(cols = '*') { this.embeds = [...cols.matchAll(/(\w+)\(/g)].map(m => m[1]); return this }
  order() { return this }
  limit() { return this }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this }
  is(c: string, v: unknown) { this.filters.push(r => (r[c] ?? null) === v); return this }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  single() { this.one = true; return this }
  maybeSingle() { this.one = true; return this }
  private run() {
    const rows = db[this.table] ??= []
    let out: Row[]
    if (this.op === 'insert') {
      out = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(r => ({ id: id(), created_at: new Date().toISOString(), ...r }))
      rows.push(...out)
    } else {
      out = rows.filter(r => this.base(r) && this.filters.every(f => f(r)))
      if (this.op === 'update') out.forEach(r => { Object.assign(r, this.payload); if (this.table === 'tasks' && 'done' in this.payload) r.done_at = this.payload.done ? new Date().toISOString() : null })
      if (this.op === 'delete') db[this.table] = rows.filter(r => !out.includes(r))
    }
    const data = out.map(r => ({ ...r, ...Object.fromEntries(this.embeds.map(e => [e, (db[e] ?? []).filter(c => c[CHILD_KEY[e]] === r.id)])) }))
    return { data: this.one ? data[0] ?? null : data, error: null }
  }
  then<A, B>(ok?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad)
  }
}

export function demoClient(role: string): SupabaseClient {
  const me = db.profiles.find(p => p.access === role) ?? db.profiles[0]
  const meId = me.id as string
  const reads: Record<string, string> = {}
  const allowance = (pid: string) => {
    const pr = db.profiles.find(x => x.id === pid)!, c = db.collectives[0]
    if (pr.tokens_override !== null && pr.tokens_override !== undefined) return pr.tokens_override as number
    const base = pr.access === 'admin' ? c.tokens_admin : pr.access === 'crew' ? c.tokens_crew : c.tokens_helfer
    const fromG = Math.max(0, ...db.gewerk_members.filter(m => m.profile_id === pid).map(m => (db.gewerke.find(g => g.id === m.gewerk_id)?.tokens as number) ?? 0))
    return Math.max(base as number, fromG)
  }
  const visible = (t: string) => (r: Row) =>
    t === 'notifications' ? r.profile_id === meId
    : t === 'token_redemptions' ? r.profile_id === meId || me.access !== 'helfer'
    : t === 'folders' ? !r.crew_only || me.access !== 'helfer'
    : t === 'messages' ? r.channel === 'helfer' || me.access !== 'helfer' || db.gewerk_members.some(m => m.profile_id === meId && m.gewerk_id === r.channel)
    : true
  const rpc = async (name: string, a: Row) => {
    const err = (message: string) => ({ data: null, error: { message } })
    switch (name) {
      case 'join_shift': {
        const s = db.shifts.find(x => x.id === a.p_shift)!
        if (db.shift_members.filter(m => m.shift_id === s.id).length >= (s.need as number)) return err('Die Schicht ist leider schon voll')
        db.shift_members.push({ shift_id: s.id, profile_id: meId }); break
      }
      case 'set_act': Object.assign(db.profiles.find(p => p.id === a.p_profile)!, { act_name: (a.p_name as string).trim() || null, act_genre: (a.p_genre as string).trim() || null }); break
      case 'report_task_done': Object.assign(db.task_assignees.find(x => x.task_id === a.p_task && x.profile_id === meId)!, { reported_done: true }); break
      case 'claim_task': db.task_assignees.push({ task_id: a.p_task, profile_id: meId, claimed: true, reported_done: false }); break
      case 'chat_overview': {
        const lead = me.access !== 'helfer'
        const mine = new Set(db.gewerk_members.filter(m => m.profile_id === meId).map(m => m.gewerk_id as string))
        const chans = ['helfer', ...db.gewerke.filter(g => lead || mine.has(g.id as string)).map(g => g.id as string)]
        return { data: chans.map(ch => {
          const ms = db.messages.filter(m => m.channel === ch).sort((x, y) => (x.created_at as string).localeCompare(y.created_at as string))
          const last = ms[ms.length - 1], read = reads[ch] ?? ''
          return { channel: ch, last_body: last?.body ?? null, last_at: last?.created_at ?? null, last_name: last ? db.profiles.find(p => p.id === last.profile_id)?.name ?? null : null,
            unread: ms.filter(m => m.profile_id !== meId && (m.created_at as string) > read).length }
        }), error: null }
      }
      case 'mark_read': reads[a.ch as string] = a.upto as string; break
      case 'my_tokens': return { data: [{ total: allowance(meId), used: db.token_redemptions.filter(r => r.profile_id === meId).length }], error: null }
      case 'redeem_token': {
        if (db.token_redemptions.filter(r => r.profile_id === meId).length >= allowance(meId)) return err('Du hast keine Marken mehr.')
        const at = new Date().toISOString(); db.token_redemptions.push({ id: id(), collective_id: C, profile_id: meId, redeemed_at: at }); return { data: at, error: null }
      }
      case 'person_tokens': return { data: me.access === 'helfer' ? [] : [{ total: allowance(a.p_profile as string), used: db.token_redemptions.filter(r => r.profile_id === a.p_profile).length }], error: null }
      case 'refund_token': {
        const mineR = db.token_redemptions.filter(r => r.profile_id === a.p_profile).sort((x, y) => (y.redeemed_at as string).localeCompare(x.redeemed_at as string))
        if (!mineR[0]) return err('Diese Person hat keine Marke eingelöst'); db.token_redemptions = db.token_redemptions.filter(r => r !== mineR[0]); break
      }
      case 'set_tokens': { const pr = db.profiles.find(x => x.id === a.p_profile); if (pr) pr.tokens_override = a.p_n; break }
      case 'guest_page': {
        const c = db.collectives[0]
        return { data: { name: c.name, fest_start: c.fest_start, fest_days: c.fest_days, text: c.guest_text, packlist: c.guest_packlist,
          fotos: db.folders.filter(f => f.guest_visible && f.url).map(f => ({ name: f.name, url: f.url })),
          slots: db.lineup_slots.map(s => { const p = db.profiles.find(x => x.id === s.profile_id); return { day: s.day, start: s.start_time, end: s.end_time, name: s.act_name || p?.act_name || p?.name, genre: s.act_genre || p?.act_genre } }) }, error: null }
      }
      case 'create_relogin_link': return { data: 'DEMOLINK', error: null }
      case 'gewerk_invite': return { data: 'BEREICH1', error: null }
      default: break
    }
    return { data: null, error: null }
  }
  return {
    from: (t: string) => new Query(t, visible(t)),
    rpc,
    auth: { getSession: async () => ({ data: { session: { user: { id: me.user_id } } } }), signInAnonymously: async () => ({ error: null }) },
  } as unknown as SupabaseClient
}
