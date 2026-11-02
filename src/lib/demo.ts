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
  ({ id: 'p' + n, collective_id: C, user_id: 'u' + n, name, access, photo_url: null, act_name: null, act_genre: null, ...extra })

const db: Record<string, Row[]> = {
  collectives: [{ id: C, name: 'Beispiel-Kollektiv', fest_start: iso(tomorrow), fest_days: 3 }],
  profiles: [P(1, 'Alex Beispiel', 'admin'), P(2, 'Sam Muster', 'crew'), P(3, 'Jo Testperson', 'helfer'),
    P(4, 'Kim Platzhalter', 'helfer', { act_genre: 'Techno' }), P(5, 'Lou Skizze', 'helfer')],
  gewerke: G.map((name, i) => ({ id: 'g' + i, name, kind: name === 'Orga' ? 'orga' : name === 'DJs' ? 'djs' : null, sort: i })),
  gewerk_members: [{ gewerk_id: gid('Orga'), profile_id: 'p1' }, { gewerk_id: gid('Barschichten'), profile_id: 'p2' }, { gewerk_id: gid('Barschichten'), profile_id: 'p3' },
    { gewerk_id: gid('DJs'), profile_id: 'p4' }, { gewerk_id: gid('Barschichten'), profile_id: 'p5' }],
  invites: [{ id: 'i1', code: 'CREWDEMO', access: 'crew', gewerk_id: null, active: true }, { id: 'i2', code: 'HELFDEMO', access: 'helfer', gewerk_id: null, active: true }],
  tasks: [
    { id: 't1', collective_id: C, gewerk_id: gid('Barschichten'), title: 'Kassenbestand prüfen', due_date: iso(new Date()), due_time: '20:00', prio: 'hoch', created_by: 'p2', done: false },
    { id: 't2', collective_id: C, gewerk_id: gid('Barschichten'), title: 'Becher bestellen', due_date: iso(tomorrow), due_time: null, prio: 'mittel', created_by: 'p2', done: false },
  ],
  task_assignees: [{ task_id: 't1', profile_id: 'p3', claimed: false, reported_done: false }],
  shifts: [
    { id: 's1', collective_id: C, gewerk_id: gid('Barschichten'), area: 'Bar', day: 0, start_time: '18:00:00', end_time: '22:00:00', need: 3 },
    { id: 's2', collective_id: C, gewerk_id: gid('Barschichten'), area: 'Bar', day: 1, start_time: '14:00:00', end_time: '18:00:00', need: 2 },
    { id: 's3', collective_id: C, gewerk_id: gid('Awareness'), area: 'Awareness', day: 0, start_time: '20:00:00', end_time: '00:00:00', need: 2 },
  ],
  shift_members: [{ shift_id: 's1', profile_id: 'p3' }, { shift_id: 's1', profile_id: 'p5' }],
  lineup_slots: [{ id: 'l1', collective_id: C, day: 0, start_time: '22:00:00', end_time: '23:30:00', profile_id: 'p4' }],
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
  constructor(private table: string) {}
  select(cols = '*') { this.embeds = [...cols.matchAll(/(\w+)\(/g)].map(m => m[1]); return this }
  order() { return this }
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
      out = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(r => ({ id: id(), ...r }))
      rows.push(...out)
    } else {
      out = rows.filter(r => this.filters.every(f => f(r)))
      if (this.op === 'update') out.forEach(r => Object.assign(r, this.payload))
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
      case 'create_relogin_link': return { data: 'DEMOLINK', error: null }
      case 'gewerk_invite': return { data: 'BEREICH1', error: null }
      default: break
    }
    return { data: null, error: null }
  }
  return {
    from: (t: string) => new Query(t),
    rpc,
    auth: { getSession: async () => ({ data: { session: { user: { id: me.user_id } } } }), signInAnonymously: async () => ({ error: null }) },
  } as unknown as SupabaseClient
}
