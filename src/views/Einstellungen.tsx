import { useEffect, useState, type FormEvent } from 'react'
import { db, errorText } from '../lib/supabase'
import { useSchedule } from '../lib/schedule'
import { toast } from '../lib/ui'

export function Einstellungen() {
  const { coll, reload } = useSchedule()
  const [f, setF] = useState({ name: '', start: '', days: 3 })
  useEffect(() => { if (coll) setF({ name: coll.name, start: coll.fest_start ?? '', days: coll.fest_days }) }, [coll])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!coll) return
    const { error } = await db().from('collectives').update({ name: f.name.trim(), fest_start: f.start || null, fest_days: f.days }).eq('id', coll.id)
    if (error) return toast(errorText(error))
    toast('Gespeichert.'); reload()
  }

  return <>
    <div className="head"><div><h1>Einstellungen</h1><p className="muted">Gilt für alle in eurem Kollektiv. Ändern kann das nur der Admin.</p></div></div>
    <form className="card stack" onSubmit={save}>
      <h2>Festival</h2>
      <div className="field"><label htmlFor="cName">Name des Kollektivs</label><input id="cName" required maxLength={80} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
      <div className="two">
        <div className="field"><label htmlFor="cStart">Erster Festivaltag</label><input id="cStart" type="date" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} />
          <span className="hint">Damit stehen Schichten und Timetable mit Datum im Kalender, und der Countdown läuft.</span></div>
        <div className="field"><label htmlFor="cDays">Wie viele Tage?</label><input id="cDays" type="number" min={1} max={14} required value={f.days} onChange={e => setF({ ...f, days: +e.target.value })} /></div>
      </div>
      <button className="btn primary" disabled={!coll}>Speichern</button>
    </form>
  </>
}
