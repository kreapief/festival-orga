import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTeam } from '../lib/team'
import { db, errorText } from '../lib/supabase'
import { Icon, Sheet, toast } from '../lib/ui'
import type { Folder } from '../lib/types'

export function Dateien() {
  const { isAdmin, isLead } = useTeam()
  const [folders, setFolders] = useState<Folder[] | null>(null)
  const [edit, setEdit] = useState<Folder | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await db().from('folders').select('id,name,note,url,crew_only,guest_visible,sort').order('sort')
    if (error) toast(errorText(error)); else setFolders((data as Folder[]).sort((a, b) => a.sort - b.sort))
  }, [])
  useEffect(() => { load() }, [load])

  return <>
    <div className="head"><div><h1>Dateien</h1><p className="muted">Fotos, Logos und Designs liegen in Google Drive. Von hier kommst du mit einem Tipp in die Ordner.</p></div></div>
    {folders === null ? <p className="muted">Lädt …</p> : (
      <div className="grid2">{folders.map(f => (
        <section key={f.id} className="card stack">
          <div className="row"><Icon name="dateien" size={32} />
            <div className="grow"><h2>{f.name}</h2>{f.note && <p className="small muted">{f.note}</p>}</div></div>
          <div className="row tags"><span className="tag">{f.crew_only ? 'Nur Crew und Admin' : 'Für alle im Team'}</span>{f.guest_visible && f.url && <span className="tag role">Auch für Gäste</span>}</div>
          {f.url ? <a className="btn primary" href={f.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={18} />In Google Drive öffnen</a>
            : <p className="note">{isAdmin ? 'Hier fehlt noch der Drive-Link. Tippe auf „Link eintragen“.' : 'Der Link wird gerade eingerichtet. Frag den Admin.'}</p>}
          {isAdmin && <button className="btn sm" onClick={() => setEdit(f)}>{f.url ? 'Link ändern' : 'Link eintragen'}</button>}
        </section>
      ))}</div>
    )}
    {isLead && !isAdmin && <p className="small muted">Den Drive-Link ändern kann nur der Admin.</p>}
    {isAdmin && <section className="card stack"><h3>So richtest du es ein</h3>
      <ol className="steps">
        <li>Lege in Google Drive zwei Ordner an, zum Beispiel <b>Fotos</b> und <b>Orga-Ordner</b>.</li>
        <li>Fotos: Freigabe auf <b>„Jeder mit dem Link“</b> stellen, damit alle im Team hineinkommen.</li>
        <li>Orga-Ordner: Freigabe auf <b>„Eingeschränkt“</b> lassen und nur die Google-Konten der Crew einladen.</li>
        <li>Kopiere jeweils den Link und trage ihn hier ein.</li>
      </ol>
      <p className="small muted">Die App zeigt den Orga-Link nur Crew und Admin. Ob jemand wirklich in den Ordner kommt, bestimmt aber Google Drive. Wer den Link kennt und Zugriff hat, kommt hinein.</p></section>}
    {edit && <LinkSheet f={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
  </>
}

function LinkSheet({ f, onClose, onSaved }: { f: Folder; onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState(f.url ?? '')
  const [guest, setGuest] = useState(f.guest_visible)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const v = url.trim()
    if (v && !/^https:\/\/\S+$/i.test(v)) return toast('Der Link muss mit https:// beginnen. Kopier ihn direkt aus Google Drive.')
    setBusy(true)
    const { error } = await db().from('folders').update({ url: v || null, guest_visible: f.crew_only ? false : guest }).eq('id', f.id)
    setBusy(false)
    if (error) return toast(errorText(error))
    toast(v ? 'Link gespeichert.' : 'Link entfernt.'); onSaved()
  }
  return (
    <Sheet title="Drive-Link" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <h2>{f.name}</h2>
        <div className="field"><label htmlFor="fUrl">Link zum Google-Drive-Ordner</label>
          <input id="fUrl" inputMode="url" autoFocus placeholder="https://drive.google.com/drive/folders/…" value={url} onChange={e => setUrl(e.target.value)} />
          <span className="hint">In Drive: Ordner mit rechts anklicken, „Freigeben“, „Link kopieren“.</span></div>
        {!f.crew_only && <label className="row small" style={{ gap: 8 }} htmlFor="fGuest"><input id="fGuest" type="checkbox" style={{ width: 20, minHeight: 20 }} checked={guest} onChange={e => setGuest(e.target.checked)} /> Auch auf der Gäste-Seite zeigen (öffentlich, ohne Konto)</label>}
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={busy}>Speichern</button></div>
      </form>
    </Sheet>
  )
}
