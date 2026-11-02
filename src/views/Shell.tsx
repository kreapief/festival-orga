import { useTeam } from '../lib/team'
import { go } from '../lib/route'
import { Avatar, Icon } from '../lib/ui'
import { Heute } from './Heute'
import { Aufgaben } from './Aufgaben'
import { Schichten } from './Schichten'
import { Kalender } from './Kalender'
import { Lineup } from './Lineup'
import { Menschen } from './Menschen'
import { Einstellungen } from './Einstellungen'
import { Profil } from './Profil'

type Item = { key: string; label: string; show?: 'lead' | 'admin' }
const NAV: { lbl: string; items: Item[] }[] = [
  { lbl: 'Überblick', items: [{ key: 'heute', label: 'Heute' }] },
  { lbl: 'Planen', items: [{ key: 'aufgaben', label: 'Aufgaben' }, { key: 'schichten', label: 'Schichten' }, { key: 'kalender', label: 'Kalender' }, { key: 'lineup', label: 'Line-up' }] },
  { lbl: 'Team', items: [{ key: 'menschen', label: 'Menschen', show: 'lead' }] },
  { lbl: 'Verwaltung', items: [{ key: 'einstellungen', label: 'Einstellungen', show: 'admin' }] },
]
// Unten am Handy ist Platz für vier Punkte plus „Mehr“
const PRIMARY = ['heute', 'aufgaben', 'schichten', 'kalender']

const VIEWS: Record<string, () => JSX.Element> = { heute: Heute, aufgaben: Aufgaben, schichten: Schichten, kalender: Kalender, lineup: Lineup, menschen: Menschen, einstellungen: Einstellungen, profil: Profil }

export function Shell({ view }: { view: string }) {
  const { me, isLead, isAdmin } = useTeam()
  const visible = (i: Item) => !i.show || (i.show === 'lead' ? isLead : isAdmin)
  const all = NAV.flatMap(g => g.items).filter(visible)
  const more = [...all.filter(i => !PRIMARY.includes(i.key)), { key: 'profil', label: 'Mein Profil' }]
  const current = view === 'mehr' || view === 'profil' || all.some(i => i.key === view) ? view : 'heute'
  const View = VIEWS[current]

  return (
    <div className="app">
      <nav className="side" aria-label="Hauptnavigation">
        <div className="brand">Festival-Orga</div>
        <button className="me-btn" aria-current={current === 'profil' ? 'page' : undefined} onClick={() => go('profil')}><Avatar p={me} /><span><b>{me.name}</b><br /><span className="small muted">Mein Profil</span></span></button>
        {NAV.map(g => {
          const items = g.items.filter(visible)
          return items.length > 0 && <div key={g.lbl} className="navgroup"><div className="lbl">{g.lbl}</div>
            {items.map(n => <button key={n.key} className="navbtn" aria-current={current === n.key ? 'page' : undefined} onClick={() => go(n.key)}><Icon name={n.key} />{n.label}</button>)}</div>
        })}
      </nav>
      <main><div className="wrap">
        {current === 'mehr'
          ? <><div className="head"><h1>Mehr</h1></div><section className="card"><div className="list">
              {more.map(n => <button key={n.key} className="navbtn" onClick={() => go(n.key)}><Icon name={n.key} />{n.label}</button>)}</div></section></>
          : <View />}
      </div></main>
      <nav className="bottom" aria-label="Hauptnavigation">
        {PRIMARY.map(k => all.find(i => i.key === k)!).map(n => (
          <button key={n.key} aria-current={current === n.key ? 'page' : undefined} onClick={() => go(n.key)}><Icon name={n.key} />{n.label}</button>
        ))}
        <button aria-current={!PRIMARY.includes(current) ? 'page' : undefined} onClick={() => go('mehr')}><Icon name="mehr" />Mehr</button>
      </nav>
    </div>
  )
}
