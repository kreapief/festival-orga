import { useEffect, useState } from 'react'
import { db, errorText } from '../lib/supabase'

type Guest = {
  name: string; fest_start: string | null; fest_days: number; text: string | null; packlist: string[]
  fotos: { name: string; url: string }[]
  slots: { day: number; start: string; end: string; name: string; genre: string | null }[]
}

const hhmm = (t: string) => t.slice(0, 5)
const dayDate = (g: Guest, d: number) => { if (!g.fest_start) return null; const x = new Date(g.fest_start + 'T12:00'); x.setDate(x.getDate() + d); return x }
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('de-DE', o)

// Öffentliche Seite für Gäste: kein Konto, keine Anmeldung. Zeigt nur, was freigegeben ist.
export function Gaeste() {
  const [g, setG] = useState<Guest | null>(null)
  const [error, setError] = useState('')
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('gaeste-packliste') ?? '{}') } catch { return {} } })

  useEffect(() => {
    db().rpc('guest_page').then(({ data, error }) => { if (error) setError(errorText(error)); else setG(data as Guest) })
  }, [])

  const tick = (item: string) => {
    const next = { ...ticks, [item]: !ticks[item] }
    setTicks(next)
    try { localStorage.setItem('gaeste-packliste', JSON.stringify(next)) } catch { /* ohne Speicher geht es trotzdem */ }
  }

  if (error) return <div className="guest"><p className="error">{error}</p></div>
  if (!g) return <div className="guest"><p className="muted center">Lädt …</p></div>

  const first = dayDate(g, 0), last = dayDate(g, g.fest_days - 1)
  const range = first && last ? (g.fest_days > 1 ? `${fmt(first, { day: 'numeric', month: 'long' })} bis ${fmt(last, { day: 'numeric', month: 'long', year: 'numeric' })}` : fmt(first, { day: 'numeric', month: 'long', year: 'numeric' })) : ''

  return (
    <div className="guest guestpage">
      <header className="guest-head">
        <img className="guestlogo" src="./icon-192.png" alt="" width={96} height={96} />
        <h1>{g.name}</h1>
        {range && <p className="muted">{range}</p>}
      </header>

      {g.text && <section className="card"><p className="pre">{g.text}</p></section>}

      {g.slots.length > 0 && <section className="stack" aria-label="Timetable">
        <h2>Timetable</h2>
        <div className="timetable">{Array.from({ length: g.fest_days }, (_, day) => {
          const list = g.slots.filter(s => s.day === day)
          if (!list.length) return null
          const d = dayDate(g, day)
          return <div key={day} className="ttday">
            <h3 className="ttdate">{d ? `${fmt(d, { weekday: 'long' })} – ${fmt(d, { day: '2-digit', month: '2-digit', year: 'numeric' })}` : `Tag ${day + 1}`}</h3>
            {list.map((s, i) => <div key={i} className="ttrow">
              <span className="tttime">{hhmm(s.start)}<small> Uhr</small></span>
              <div className="ttbar"><div className="ttname"><b>{s.name}</b>{s.genre && <span className="ttgenre">{s.genre}</span>}</div><span className="ttend">bis {hhmm(s.end)}</span></div>
            </div>)}
          </div>
        })}</div>
      </section>}

      {g.fotos.length > 0 && <section className="card feature stack"><h2>Fotos</h2>
        <p className="muted">Alle Bilder liegen in Google Drive. Ansehen und herunterladen geht direkt dort.</p>
        <div className="row">{g.fotos.map(f => <a key={f.url} className="btn primary" href={f.url} target="_blank" rel="noopener noreferrer">{f.name} öffnen</a>)}</div></section>}

      {g.packlist.length > 0 && <section className="card stack"><h2>Packliste</h2>
        <p className="small muted">Zum Abhaken. Deine Häkchen bleiben nur auf deinem Handy.</p>
        <div className="list">{g.packlist.map(item => {
          const on = !!ticks[item]
          return <div key={item} className={`item ${on ? 'done' : ''}`}>
            <button className="check" role="checkbox" aria-checked={on} aria-label={item} onClick={() => tick(item)}>{on && '✓'}</button>
            <div className="body title">{item}</div></div>
        })}</div></section>}

      {!g.text && !g.slots.length && !g.fotos.length && !g.packlist.length && <section className="card"><p className="muted center">Hier erscheinen bald Timetable, Fotos und Infos zum Festival.</p></section>}
      <p className="small muted center">Diese Seite ist öffentlich. Ein Konto brauchst du nicht.</p>
    </div>
  )
}
