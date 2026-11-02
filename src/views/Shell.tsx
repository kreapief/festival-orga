import { useState, type ReactNode } from 'react'
import { useTeam } from '../lib/team'
import { ChatProvider, useChat } from '../lib/chat'
import { PullToRefresh } from '../lib/pull'
import { go } from '../lib/route'
import { Avatar, Icon, toast } from '../lib/ui'
import { Heute } from './Heute'
import { Aufgaben } from './Aufgaben'
import { Schichten } from './Schichten'
import { Kalender } from './Kalender'
import { Lineup } from './Lineup'
import { Bereiche } from './Bereiche'
import { Dateien } from './Dateien'
import { Menschen } from './Menschen'
import { Einstellungen } from './Einstellungen'
import { Profil } from './Profil'
import { BellButton } from './Mitteilungen'

type Item = { key: string; label: string; show?: 'lead' | 'admin' }
const NAV: { lbl: string; items: Item[] }[] = [
  { lbl: 'Überblick', items: [{ key: 'heute', label: 'Heute' }] },
  { lbl: 'Planen', items: [{ key: 'aufgaben', label: 'Aufgaben' }, { key: 'schichten', label: 'Schichten' }, { key: 'kalender', label: 'Kalender' }, { key: 'lineup', label: 'Timetable' }] },
  { lbl: 'Team', items: [{ key: 'bereiche', label: 'Bereiche' }, { key: 'menschen', label: 'Menschen', show: 'lead' }] },
  { lbl: 'Ablage', items: [{ key: 'dateien', label: 'Dateien' }] },
  { lbl: 'Verwaltung', items: [{ key: 'einstellungen', label: 'Einstellungen', show: 'admin' }] },
]
// Unten am Handy ist Platz für vier Punkte plus „Mehr“
const PRIMARY = ['heute', 'bereiche', 'aufgaben', 'kalender']

const VIEWS: Record<string, (p: { param?: string }) => ReactNode> = {
  heute: Heute, aufgaben: Aufgaben, schichten: Schichten, kalender: Kalender, lineup: Lineup,
  bereiche: Bereiche, dateien: Dateien, menschen: Menschen, einstellungen: Einstellungen, profil: Profil,
}

export function Shell(props: { view: string; param?: string }) {
  return <ChatProvider><ShellInner {...props} /></ChatProvider>
}

function ShellInner({ view, param }: { view: string; param?: string }) {
  const { me, isLead, isAdmin, reload: reloadTeam } = useTeam()
  const { unread, reload: reloadLive } = useChat()
  const [tick, setTick] = useState(0)
  const visible = (i: Item) => !i.show || (i.show === 'lead' ? isLead : isAdmin)
  const all = NAV.flatMap(g => g.items).filter(visible)
  const more = [...all.filter(i => !PRIMARY.includes(i.key)), { key: 'profil', label: 'Mein Profil' }]
  const current = view === 'mehr' || view === 'profil' || all.some(i => i.key === view) ? view : 'heute'
  const View = VIEWS[current]
  const badge = (k: string) => k === 'bereiche' && unread > 0 ? <span className="count" aria-label={`${unread} ungelesen`}>{unread}</span> : null

  // Alles neu laden: Team, Räume, Mitteilungen und die geöffnete Seite
  async function refresh() {
    await Promise.all([reloadTeam(), reloadLive()])
    setTick(t => t + 1)
    toast('Aktualisiert.')
  }

  return (
    <div className="app">
      <PullToRefresh onRefresh={refresh} />
      <nav className="side" aria-label="Hauptnavigation">
        <div className="row between nowrap"><div className="brand">Festival-Orga</div><BellButton /></div>
        <button className="me-btn" aria-current={current === 'profil' ? 'page' : undefined} onClick={() => go('profil')}><Avatar p={me} /><span><b>{me.name}</b><br /><span className="small muted">Mein Profil</span></span></button>
        {NAV.map(g => {
          const items = g.items.filter(visible)
          return items.length > 0 && <div key={g.lbl} className="navgroup"><div className="lbl">{g.lbl}</div>
            {items.map(n => <button key={n.key} className="navbtn" aria-current={current === n.key ? 'page' : undefined} onClick={() => go(n.key)}><Icon name={n.key} />{n.label}{badge(n.key)}</button>)}</div>
        })}
      </nav>
      <main>
        <div className="topbar"><span className="brand">Festival-Orga</span><BellButton /></div>
        <div className="wrap">
          {current === 'mehr'
            ? <><div className="head"><h1>Mehr</h1></div><section className="card"><div className="list">
                {more.map(n => <button key={n.key} className="navbtn" onClick={() => go(n.key)}><Icon name={n.key} />{n.label}</button>)}</div></section></>
            : <View key={`${current}-${tick}`} param={param} />}
        </div>
      </main>
      <nav className="bottom" aria-label="Hauptnavigation">
        {PRIMARY.map(k => all.find(i => i.key === k)!).map(n => (
          <button key={n.key} aria-current={current === n.key ? 'page' : undefined} onClick={() => go(n.key)}><Icon name={n.key} />{n.label}{badge(n.key)}</button>
        ))}
        <button aria-current={!PRIMARY.includes(current) ? 'page' : undefined} onClick={() => go('mehr')}><Icon name="mehr" />Mehr</button>
      </nav>
    </div>
  )
}
