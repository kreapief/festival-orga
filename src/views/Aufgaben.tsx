import { useState, type FormEvent } from 'react'
import { useTeam } from '../lib/team'
import { claimTask, createTask, reportDone, setDone, useTasks, type NewTask } from '../lib/tasks'
import { Avatar, Icon, Sheet, fmtDate } from '../lib/ui'
import { PRIO_ICON, PRIO_LABEL, type Prio, type Task } from '../lib/types'

export function TaskRow({ t, onChange }: { t: Task; onChange: () => void }) {
  const { me, isAdmin, isLead, person, gewerkName, inGewerk } = useTeam()
  const mine = t.task_assignees.find(a => a.profile_id === me.id)
  // Abhaken darf nur, wer die Aufgabe erstellt hat, oder ein Admin
  const canTick = isAdmin || t.created_by === me.id
  const creator = person(t.created_by)?.name ?? '—'
  const act = async (p: Promise<boolean>) => { if (await p) onChange() }

  let action = null
  if (!t.done && !t.task_assignees.length && (isLead || inGewerk(t.gewerk_id)))
    action = <button className="btn sm primary" onClick={() => act(claimTask(t.id))}>Übernehmen</button>
  else if (!t.done && mine && !canTick && !mine.reported_done)
    action = <button className="btn sm" onClick={() => act(reportDone(t.id))}><Icon name="check" size={18} />Ich bin fertig</button>

  const reported = t.task_assignees.some(a => a.reported_done)
  return (
    <div className={`item ${t.done ? 'done' : ''}`}>
      <button className="check" role="checkbox" aria-checked={t.done} aria-label={`${t.title} erledigt`} disabled={!canTick}
        title={canTick ? undefined : `Abhaken kann ${creator} oder ein Admin`} onClick={() => act(setDone(t.id, !t.done))}>
        {t.done && <Icon name="check" size={18} />}
      </button>
      <div className="body">
        <div className="title"><b>{t.title}</b></div>
        <div className="meta">
          {!t.done && !t.task_assignees.length && <span className="tag strong">○ Offen · noch niemand</span>}
          {!t.done && reported && <span className="tag ok">✓ Fertig gemeldet{canTick ? ' · bitte abhaken' : ''}</span>}
          <span className={`tag prio ${t.prio}`}><span aria-hidden="true">{PRIO_ICON[t.prio]}</span> {PRIO_LABEL[t.prio]}</span>
          {t.gewerk_id && <span className="tag">{gewerkName(t.gewerk_id)}</span>}
          {t.due_date && <span>{fmtDate(t.due_date)}{t.due_time ? `, ${t.due_time.slice(0, 5)} Uhr` : ''}</span>}
        </div>
        <div className="who-box"><span className="who-lbl">Zuständig</span>
          {t.task_assignees.length ? t.task_assignees.map(a => {
            const p = person(a.profile_id)
            return p && <span key={a.profile_id} className="who-chip"><Avatar p={p} size="xs" />{a.profile_id === me.id ? 'Du' : p.name.split(' ')[0]}
              {a.claimed && <span className="muted"> · hat übernommen</span>}{a.reported_done && <span className="ok-txt"> · fertig</span>}</span>
          }) : <span className="muted">noch niemand</span>}
          <span className="who-by">erstellt von {t.created_by === me.id ? 'dir' : creator}</span>
        </div>
      </div>
      {action}
    </div>
  )
}

const FILTERS = [['alle', 'Alle'], ['meine', 'Meine'], ['offen', 'Zu erledigen'], ['frei', 'Ohne Person'], ['erledigt', 'Erledigt']] as const
type Filter = typeof FILTERS[number][0]
const ORDER: Record<Prio, number> = { hoch: 0, mittel: 1, niedrig: 2 }

