import { useState, type FormEvent } from 'react'
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

export function Schichten() {
  const { me, isLead, person, inGewerk, isAdmin } = useTeam()
  const { coll, shifts, loading, reload } = useSchedule()
  const [day, setDay] = useState(0)
  const [mode, setMode] = useState<'plan' | 'liste'>('plan')
  const [assign, setAssign] = useState<Shift | null>(null)
  const [creating, setCreating] = useState(false)
  // Planen darf der Admin und die Crew des Bereichs (wie in der Datenbank)
  const canPlan = (s: { gewerk_id: string | null }) => isAdmin || (me.access === 'crew' && (!s.gewerk_id || inGewerk(s.gewerk_id)))

  const today = shifts.filter(s => s.day === day)
  const areas = [...new Set(today.map(s => s.area))]

  return <>
    <div className="head">
      <div><h1>Schichten</h1><p className="muted">{mode === 'plan' ? 'Wer ist an diesem Tag wann wofür zuständig. Dein Name ist markiert.' : isLead ? 'Zuteilen kann die Crew des jeweiligen Bereichs.' : 'Trag dich in freie Schichten ein. Austragen geht jederzeit.'}</p></div>
      {isLead && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />Neue Schicht</button>}
    </div>
    <div className="chips" role="group" aria-label="Ansicht">
      <button className="chip" aria-pressed={mode === 'plan'} onClick={() => setMode('plan')}>Tagesübersicht</button>
      <button className="chip" aria-pressed={mode === 'liste'} onClick={() => setMode('liste')}>{isLead ? 'Zuteilen' : 'Eintragen'}</button>
    </div>
    <div className="tabs" role="tablist">
      {Array.from({ length: dayCount(coll) }, (_, i) => <button key={i} className="tab" role="tab" aria-selected={day === i} onClick={() => setDay(i)}>{dayLabel(coll, i)}</button>)}
    </div>

    {loading ? <p className="muted">Lädt …</p> : !today.length ? <section className="card"><p className="muted">An diesem Tag gibt es noch keine Schichten.</p></section>
    : mode === 'plan' ? (
      <div className="plan">{areas.map(area => (
        <section key={area} className="card stack tight"><h2>{area}</h2>
          {today.filter(s => s.area === area).map(s => {
            const miss = s.need - s.shift_members.length
            return <div key={s.id} className="pslot"><span className="time">{hhmm(s.start_time)}–{hhmm(s.end_time)}</span>
              <span>{s.shift_members.map((m, i) => <span key={m.profile_id}>{i ? ', ' : ''}<span className={m.profile_id === me.id ? 'meName' : ''}>{person(m.profile_id)?.name}</span></span>)}
                {miss > 0 && <> {s.shift_members.length ? '· ' : ''}<span className="tag prio hoch">fehlt noch {miss}</span></>}</span></div>
          })}
        </section>))}
      </div>
    ) : (
      <section className="card">{today.map(s => {
        const mine = s.shift_members.some(m => m.profile_id === me.id)
        const full = s.shift_members.length >= s.need
        return <div key={s.id} className="shiftrow">
          <div className="time">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
          <div className="grow"><b>{s.area}</b>
            <div className="row small muted"><div className={`bar ${full ? 'full' : ''}`}><i style={{ width: `${Math.min(100, s.shift_members.length / s.need * 100)}%` }} /></div>{s.shift_members.length} von {s.need} besetzt</div>
            {isLead ? <div className="row tags">{s.shift_members.map(m => <span key={m.profile_id} className={`tag ${m.profile_id === me.id ? 'role' : ''}`}>{person(m.profile_id)?.name}</span>)}</div>
              : mine && <div className="row tags"><span className="tag role">Du bist dabei</span></div>}
          </div>
          {(() => { const self = mine ? <button className="btn sm" onClick={async () => { if (await run(db().from('shift_members').delete().eq('shift_id', s.id).eq('profile_id', me.id), 'Du bist ausgetragen.')) reload() }}>Austragen</button>
            : full ? <span className="tag">Voll</span>
            : <button className="btn sm primary" onClick={async () => { if (await run(db().rpc('join_shift', { p_shift: s.id }), `Eingetragen: ${s.area}, ${hhmm(s.start_time)} Uhr.`)) reload() }}>Eintragen</button>
            return canPlan(s) ? <div className="stack tight">{self}<button className="btn sm" onClick={() => setAssign(s)}>Zuteilen</button></div> : self })()}
        </div>
      })}</section>
    )}
    {assign && <AssignSheet shift={shifts.find(s => s.id === assign.id) ?? assign} onClose={() => setAssign(null)} onChange={reload} canDelete={canPlan(assign)} />}
    {creating && <ShiftForm day={day} canPlan={canPlan} dayOptions={Array.from({ length: dayCount(coll) }, (_, i) => dayLabel(coll, i))}
      onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
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

function ShiftForm({ day, dayOptions, canPlan, onClose, onSaved }: { day: number; dayOptions: string[]; canPlan: (s: { gewerk_id: string | null }) => boolean; onClose: () => void; onSaved: () => void }) {
  const { me, gewerke } = useTeam()
  const allowed = gewerke.filter(g => canPlan({ gewerk_id: g.id }))
  const [f, setF] = useState({ area: '', gewerk_id: allowed[0]?.id ?? '', day, from: '18:00', to: '22:00', need: 2 })
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(db().from('shifts').insert({
      collective_id: me.collective_id, gewerk_id: f.gewerk_id || null, area: f.area.trim(), day: f.day, start_time: f.from, end_time: f.to, need: f.need,
    }), 'Schicht angelegt.')
    if (ok) onSaved()
  }
  return (
    <Sheet title="Neue Schicht" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <h2>Neue Schicht</h2>
        <div className="field"><label htmlFor="sArea">Was?</label><input id="sArea" required maxLength={60} autoFocus placeholder="z. B. Bar, Einlass, Awareness" value={f.area} onChange={e => set({ area: e.target.value })} />
          <span className="hint">Schichten mit gleichem Namen stehen in der Tagesübersicht zusammen.</span></div>
        <div className="field"><label htmlFor="sG">Bereich</label>
          <select id="sG" value={f.gewerk_id} onChange={e => set({ gewerk_id: e.target.value })}>
            {allowed.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}<option value="">Ohne Bereich</option></select></div>
        <div className="field"><label htmlFor="sDay">Tag</label>
          <select id="sDay" value={f.day} onChange={e => set({ day: +e.target.value })}>{dayOptions.map((l, i) => <option key={i} value={i}>{l}</option>)}</select></div>
        <div className="two">
          <div className="field"><label htmlFor="sFrom">Von</label><input id="sFrom" type="time" required value={f.from} onChange={e => set({ from: e.target.value })} /></div>
          <div className="field"><label htmlFor="sTo">Bis</label><input id="sTo" type="time" required value={f.to} onChange={e => set({ to: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="sNeed">Wie viele Leute?</label><input id="sNeed" type="number" min={1} max={50} required value={f.need} onChange={e => set({ need: +e.target.value })} /></div>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary">Schicht anlegen</button></div>
      </form>
    </Sheet>
  )
}
