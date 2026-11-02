import { useState, type FormEvent } from 'react'
import { useTeam } from '../lib/team'
import { db, errorText } from '../lib/supabase'
import { dayCount, dayLabel, hhmm, myCommitments, useSchedule } from '../lib/schedule'
import { Icon, Sheet, initials, toast } from '../lib/ui'
import type { Profile, Slot } from '../lib/types'
import { Hero } from './Heute'

const actName = (p: Profile) => p.act_name || p.name

export function Lineup() {
  const { me, isLead, person, inGewerk, gewerke } = useTeam()
  const { coll, shifts, slots, loading, reload } = useSchedule()
  const [slot, setSlot] = useState<Slot | 'new' | null>(null)
  const [dj, setDj] = useState<Profile | null>(null)
  const djGewerk = gewerke.find(g => g.kind === 'djs')?.id ?? null
  const amDj = inGewerk(djGewerk)
  const up = myCommitments(coll, shifts, slots, me.id).filter(c => c.kind === 'Auftritt' && c.start.getTime() > Date.now() - 3600e3)

  return <>
    <div className="head">
      <div><h1>Line-up</h1><p className="muted">{amDj && !isLead ? 'Wann du spielst und wer vor und nach dir dran ist.' : 'Wer spielt wann. Das Line-up planen Admin und Crew.'}</p></div>
      <div className="row">{amDj && <button className="btn" onClick={() => setDj(me)}>Meine DJ-Infos</button>}
        {isLead && <button className="btn primary" onClick={() => setSlot('new')}><Icon name="plus" />Slot hinzufügen</button>}</div>
    </div>
    {up.length > 0 && <Hero next={up[0]} later={up.slice(1)} coll={coll} />}
    {loading ? <p className="muted">Lädt …</p> : !slots.length ? <section className="card"><p className="muted">Noch keine Slots im Line-up.</p></section>
      : Array.from({ length: dayCount(coll) }, (_, day) => {
        const list = slots.filter(s => s.day === day)
        if (!list.length) return null
        return <section key={day} className="card"><h2 className="dayhead">{dayLabel(coll, day)}</h2>
          {list.map(s => {
            const p = person(s.profile_id)
            if (!p) return null
            const own = p.id === me.id
            return <div key={s.id} className={`act ${own ? 'me' : ''}`}>
              <div className="time">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
              <span className="actimg" aria-hidden="true">{p.photo_url ? <img src={p.photo_url} alt="" /> : initials(actName(p))}</span>
              <div className="grow"><b className="actname">{actName(p)}</b>{own && <> <span className="tag role">Das bist du</span></>}
                <div>{p.act_genre ? <span className="tag genre">{p.act_genre}</span> : (isLead || own) && <span className="small muted">Musikrichtung fehlt noch</span>}</div></div>
              <div className="row">{(isLead || own) && <button className="btn sm" onClick={() => setDj(p)}>DJ-Infos</button>}
                {isLead && <button className="btn sm" onClick={() => setSlot(s)}>Slot ändern</button>}</div>
            </div>
          })}</section>
      })}
    {!coll?.fest_start && me.access === 'admin' && <p className="note">Tipp: Trag in den Einstellungen den ersten Festivaltag ein. Dann stehen Line-up und Schichten mit Datum im Kalender.</p>}
    {slot && <SlotForm slot={slot === 'new' ? null : slot} days={Array.from({ length: dayCount(coll) }, (_, i) => dayLabel(coll, i))} djGewerk={djGewerk}
      onClose={() => setSlot(null)} onSaved={() => { setSlot(null); reload() }} />}
    {dj && <DjForm p={dj} onClose={() => setDj(null)} />}
  </>
}

function SlotForm({ slot, days, djGewerk, onClose, onSaved }: { slot: Slot | null; days: string[]; djGewerk: string | null; onClose: () => void; onSaved: () => void }) {
  const { me, people, members } = useTeam()
  const djs = people.filter(p => members.some(m => m.gewerk_id === djGewerk && m.profile_id === p.id))
  const [f, setF] = useState({ day: slot?.day ?? 0, from: hhmm(slot?.start_time ?? '20:00'), to: hhmm(slot?.end_time ?? '21:30'), who: slot?.profile_id ?? '' })
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    const data = { day: f.day, start_time: f.from, end_time: f.to, profile_id: f.who }
    const { error } = slot ? await db().from('lineup_slots').update(data).eq('id', slot.id)
      : await db().from('lineup_slots').insert({ ...data, collective_id: me.collective_id })
    if (error) return toast(errorText(error))
    toast('Slot gespeichert.'); onSaved()
  }
  async function remove() {
    if (!slot) return
    const { error } = await db().from('lineup_slots').delete().eq('id', slot.id)
    if (error) return toast(errorText(error))
    toast('Slot gelöscht.'); onSaved()
  }
  return (
    <Sheet title="Slot" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <h2>{slot ? 'Slot ändern' : 'Neuer Slot'}</h2>
        <div className="field"><label htmlFor="slDay">Tag</label><select id="slDay" value={f.day} onChange={e => set({ day: +e.target.value })}>{days.map((l, i) => <option key={i} value={i}>{l}</option>)}</select></div>
        <div className="two">
          <div className="field"><label htmlFor="slFrom">Von</label><input id="slFrom" type="time" required value={f.from} onChange={e => set({ from: e.target.value })} /></div>
          <div className="field"><label htmlFor="slTo">Bis</label><input id="slTo" type="time" required value={f.to} onChange={e => set({ to: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="slWho">DJ</label>
          <select id="slWho" required value={f.who} onChange={e => set({ who: e.target.value })}><option value="">Bitte wählen</option>
            {djs.map(p => <option key={p.id} value={p.id}>{actName(p)}{p.act_genre ? ` · ${p.act_genre}` : ''}</option>)}</select>
          <span className="hint">Fehlt jemand? Unter Menschen in den Bereich DJs holen.</span></div>
        <div className="row between">{slot ? <button type="button" className="btn danger" onClick={remove}>Slot löschen</button> : <span />}
          <div className="row"><button type="button" className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary">Speichern</button></div></div>
      </form>
    </Sheet>
  )
}

function DjForm({ p, onClose }: { p: Profile; onClose: () => void }) {
  const { me, reload } = useTeam()
  const [name, setName] = useState(p.act_name ?? '')
  const [genre, setGenre] = useState(p.act_genre ?? '')
  async function submit(e: FormEvent) {
    e.preventDefault()
    const { error } = await db().rpc('set_act', { p_profile: p.id, p_name: name, p_genre: genre })
    if (error) return toast(errorText(error))
    toast('DJ-Infos gespeichert.'); await reload(); onClose()
  }
  return (
    <Sheet title="DJ-Infos" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <h2>DJ-Infos{p.id === me.id ? '' : ` · ${p.name}`}</h2>
        <p className="small muted">So erscheint der Slot im Line-up.</p>
        <div className="field"><label htmlFor="djName">Name im Line-up</label><input id="djName" maxLength={60} placeholder={p.name} value={name} onChange={e => setName(e.target.value)} />
          <span className="hint">Leer lassen, dann steht der normale Name da.</span></div>
        <div className="field"><label htmlFor="djGenre">Musikrichtung</label><input id="djGenre" maxLength={60} placeholder="z. B. Techno, House, Drum & Bass" value={genre} onChange={e => setGenre(e.target.value)} /></div>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary">Speichern</button></div>
      </form>
    </Sheet>
  )
}
