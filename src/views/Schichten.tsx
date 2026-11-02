import { useMemo, useState, type FormEvent } from 'react'
import { useTeam } from '../lib/team'
import { db, errorText } from '../lib/supabase'
import { dayCount, dayLabel, hhmm, useSchedule } from '../lib/schedule'
import { Avatar, Icon, Sheet, toast } from '../lib/ui'
import type { Shift } from '../lib/types'

async function run(p: PromiseLike<{ error: unknown }>, ok: string) {
  const { error } = await p
  if (error) { toast(errorText(error)); return false }
  toast(ok); return true
}

type Mode = 'frei' | 'plan'
type Filter = 'offen' | 'alle' | 'meine'

export function Schichten() {
  const { me, isLead, person, inGewerk, isAdmin } = useTeam()
  const { coll, shifts, loading, reload } = useSchedule()
  const [mode, setMode] = useState<Mode>('frei')
  const [filter, setFilter] = useState<Filter>('offen')
  const [day, setDay] = useState(0)
  const [assign, setAssign] = useState<Shift | null>(null)
  const [form, setForm] = useState<'serie' | 'einzeln' | null>(null)
  // Planen darf der Admin und die Crew des Bereichs (wie in der Datenbank)
  const canPlan = (s: { gewerk_id: string | null }) => isAdmin || (me.access === 'crew' && (!s.gewerk_id || inGewerk(s.gewerk_id)))
  const days = Array.from({ length: dayCount(coll) }, (_, i) => dayLabel(coll, i))

  const free = (s: Shift) => Math.max(0, s.need - s.shift_members.length)
  const freePlaces = shifts.reduce((n, s) => n + free(s), 0)
  const freeShifts = shifts.filter(s => free(s) > 0).length

  // Gruppiert nach Name der Schicht (z. B. Bar), darin nach Tag und Uhrzeit
  const groups = useMemo(() => {
    const list = shifts.filter(s => filter === 'alle' || (filter === 'offen' ? s.need > s.shift_members.length : s.shift_members.some(m => m.profile_id === me.id)))
    const map = new Map<string, Shift[]>()
    for (const s of list) map.set(s.area, [...(map.get(s.area) ?? []), s])
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([area, items]) => [area, items.sort((a, b) => a.day - b.day || a.start_time.localeCompare(b.start_time))] as const)
  }, [shifts, filter, me.id])

  const leave = async (s: Shift) => { if (await run(db().from('shift_members').delete().eq('shift_id', s.id).eq('profile_id', me.id), 'Du bist ausgetragen.')) reload() }
  const join = async (s: Shift) => { if (await run(db().rpc('join_shift', { p_shift: s.id }), `Eingetragen: ${s.area}, ${hhmm(s.start_time)} Uhr.`)) reload() }

  const actions = (s: Shift) => {
    const mine = s.shift_members.some(m => m.profile_id === me.id), full = free(s) === 0
    const self = mine ? <button className="btn sm" onClick={() => leave(s)}>Austragen</button>
      : full ? <span className="tag">Voll</span>
      : <button className="btn sm primary" onClick={() => join(s)}>Eintragen</button>
    return canPlan(s) ? <div className="stack tight">{self}<button className="btn sm" onClick={() => setAssign(s)}>Zuteilen</button></div> : self
  }

  const today = shifts.filter(s => s.day === day)
  const areas = [...new Set(today.map(s => s.area))]

  return <>
    <div className="head">
      <div><h1>Schichten</h1>
        <p className="muted">{mode === 'frei' ? 'Hier siehst du alle Schichten und wo noch jemand fehlt. Tipp auf „Eintragen“, dann bist du dabei.' : 'Wer ist an diesem Tag wann wofür zuständig. Dein Name ist markiert.'}</p></div>
      {isLead && <div className="row"><button className="btn primary" onClick={() => setForm('serie')}><Icon name="plus" />Mehrere Schichten anlegen</button>
        <button className="btn" onClick={() => setForm('einzeln')}>Einzelne Schicht</button></div>}
    </div>

    <div className="chips" role="group" aria-label="Ansicht">
      <button className="chip" aria-pressed={mode === 'frei'} onClick={() => setMode('frei')}>Zu besetzen</button>
      <button className="chip" aria-pressed={mode === 'plan'} onClick={() => setMode('plan')}>Tagesübersicht</button>
    </div>

    {loading ? <p className="muted">Lädt …</p> : mode === 'frei' ? <>
      {shifts.length > 0 && <section className={`card row between ${freePlaces ? '' : 'allgood'}`}>
        <div><b className="big2">{freePlaces}</b> <span className="muted">{freePlaces === 1 ? 'Platz' : 'Plätze'} frei in {freeShifts} {freeShifts === 1 ? 'Schicht' : 'Schichten'}</span></div>
        {!freePlaces && <span className="tag ok">Alles besetzt</span>}
      </section>}
      <div className="chips" role="group" aria-label="Filter">
        {([['offen', 'Nur freie'], ['alle', 'Alle'], ['meine', 'Meine']] as const).map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      {!shifts.length ? <section className="card stack"><p className="muted">Noch keine Schichten angelegt.</p>
          {isLead && <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setForm('serie')}><Icon name="plus" />Mehrere Schichten anlegen</button>}</section>
        : !groups.length ? <section className="card"><p className="muted">{filter === 'offen' ? 'Super, alle Schichten sind besetzt.' : 'In diesem Filter gibt es nichts.'}</p></section>
        : groups.map(([area, items]) => (
          <section key={area} className="card stack">
            <div className="row between tight"><h2>{area}</h2><span className="tag">{items.filter(s => free(s) > 0).length} offen</span></div>
            {[...new Set(items.map(s => s.day))].map(d => (
              <div key={d}><h3 className="dayline">{dayLabel(coll, d)}</h3>
                {items.filter(s => s.day === d).map(s => {
                  const mine = s.shift_members.some(m => m.profile_id === me.id), f = free(s)
                  return <div key={s.id} className={`shiftrow ${mine ? 'mineshift' : ''}`}>
                    <div className="time">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                    <div className="grow">
                      <div className="row small tight"><div className={`bar ${f === 0 ? 'full' : ''}`}><i style={{ width: `${Math.min(100, s.shift_members.length / s.need * 100)}%` }} /></div>
                        <span className={f ? 'strongtxt' : 'muted'}>{f ? `${s.shift_members.length} von ${s.need}, ${f === 1 ? 'noch 1 Person gesucht' : `noch ${f} gesucht`}` : `${s.shift_members.length} von ${s.need}, besetzt`}</span></div>
                      {s.shift_members.length > 0 && <div className="row tags">{s.shift_members.map(m => <span key={m.profile_id} className={`tag ${m.profile_id === me.id ? 'role' : ''}`}>{m.profile_id === me.id ? 'Du' : person(m.profile_id)?.name}</span>)}</div>}
                    </div>
                    {actions(s)}
                  </div>
                })}</div>
            ))}
          </section>))}
    </> : <>
      <div className="tabs" role="tablist">{days.map((l, i) => <button key={i} className="tab" role="tab" aria-selected={day === i} onClick={() => setDay(i)}>{l}</button>)}</div>
      {!today.length ? <section className="card"><p className="muted">An diesem Tag gibt es noch keine Schichten.</p></section>
        : <div className="plan">{areas.map(area => (
          <section key={area} className="card stack tight"><h2>{area}</h2>
            {today.filter(s => s.area === area).map(s => {
              const miss = free(s)
              return <div key={s.id} className="pslot"><span className="time">{hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
                <span>{s.shift_members.map((m, i) => <span key={m.profile_id}>{i ? ', ' : ''}<span className={m.profile_id === me.id ? 'meName' : ''}>{person(m.profile_id)?.name}</span></span>)}
                  {miss > 0 && <> {s.shift_members.length ? '· ' : ''}<span className="tag prio hoch">fehlt noch {miss}</span></>}</span></div>
            })}
          </section>))}</div>}
    </>}

    {assign && <AssignSheet shift={shifts.find(s => s.id === assign.id) ?? assign} onClose={() => setAssign(null)} onChange={reload} canDelete={canPlan(assign)} />}
    {form && <ShiftForm mode={form} days={days} existing={shifts} canPlan={canPlan} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />}
  </>
}

