import { useEffect, useState } from 'react'
import { useTeam } from '../lib/team'
import { useTasks } from '../lib/tasks'
import { dayLabel, fmtCountdown, myCommitments, relDay, useSchedule, type Commitment } from '../lib/schedule'
import { go } from '../lib/route'
import type { Collective } from '../lib/types'
import { TaskRow } from './Aufgaben'
import { HelferQrButton } from './InviteQr'

// Tickt jede Sekunde, damit der Countdown live läuft
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return now
}

export function Hero({ next, later, coll }: { next: Commitment; later: Commitment[]; coll: Collective | null }) {
  const now = useNow()
  const ms = next.start.getTime() - now.getTime()
  const gig = next.kind === 'Auftritt'
  return (
    <section className={`hero ${gig ? 'gig' : ''} ${ms < 864e5 ? 'soon' : ''}`} aria-label={gig ? 'Dein nächster Auftritt' : 'Deine nächste Schicht'}>
      <div className="small hero-lbl">{gig ? 'Du spielst' : 'Deine nächste Schicht'}</div>
      <div className="hero-title">{next.title} · {relDay(next.start, now)} {next.from}</div>
      <div className="countdown" aria-live="off">{fmtCountdown(ms, gig)}</div>
      <div>{next.from}–{next.to} Uhr · {dayLabel(coll, next.day)}</div>
      <div className="row"><button className="btn ghost" onClick={() => go(gig ? 'lineup' : 'schichten')}>{gig ? 'Timetable' : 'Schichtplan'}</button></div>
      {later.length > 0 && <div className="small hero-later">Danach: {later.map(l => `${l.title} ${relDay(l.start, now)} ${l.from}`).join(' · ')}</div>}
    </section>
  )
}

export function Heute() {
  const { me, isLead } = useTeam()
  const { tasks, loading, reload } = useTasks()
  const { coll, shifts, slots } = useSchedule()
  const mine = tasks.filter(t => !t.done && t.task_assignees.some(a => a.profile_id === me.id))
  // Bis eine Stunde nach Beginn bleibt die Schicht oben stehen
  const upcoming = myCommitments(coll, shifts, slots, me.id).filter(c => c.start.getTime() > Date.now() - 3600e3)

  return <>
    <div className="head"><div><h1>Hallo {me.name.split(' ')[0]}</h1><p className="muted">Das steht für dich an.</p></div></div>
    {upcoming.length > 0 && <Hero next={upcoming[0]} later={upcoming.slice(1, 3)} coll={coll} />}
    {isLead && <section className="card row between"><div><h2>Neue Helfer:in?</h2><p className="muted small">Zeig den QR-Code. Wer ihn scannt, ist gleich Helfer:in.</p></div><HelferQrButton primary /></section>}
    <section className="card stack">
      <div className="row between"><h2>Deine Aufgaben</h2><span className="tag">{mine.length} offen</span></div>
      {loading ? <p className="muted">Lädt …</p> : mine.length ? <div className="list">{mine.slice(0, 5).map(t => <TaskRow key={t.id} t={t} onChange={reload} />)}</div>
        : <p className="muted">Gerade nichts offen.</p>}
      <button className="btn sm" onClick={() => go('aufgaben')}>Alle Aufgaben</button>
    </section>
    {!upcoming.length && me.access === 'helfer' && <section className="card stack"><h2>Deine Schichten</h2>
      <p className="muted">Du bist noch in keiner Schicht eingetragen.</p><button className="btn sm" onClick={() => go('schichten')}>Freie Schichten ansehen</button></section>}
  </>
}