export function Aufgaben() {
  const { me, isLead } = useTeam()
  const { tasks, loading, reload } = useTasks()
  const [filter, setFilter] = useState<Filter>('alle')
  const [creating, setCreating] = useState(false)

  const list = tasks.filter(t =>
    filter === 'meine' ? t.task_assignees.some(a => a.profile_id === me.id)
    : filter === 'offen' ? !t.done
    : filter === 'frei' ? !t.done && !t.task_assignees.length
    : filter === 'erledigt' ? t.done : true
  ).sort((a, b) => Number(a.done) - Number(b.done) || ORDER[a.prio] - ORDER[b.prio] || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))

  return <>
    <div className="head">
      <div><h1>Aufgaben</h1><p className="muted">{isLead ? 'Wer macht was, bis wann, und wie wichtig ist es.' : 'Deine Aufgaben und offene Aufgaben aus deinen Bereichen, die du übernehmen kannst.'}</p></div>
      {isLead && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />Neue Aufgabe</button>}
    </div>
    <div className="chips" role="group" aria-label="Filter">
      {FILTERS.map(([k, l]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
    </div>
    <section className="card">
      {loading ? <p className="muted">Lädt …</p> : list.length ? <div className="list">{list.map(t => <TaskRow key={t.id} t={t} onChange={reload} />)}</div>
        : <p className="muted">{tasks.length ? 'Keine Aufgaben in diesem Filter.' : isLead ? 'Noch keine Aufgaben. Leg die erste an.' : 'Gerade hast du keine Aufgaben.'}</p>}
    </section>
    {creating && <TaskForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
  </>
}

function TaskForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me, people, gewerke, inGewerk, gewerkName, members } = useTeam()
  const [t, setT] = useState<NewTask>({ title: '', gewerk_id: gewerke[0]?.id ?? '', due_date: '', due_time: '', prio: 'mittel', who: [] })
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<NewTask>) => setT(x => ({ ...x, ...patch }))
  const toggle = (id: string) => set({ who: t.who.includes(id) ? t.who.filter(x => x !== id) : [...t.who, id] })
  const areasOf = (pid: string) => members.filter(m => m.profile_id === pid).map(m => gewerkName(m.gewerk_id))

  // Leute aus dem gewählten Bereich stehen oben, Suche nach Name oder Bereich
  const ql = q.toLowerCase()
  const cands = people
    .filter(p => !ql || p.name.toLowerCase().includes(ql) || areasOf(p.id).some(a => a.toLowerCase().includes(ql)))
    .sort((a, b) => Number(inGewerk(t.gewerk_id, b.id)) - Number(inGewerk(t.gewerk_id, a.id)) || a.name.localeCompare(b.name))

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    if (await createTask(t, me.collective_id, me.id)) onSaved()
    setBusy(false)
  }

  return (
    <Sheet title="Neue Aufgabe" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <h2>Neue Aufgabe</h2>
        <div className="field"><label htmlFor="tt">Was ist zu tun?</label>
          <input id="tt" required autoFocus maxLength={200} placeholder="z. B. Bühnenplan an Technik schicken" value={t.title} onChange={e => set({ title: e.target.value })} /></div>
        <div className="field"><label htmlFor="tg">Bereich</label>
          <select id="tg" value={t.gewerk_id} onChange={e => set({ gewerk_id: e.target.value })}>{gewerke.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        <div className="field"><span className="flabel" id="whoLbl">Wer kümmert sich?</span>
          <span className="hint">Mehrere Personen möglich. Leer lassen, wenn jemand aus dem Bereich die Aufgabe übernehmen soll.</span>
          <div className="chips">{t.who.length ? t.who.map(id => <span key={id} className="tag role">{people.find(p => p.id === id)?.name}
            <button type="button" className="x" aria-label="entfernen" onClick={() => toggle(id)}>×</button></span>)
            : <span className="tag strong">○ Offen · noch niemand</span>}</div>
          <button type="button" className="btn combo-btn" aria-expanded={open} onClick={() => setOpen(!open)}>Personen auswählen <span aria-hidden="true">▾</span></button>
          {open && <div className="combo-panel">
            <input placeholder="Name oder Bereich suchen" aria-label="Personen suchen" value={q} onChange={e => setQ(e.target.value)} autoFocus />
            <div className="combo-list" role="listbox" aria-multiselectable="true" aria-labelledby="whoLbl">
              {cands.map(p => { const on = t.who.includes(p.id)
                return <button type="button" key={p.id} className="combo-row" role="option" aria-selected={on} onClick={() => toggle(p.id)}>
                  <span className="box" aria-hidden="true">{on ? '✓' : ''}</span><Avatar p={p} size="sm" />
                  <span><b>{p.name}</b><br /><span className="small muted">{areasOf(p.id).join(', ')}</span></span></button> })}
              {!cands.length && <p className="muted small">Niemand gefunden.</p>}
            </div></div>}
        </div>
        <div className="two">
          <div className="field"><label htmlFor="td">Bis wann?</label><input id="td" type="date" value={t.due_date} onChange={e => set({ due_date: e.target.value })} /></div>
          <div className="field"><label htmlFor="tz">Uhrzeit</label><input id="tz" type="time" value={t.due_time} onChange={e => set({ due_time: e.target.value })} /><span className="hint">optional</span></div>
        </div>
        <div className="field"><span className="flabel">Wie wichtig?</span><div className="chips" role="radiogroup">
          {(['hoch', 'mittel', 'niedrig'] as Prio[]).map(p => <button type="button" key={p} className="chip" role="radio" aria-checked={t.prio === p} aria-pressed={t.prio === p} onClick={() => set({ prio: p })}>{PRIO_ICON[p]} {PRIO_LABEL[p]}</button>)}
        </div></div>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={busy}>Aufgabe anlegen</button></div>
      </form>
    </Sheet>
  )
}