function AssignSheet({ shift, onClose, onChange, canDelete }: { shift: Shift; onClose: () => void; onChange: () => void; canDelete: boolean }) {
  const { people, inGewerk, gewerkName } = useTeam()
  // Leute aus dem Bereich der Schicht stehen oben
  const sorted = [...people].sort((a, b) => Number(inGewerk(shift.gewerk_id, b.id)) - Number(inGewerk(shift.gewerk_id, a.id)) || a.name.localeCompare(b.name))
  async function toggle(pid: string, on: boolean) {
    const q = on ? db().from('shift_members').delete().eq('shift_id', shift.id).eq('profile_id', pid)
      : db().from('shift_members').insert({ shift_id: shift.id, profile_id: pid })
    const { error } = await q
    if (error) toast(errorText(error)); else onChange()
  }
  async function remove() {
    if (await run(db().from('shifts').delete().eq('id', shift.id), 'Schicht gelöscht.')) { onChange(); onClose() }
  }
  return (
    <Sheet title="Schicht zuteilen" onClose={onClose}>
      <h2>{shift.area} · {hhmm(shift.start_time)}–{hhmm(shift.end_time)}</h2>
      <p className="muted">{shift.shift_members.length} von {shift.need} besetzt.{shift.gewerk_id ? ` Leute aus ${gewerkName(shift.gewerk_id)} stehen oben.` : ''}</p>
      <div className="list">{sorted.map(p => {
        const on = shift.shift_members.some(m => m.profile_id === p.id)
        return <div key={p.id} className="item"><Avatar p={p} /><div className="body"><b>{p.name}</b>
          {inGewerk(shift.gewerk_id, p.id) && <div className="meta"><span className="tag role">{gewerkName(shift.gewerk_id)}</span></div>}</div>
          <button className={`btn sm ${on ? '' : 'primary'}`} onClick={() => toggle(p.id, on)}>{on ? 'Entfernen' : 'Hinzufügen'}</button></div>
      })}</div>
      <div className="row between">{canDelete ? <button className="btn danger" onClick={remove}>Schicht löschen</button> : <span />}<button className="btn" onClick={onClose}>Fertig</button></div>
    </Sheet>
  )
}

