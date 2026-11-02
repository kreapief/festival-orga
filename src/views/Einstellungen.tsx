import { useEffect, useState, type FormEvent } from 'react'
import { db, errorText } from '../lib/supabase'
import { useSchedule } from '../lib/schedule'
import { useTeam } from '../lib/team'
import { useChat } from '../lib/chat'
import { appLink } from '../lib/route'
import { Icon, copyText, toast } from '../lib/ui'
import { QrSheet } from './InviteQr'
import type { Collective } from '../lib/types'

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
    <div className="grid2">
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
      {coll && <TokensCard coll={coll} onSaved={reload} />}
      {coll && <GuestCard coll={coll} onSaved={reload} />}
    </div>
  </>
}

function TokensCard({ coll, onSaved }: { coll: Collective; onSaved: () => void }) {
  const { gewerke, reload: reloadTeam } = useTeam()
  const { reload: reloadLive } = useChat()
  const [acc, setAcc] = useState({ helfer: coll.tokens_helfer, crew: coll.tokens_crew, admin: coll.tokens_admin })
  const [byG, setByG] = useState<Record<string, number>>(() => Object.fromEntries(gewerke.map(g => [g.id, g.tokens])))
  const [busy, setBusy] = useState(false)
  const num = (v: string) => Math.max(0, Math.min(20, Math.round(+v || 0)))

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    const a = await db().from('collectives').update({ tokens_helfer: acc.helfer, tokens_crew: acc.crew, tokens_admin: acc.admin }).eq('id', coll.id)
    const changed = gewerke.filter(g => byG[g.id] !== g.tokens)
    const results = await Promise.all(changed.map(g => db().from('gewerke').update({ tokens: byG[g.id] }).eq('id', g.id)))
    setBusy(false)
    const err = a.error ?? results.find(r => r.error)?.error
    if (err) return toast(errorText(err))
    toast('Gespeichert.'); onSaved(); reloadTeam(); reloadLive()
  }
  const row = (id: string, label: string, v: number, on: (n: number) => void) =>
    <div key={id} className="toggle"><label htmlFor={id}>{label}</label><input id={id} className="num" type="number" min={0} max={20} value={v} onChange={e => on(num(e.target.value))} /></div>

  return (
    <form className="card stack" onSubmit={save}>
      <h2>Getränkemarken</h2>
      <p className="small muted">Wie viele Freigetränke gibt es fürs ganze Festival (nicht pro Tag)? Treffen mehrere Zahlen auf jemanden zu, gilt die höchste. Für einzelne Personen änderst du sie unter Menschen → Bearbeiten.</p>
      <h3>Nach Zugang</h3>
      {row('tkH', 'Helfer:innen', acc.helfer, n => setAcc({ ...acc, helfer: n }))}
      {row('tkC', 'Crew', acc.crew, n => setAcc({ ...acc, crew: n }))}
      {row('tkA', 'Admin', acc.admin, n => setAcc({ ...acc, admin: n }))}
      <h3>Nach Bereich</h3>
      {gewerke.map(g => row('tk' + g.id, g.name, byG[g.id] ?? 0, n => setByG({ ...byG, [g.id]: n })))}
      <button className="btn primary" disabled={busy}>Speichern</button>
    </form>
  )
}

function GuestCard({ coll, onSaved }: { coll: Collective; onSaved: () => void }) {
  const [text, setText] = useState(coll.guest_text ?? '')
  const [pack, setPack] = useState(coll.guest_packlist.join('\n'))
  const [qr, setQr] = useState(false)
  const link = appLink('gaeste')

  async function save(e: FormEvent) {
    e.preventDefault()
    const packlist = pack.split('\n').map(x => x.trim()).filter(Boolean)
    const { error } = await db().from('collectives').update({ guest_text: text.trim() || null, guest_packlist: packlist }).eq('id', coll.id)
    if (error) return toast(errorText(error))
    toast('Gespeichert.'); onSaved()
  }
  return (
    <form className="card stack" onSubmit={save}>
      <h2>Gäste-Seite</h2>
      <p className="small muted">Öffentlich und ohne Konto: Timetable, Fotos und Packliste. Link oder QR-Code aushängen oder auf Instagram teilen. Den Foto-Link gibst du unter Dateien für Gäste frei.</p>
      <span className="linkbox">{link}</span>
      <div className="row">
        <button type="button" className="btn sm" onClick={() => copyText(link, 'Link kopiert.')}><Icon name="copy" size={18} />Kopieren</button>
        <button type="button" className="btn sm" onClick={() => setQr(true)}>QR-Code zeigen</button>
        <a className="btn sm" href={link} target="_blank" rel="noopener noreferrer">Seite ansehen</a></div>
      <div className="field"><label htmlFor="gText">Begrüßung</label><textarea id="gText" style={{ minHeight: 90 }} maxLength={1000} placeholder="z. B. Schön, dass du da bist! Hier findest du alles zum Festival." value={text} onChange={e => setText(e.target.value)} /></div>
      <div className="field"><label htmlFor="gPack">Packliste</label><textarea id="gPack" style={{ minHeight: 120 }} placeholder={'Zelt\nSchlafsack\nBecher'} value={pack} onChange={e => setPack(e.target.value)} />
        <span className="hint">Ein Punkt pro Zeile. Gäste können sie auf ihrem Handy abhaken.</span></div>
      <button className="btn primary">Speichern</button>
      {qr && <QrSheet link={link} title="Gäste-Seite" hint="Wer diesen Code scannt, sieht Timetable, Fotos und Packliste. Ein Konto braucht niemand." onClose={() => setQr(false)} />}
    </form>
  )
}
