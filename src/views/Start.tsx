import { useEffect, useRef, useState, type FormEvent } from 'react'
import { db, errorText } from '../lib/supabase'
import { go } from '../lib/route'
import { ACCESS_LABEL, type Access, type Profile } from '../lib/types'

// Ein anonymes Konto für dieses Gerät, falls es noch keins gibt
async function ensureDeviceSession() {
  const { data } = await db().auth.getSession()
  if (data.session) return
  const { error } = await db().auth.signInAnonymously()
  if (error) throw error
}

export function Setup() {
  return (
    <div className="card stack wait">
      <h1>Fast geschafft</h1>
      <p className="muted">Die App ist noch nicht mit der Datenbank verbunden. Trag in der Datei <code>.env</code> die Adresse und den Schlüssel aus Supabase ein. Die Anleitung steht in <code>EINRICHTUNG.md</code>.</p>
    </div>
  )
}

// Aus einem eingefügten Link oder Code die passende Seite machen
function routeFromInput(text: string): string | null {
  const t = text.trim()
  const m = t.match(/#\/(join|wieder)\/([A-Za-z0-9]+)/)
  if (m) return `${m[1]}/${m[2].toUpperCase()}`
  const code = t.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (code.length === 16) return `wieder/${code}`
  if (code.length >= 6 && code.length <= 12) return `join/${code}`
  return null
}

export function NoAccess() {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    const r = routeFromInput(text)
    if (!r) return setError('Das sieht nicht nach einem Einladungslink oder Code aus. Kopier ihn noch mal komplett aus der Nachricht.')
    go(r)
  }
  return (
    <form className="card stack wait left" onSubmit={submit}>
      <h1>Hallo!</h1>
      <p className="muted">Du brauchst einen Einladungslink, um reinzukommen. Den bekommst du von der Crew, zum Beispiel in eurer WhatsApp-Gruppe. Tippe auf den Link, oder füge ihn hier ein.</p>
      <div className="field"><label htmlFor="code">Link oder Code</label>
        <input id="code" autoComplete="off" autoCapitalize="characters" placeholder="Link oder Code einfügen" value={text} onChange={e => { setText(e.target.value); setError('') }} /></div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" disabled={!text.trim()}>Weiter</button>
      <p className="note">Du hattest schon einen Zugang und nutzt jetzt ein neues Handy? Frag die Crew nach einem Wiederanmelde-Link und füge ihn hier ein.</p>
    </form>
  )
}

type Info = { zugang: Access; bereich: string | null; kollektiv: string }

export function Join({ code, me, onDone }: { code: string; me: Profile | null; onDone: () => void }) {
  const [info, setInfo] = useState<Info | null | 'invalid'>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    db().rpc('invite_info', { p_code: code }).then(({ data, error }) => {
      if (error) setError(errorText(error))
      else setInfo(data?.[0] ?? 'invalid')
    })
  }, [code])

  if (me) return (
    <div className="card stack wait">
      <h1>Du bist schon drin</h1>
      <p className="muted">Dieses Gerät ist als <b>{me.name}</b> angemeldet.</p>
      <button className="btn primary" onClick={() => go('heute')}>Zur App</button>
    </div>
  )

  if (info === 'invalid') return (
    <div className="card stack wait">
      <h1>Link ungültig</h1>
      <p className="muted">Dieser Einladungslink gilt nicht mehr. Frag die Crew nach dem aktuellen Link.</p>
    </div>
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await ensureDeviceSession()
      const { error } = await db().rpc('join_with_code', { p_code: code, p_name: name })
      if (error) throw error
      go('heute'); onDone()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  const als = info ? (info.zugang === 'helfer' ? `als Helfer:in${info.bereich ? ` für ${info.bereich}` : ''}` : `als ${ACCESS_LABEL[info.zugang]}`) : ''
  return (
    <form className="card stack wait left" onSubmit={submit}>
      <h1>Willkommen{info ? ` bei ${info.kollektiv}` : ''}!</h1>
      <p className="muted">Du wurdest {als || '…'} eingeladen. Sag uns nur, wie du heißt. Ein Passwort oder eine E-Mail brauchst du nicht: Dieses Handy bleibt angemeldet.</p>
      <div className="field"><label htmlFor="jName">Dein Name</label>
        <input id="jName" required maxLength={60} autoComplete="name" placeholder="Vorname Nachname" value={name} onChange={e => setName(e.target.value)} /></div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy || !info}>{busy ? 'Einen Moment …' : 'Los geht’s'}</button>
    </form>
  )
}

export function Relogin({ token, onDone }: { token: string; onDone: () => void }) {
  const [error, setError] = useState('')
  const started = useRef(false)
  useEffect(() => {
    // Der Link gilt nur einmal, darum nicht doppelt auslösen
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        await ensureDeviceSession()
        const { error } = await db().rpc('claim_relogin', { p_token: token })
        if (error) throw error
        go('heute'); onDone()
      } catch (err) { setError(errorText(err)) }
    })()
  }, [token, onDone])
  return (
    <div className="card stack wait">
      <h1>{error ? 'Das hat nicht geklappt' : 'Du wirst angemeldet …'}</h1>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}