// Zerlegt einen Zeitraum in gleich lange Schichten, z. B. 16–22 Uhr in 2-Stunden-Schichten
export function makeSlots(from: string, to: string, hours: number): [string, string][] {
  const min = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const start = min(from); let end = min(to)
  if (end <= start) end += 1440 // über Mitternacht
  const out: [string, string][] = []
  for (let s = start; s < end && out.length < 48; s += hours * 60) out.push([fmt(s), fmt(Math.min(s + hours * 60, end))])
  return out
}

function ShiftForm({ mode, days, existing, canPlan, onClose, onSaved }: { mode: 'serie' | 'einzeln'; days: string[]; existing: Shift[]; canPlan: (s: { gewerk_id: string | null }) => boolean; onClose: () => void; onSaved: () => void }) {
  const { me, gewerke } = useTeam()
  const allowed = gewerke.filter(g => canPlan({ gewerk_id: g.id }))
  const serie = mode === 'serie'
  const [f, setF] = useState({ area: '', gewerk_id: allowed[0]?.id ?? '', from: '16:00', to: '22:00', hours: 2, need: 2, one: 0 })
  const [sel, setSel] = useState<boolean[]>(() => days.map(() => true))
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  const chosen = serie ? sel.map((on, i) => on ? i : -1).filter(i => i >= 0) : [f.one]
  const slots = serie ? makeSlots(f.from, f.to, f.hours) : [[f.from, f.to] as [string, string]]
  const rows = chosen.flatMap(day => slots.map(([a, b]) => ({ day, a, b })))
    .filter(r => !existing.some(s => s.area.toLowerCase() === f.area.trim().toLowerCase() && s.day === r.day && hhmm(s.start_time) === r.a && hhmm(s.end_time) === r.b))
  const skipped = chosen.length * slots.length - rows.length

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!rows.length) return toast(skipped ? 'Diese Schichten gibt es schon.' : 'Wähl mindestens einen Tag.')
    setBusy(true)
    const { error } = await db().from('shifts').insert(rows.map(r => ({
      collective_id: me.collective_id, gewerk_id: f.gewerk_id || null, area: f.area.trim(), day: r.day, start_time: r.a, end_time: r.b, need: f.need })))
    setBusy(false)
    if (error) return toast(errorText(error))
    toast(rows.length === 1 ? 'Schicht angelegt.' : `${rows.length} Schichten angelegt.${skipped ? ` ${skipped} gab es schon.` : ''}`); onSaved()
  }

  return (
    <Sheet title={serie ? 'Mehrere Schichten anlegen' : 'Neue Schicht'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <h2>{serie ? 'Mehrere Schichten anlegen' : 'Einzelne Schicht'}</h2>
        {serie && <p className="small muted">Zum Beispiel Bar von 16 bis 22 Uhr in 2-Stunden-Schichten, je 2 Personen, an allen Festivaltagen.</p>}
        <div className="field"><label htmlFor="sArea">Was?</label><input id="sArea" required maxLength={60} autoFocus placeholder="z. B. Bar, Einlass, Awareness" value={f.area} onChange={e => set({ area: e.target.value })} />
          <span className="hint">Schichten mit gleichem Namen stehen zusammen.</span></div>
        <div className="field"><label htmlFor="sG">Bereich</label>
          <select id="sG" value={f.gewerk_id} onChange={e => set({ gewerk_id: e.target.value })}>
            {allowed.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}<option value="">Ohne Bereich</option></select></div>
        {serie ? <div className="field"><span className="flabel">An welchen Tagen?</span>
          <div className="pick">{days.map((l, i) => <button type="button" key={i} aria-pressed={sel[i]} onClick={() => setSel(sel.map((v, j) => j === i ? !v : v))}>
            <span className="box" aria-hidden="true">{sel[i] ? '✓' : ''}</span>{l}</button>)}</div></div>
          : <div className="field"><label htmlFor="sDay">Tag</label><select id="sDay" value={f.one} onChange={e => set({ one: +e.target.value })}>{days.map((l, i) => <option key={i} value={i}>{l}</option>)}</select></div>}
        <div className="two">
          <div className="field"><label htmlFor="sFrom">Von</label><input id="sFrom" type="time" required value={f.from} onChange={e => set({ from: e.target.value })} /></div>
          <div className="field"><label htmlFor="sTo">Bis</label><input id="sTo" type="time" required value={f.to} onChange={e => set({ to: e.target.value })} /></div>
        </div>
        <div className="two">
          {serie && <div className="field"><label htmlFor="sH">Jede Schicht dauert</label>
            <select id="sH" value={f.hours} onChange={e => set({ hours: +e.target.value })}>{[1, 2, 3, 4, 6].map(h => <option key={h} value={h}>{h} {h === 1 ? 'Stunde' : 'Stunden'}</option>)}</select></div>}
          <div className="field"><label htmlFor="sNeed">Wie viele Personen?</label><input id="sNeed" type="number" min={1} max={50} required value={f.need} onChange={e => set({ need: +e.target.value })} /></div>
        </div>
        {serie && <p className="note">{rows.length ? <>Es entstehen <b>{rows.length}</b> {rows.length === 1 ? 'Schicht' : 'Schichten'}: {slots.map(([a, b]) => `${a}–${b}`).join(', ')} an {chosen.length} {chosen.length === 1 ? 'Tag' : 'Tagen'}.{skipped ? ` ${skipped} gibt es schon und wird übersprungen.` : ''}</> : skipped ? 'Alle diese Schichten gibt es schon.' : 'Wähl mindestens einen Tag.'}</p>}
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={busy || !rows.length}>{serie ? `${rows.length || ''} Schichten anlegen` : 'Schicht anlegen'}</button></div>
      </form>
    </Sheet>
  )
}
