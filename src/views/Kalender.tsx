import { useState, type FormEvent } from 'react'
import { useTeam } from '../lib/team'
import { useTasks } from '../lib/tasks'
import { dayCount, dayDate, hhmm, isoDate, useSchedule } from '../lib/schedule'
import { db, errorText } from '../lib/supabase'
import { Icon, Sheet, toast } from '../lib/ui'
import { PRIO_ICON, PRIO_LABEL, type Prio } from '../lib/types'

type Kind = 'Termin' | 'Aufgabe' | 'Schicht' | 'Auftritt'
type Item = { date: string; time: string; title: string; kind: Kind; sub?: string; mine: boolean; prio?: Prio }
const SYM: Record<Kind, string> = { Termin: '●', Aufgabe: '☐', Schicht: '◷', Auftritt: '♪' }
const CLS: Record<Kind, string> = { Termin: '', Aufgabe: 'task', Schicht: 'shift', Auftritt: 'gig' }
const FILTERS = [['alle', 'Alles'], ['meine', 'Nur meine'], ['schichten', 'Schichten'], ['lineup', 'Timetable']] as const
type Filter = typeof FILTERS[number][0]

export function Kalender() {
  const { me, isLead, person } = useTeam()
  const { tasks } = useTasks()
  const { coll, shifts, slots, termine, reload } = useSchedule()
  const today = isoDate(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [day, setDay] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('alle')
  const [creating, setCreating] = useState(false)

  // Alles mit Datum aus allen Bereichen zusammensuchen
  const all: Item[] = []
  for (const e of termine) all.push({ date: e.date, time: hhmm(e.time), title: e.title, kind: 'Termin', mine: false })
  for (const t of tasks) {
    const mine = t.task_assignees.some(a => a.profile_id === me.id)
    if (t.due_date && !t.done && (isLead || mine))
      all.push({ date: t.due_date, time: hhmm(t.due_time), title: t.title, kind: 'Aufgabe', mine, prio: t.prio,
        sub: t.task_assignees.map(a => person(a.profile_id)?.name).join(', ') || 'noch niemand' })
  }
  for (const s of shifts) {
    const mine = s.shift_members.some(m => m.profile_id === me.id), date = dayDate(coll, s.day)
    if (date && (isLead || mine))
      all.push({ date, time: hhmm(s.start_time), title: s.area, kind: 'Schicht', mine,
        sub: `${hhmm(s.start_time)}–${hhmm(s.end_time)} · ${s.shift_members.map(m => person(m.profile_id)?.name).join(', ') || 'noch niemand'}${s.shift_members.length < s.need ? ` · fehlt noch ${s.need - s.shift_members.length}` : ''}` })
  }
  for (const l of slots) {
    const date = dayDate(coll, l.day), p = l.profile_id ? person(l.profile_id) : undefined
    const title = l.act_name?.trim() || p?.act_name || p?.name
    if (date && title) all.push({ date, time: hhmm(l.start_time), title, kind: 'Auftritt', mine: !!l.profile_id && l.profile_id === me.id, sub: `${hhmm(l.start_time)}–${hhmm(l.end_time)}` })
  }
  const items = all.filter(i => filter === 'alle' || (filter === 'meine' ? i.mine : filter === 'schichten' ? i.kind === 'Schicht' : i.kind === 'Auftritt'))
    .sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')))
  const byDate = new Map<string, Item[]>()
  for (const i of items) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i])
  const fest = new Set(Array.from({ length: dayCount(coll) }, (_, i) => dayDate(coll, i)).filter(Boolean))

  const add = isLead && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />Termin</button>
  const form = creating && <TerminForm date={day ?? today} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />

  if (day) {
    const list = byDate.get(day) ?? []
    const shiftDay = (n: number) => { const d = new Date(day + 'T12:00'); d.setDate(d.getDate() + n); setDay(isoDate(d)) }
    const row = (i: Item, k: number) => (
      <div key={k} className={`item ${CLS[i.kind]} ${i.mine ? 'mineitem' : ''}`}><span className="timecol">{i.time || '—'}</span>
        <div className="body"><b><span className={`sym k${CLS[i.kind]}`} aria-hidden="true">{SYM[i.kind]}</span> {i.title}</b>
          <div className="meta">{i.mine && <span className="tag role">Betrifft dich</span>}<span>{i.kind}</span>{i.sub && <span>{i.sub}</span>}
            {i.prio && <span className={`tag prio ${i.prio}`}>{PRIO_ICON[i.prio]} {PRIO_LABEL[i.prio]}</span>}</div></div></div>)
    return <>
      <div className="head"><div><h1>Kalender</h1></div>{add}</div>
      <section className="card stack">
        <div className="calhead daynav"><button className="btn sm" onClick={() => { setMonth(day.slice(0, 7)); setDay(null) }}>‹ Monat</button>
          <h2>{new Date(day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <button className="btn icon" aria-label="Vorheriger Tag" onClick={() => shiftDay(-1)}>‹</button>
          <button className="btn icon" aria-label="Nächster Tag" onClick={() => shiftDay(1)}>›</button></div>
        {list.length ? <div className="list">{list.map(row)}</div> : <p className="muted">An diesem Tag steht nichts an.</p>}
      </section>{form}
    </>
  }

  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const count = Math.ceil((offset + new Date(y, m, 0).getDate()) / 7) * 7
  const cells = Array.from({ length: count }, (_, i) => new Date(y, m - 1, 1 - offset + i))
  const moveMonth = (n: number) => { const d = new Date(y, m - 1 + n, 1); setMonth(isoDate(d).slice(0, 7)) }

  return <>
    <div className="head"><div><h1>Kalender</h1><p className="muted">Termine, Fristen, Schichten und Timetable. Tipp auf einen Tag für die Tagesansicht.</p></div>{add}</div>
    <section className="card stack">
      <div className="calhead"><h2>{first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h2>
        <button className="btn sm" onClick={() => setMonth(today.slice(0, 7))}>Heute</button>
        {coll?.fest_start && <button className="btn sm" onClick={() => setMonth(coll.fest_start!.slice(0, 7))}>Festival</button>}
        <button className="btn icon" aria-label="Vorheriger Monat" onClick={() => moveMonth(-1)}>‹</button>
        <button className="btn icon" aria-label="Nächster Monat" onClick={() => moveMonth(1)}>›</button></div>
      <div className="chips" role="group" aria-label="Anzeigen">{FILTERS.map(([k, l]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
      <div className="cal">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => <div key={w} className="wd">{w}</div>)}
        {cells.map(d => {
          const k = isoDate(d), list = [...(byDate.get(k) ?? [])].sort((a, b) => Number(b.mine) - Number(a.mine))
          // Ein Tag, der mich betrifft, ist komplett gefüllt: Schicht/Auftritt vor Aufgabe
          const mineItem = list.find(i => i.mine && (i.kind === 'Schicht' || i.kind === 'Auftritt')) ?? list.find(i => i.mine)
          const cls = ['cday', d.getMonth() !== m - 1 ? 'other' : '', k === today ? 'today' : '', fest.has(k) ? 'fest' : '', mineItem ? `hasmine hm-${CLS[mineItem.kind] || 'task'}` : ''].join(' ')
          return <button key={k} className={cls} onClick={() => setDay(k)} aria-label={`${d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}, ${list.length} Einträge`}>
            <span className="n">{d.getDate()}</span>
            {list.slice(0, 4).map((i, n) => <span key={n} className={`ev ${CLS[i.kind]} ${i.mine ? 'mine' : ''}`}>
              <span className="evs" aria-hidden="true">{SYM[i.kind]} </span>{i.time && <b className="evt">{i.time} </b>}<span className="evn">{i.title}</span></span>)}
            {list.length > 4 && <span className="ev more">+{list.length - 4} mehr</span>}
            {list.some(i => !i.mine) && <span className="dots" aria-hidden="true">{list.filter(i => !i.mine).slice(0, 3).map((i, n) => <span key={n} className={`dot ${CLS[i.kind]}`} />)}</span>}
          </button>
        })}
      </div>
      <div className="legend">{(Object.keys(SYM) as Kind[]).map(k => <span key={k}><span className={`sym k${CLS[k]}`} aria-hidden="true">{SYM[k]}</span> {k}</span>)}</div>
    </section>{form}
  </>
}

function TerminForm({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const { me } = useTeam()
  const [f, setF] = useState({ title: '', date, time: '' })
  async function submit(e: FormEvent) {
    e.preventDefault()
    const { error } = await db().from('events').insert({ collective_id: me.collective_id, created_by: me.id, title: f.title.trim(), date: f.date, time: f.time || null })
    if (error) return toast(errorText(error))
    toast('Termin angelegt.'); onSaved()
  }
  return (
    <Sheet title="Neuer Termin" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <h2>Neuer Termin</h2>
        <div className="field"><label htmlFor="eT">Was?</label><input id="eT" required autoFocus maxLength={120} placeholder="z. B. Orga-Treffen" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
        <div className="two">
          <div className="field"><label htmlFor="eD">Datum</label><input id="eD" type="date" required value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></div>
          <div className="field"><label htmlFor="eZ">Uhrzeit</label><input id="eZ" type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /><span className="hint">optional</span></div>
        </div>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary">Termin anlegen</button></div>
      </form>
    </Sheet>
  )
}
