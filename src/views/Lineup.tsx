import { useState, type FormEvent } from 'react'
import { useTeam } from '../lib/team'
import { db, errorText } from '../lib/supabase'
import { dayCount, dayDate, dayLabel, hhmm, myCommitments, useSchedule } from '../lib/schedule'
import { Icon, Sheet, toast } from '../lib/ui'
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
  const dayHead = (day: number) => {
    const d = dayDate(coll, day)
    return d ? `${new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long' })} – ${new Date(d + 'T12:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}` : `Tag ${day + 1}`
  }

  return <>
    <div className="head">
      <div><h1>Timetable</h1><p className="muted">{amDj && !isLead ? 'Wann du spielst und wer vor und nach dir dran ist.' : 'Wer wann spielt. Den Timetable planen Admin und Crew.'}</p></div>
      <div className="row">{amDj && <button className="btn" onClick={() => setDj(me)}>Meine DJ-Infos</button>}
        {isLead && <button className="btn primary" onClick={() => setSlot('new')}><Icon name="plus" />Slot hinzufügen</button>}</div>
    </div>
    {up.length > 0 && <Hero next={up[0]} later={up.slice(1)} coll={coll} />}
    {loading ? <p className="muted">Lädt …</p> : !slots.length ? <section className="card"><p className="muted">Noch keine Slots im Timetable.</p></section>
      : <div className="timetable">{Array.from({ length: dayCount(coll) }, (_, day) => {
        const list = slots.filter(s => s.day === day)
        if (!list.length) return null
        return <section key={day} className="ttday" aria-label={dayLabel(coll, day)}>
          <h2 className="ttdate">{dayHead(day)}</h2>
          {list.map(s => {
            // Ein Slot hat entweder ein Konto (DJ) oder nur einen eingetippten Namen
            const p = s.profile_id ? person(s.profile_id) : undefined
            const name = s.act_name?.trim() || (p ? actName(p) : 'Noch offen')
            const genre = s.act_genre || p?.act_genre
            const own = !!p && p.id === me.id
            return <div key={s.id} className="ttrow">
              <span className="tttime">{hhmm(s.start_time)}<small> Uhr</small></span>
              <div className={`ttbar ${own ? 'own' : ''}`}>
                <div className="ttname"><b>{name}</b>{genre && <span className="ttgenre">{genre}</span>}</div>
                <span className="ttend">bis {hhmm(s.end_time)}</span>
                {own && <span className="tag role">Du</span>}
                {(isLead || own) && <span className="ttbtns">
                  {p && <button className="btn sm" onClick={() => setDj(p)}>DJ-Infos</button>}
                  {isLead && <button className="btn sm" onClick={() => setSlot(s)}>Ändern</button>}</span>}
              </div>
            </div>
          })}</section>
      })}</div>}
    {!coll?.fest_start && me.access === 'admin' && <p className="note">Tipp: Trag in den Einstellungen den ersten Festivaltag ein. Dann stehen Timetable und Schichten mit Datum im Kalender.</p>}
    {slot && <SlotForm slot={slot === 'new' ? null : slot} days={Array.from({ length: dayCount(coll) }, (_, i) => dayLabel(coll, i))} djGewerk={djGewerk}
      onClose={() => setSlot(null)} onSaved={() => { setSlot(null); reload() }} />}
    {dj && <DjForm p={dj} onClose={() => setDj(null)} />}
  </>
}

function SlotForm({ slot, days, djGewerk, onClose, onSaved }: { slot: Slot | null; days: string[]; djGewerk: string | null; onClose: () => void; onSaved: () => void }) {
  const { me, people, members } = useTeam()
  const djs = people.filter(p => members.some(m => m.gewerk_id === djGewerk && m.profile_id === p.id))
  // „__name“ heißt: nur ein Name, noch kein Konto
  const [f, setF] = useState({ day: slot?.day ?? 0, from: hhmm(slot?.start_time ?? '20:00'), to: hhmm(slot?.end_time ?? '21:30'),
    who: slot ? (slot.profile_id ?? '__name') : '', name: slot?.act_name ?? '', genre: slot?.act_genre ?? '' })
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    const free = f.who === '__name'
    if (free && !f.name.trim()) return toast('Bitte einen Namen eintragen.')
    const data = { day: f.day, start_time: f.from, end_time: f.to, profile_id: free ? null : f.who,
      act_name: free ? f.name.trim() : null, act_genre: free ? (f.genre.trim() || null) : null }
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
            {djs.map(p => <option key={p.id} value={p.id}>{actName(p)}{p.act_genre ? ` · ${p.act_genre}` : ''}</option>)}
            <option value="__name">Anderen Namen eintippen (noch kein Konto)</option></select>
          <span className="hint">Noch nicht angemeldet? Tipp den Namen einfach ein. Später lässt sich der Slot mit dem Konto verknüpfen.</span></div>
        {f.who === '__name' && <div className="two">
          <div className="field"><label htmlFor="slName">Name</label><input id="slName" required maxLength={60} autoFocus placeholder="z. B. DJ Beispiel" value={f.name} onChange={e => set({ name: e.target.value })} /></div>
          <div className="field"><label htmlFor="slGenre">Musikrichtung</label><input id="slGenre" maxLength={60} placeholder="z. B. Techno" value={f.genre} onChange={e => set({ genre: e.target.value })} /></div></div>}
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
        <p className="small muted">So erscheint der Slot im Timetable.</p>
        <div className="field"><label htmlFor="djName">Name im Timetable</label><input id="djName" maxLength={60} placeholder={p.name} value={name} onChange={e => setName(e.target.value)} />
          <span className="hint">Leer lassen, dann steht der normale Name da.</span></div>
        <div className="field"><label htmlFor="djGenre">Musikrichtung</label><input id="djGenre" maxLength={60} placeholder="z. B. Techno, House, Drum & Bass" value={genre} onChange={e => setGenre(e.target.value)} /></div>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary">Speichern</button></div>
      </form>
    </Sheet>
  )
}
