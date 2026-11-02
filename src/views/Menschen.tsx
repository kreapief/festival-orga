import { useCallback, useEffect, useState } from 'react'
import { useTeam } from '../lib/team'
import { db, errorText } from '../lib/supabase'
import { appLink } from '../lib/route'
import { Avatar, Icon, Sheet, copyText, toast } from '../lib/ui'
import { ACCESS_LABEL, type Access, type Invite, type Profile } from '../lib/types'
import { HelferQrButton, QrSheet } from './InviteQr'

export function Menschen() {
  const { people, members, gewerkName } = useTeam()
  const [editing, setEditing] = useState<Profile | null>(null)
  const [inviting, setInviting] = useState(false)

  return <>
    <div className="head">
      <div><h1>Menschen</h1><p className="muted">{people.length} {people.length === 1 ? 'Person' : 'Personen'} im Team.</p></div>
      <div className="row"><HelferQrButton /><button className="btn primary" onClick={() => setInviting(true)}><Icon name="link" />Leute einladen</button></div>
    </div>
    <div className="people">
      {people.map(p => (
        <div key={p.id} className="card stack tight">
          <div className="row"><Avatar p={p} /><div className="grow"><b>{p.name}</b><div><span className="tag role">{ACCESS_LABEL[p.access]}</span></div></div>
            <button className="btn sm" onClick={() => setEditing(p)}>Bearbeiten</button></div>
          <div className="row tags">{members.filter(m => m.profile_id === p.id).map(m => <span key={m.gewerk_id} className="tag">{gewerkName(m.gewerk_id)}</span>)}</div>
        </div>
      ))}
    </div>
    {editing && <PersonSheet p={editing} onClose={() => setEditing(null)} />}
    {inviting && <Invites onClose={() => setInviting(false)} />}
  </>
}

function PersonSheet({ p, onClose }: { p: Profile; onClose: () => void }) {
  const { me, isAdmin, gewerke, inGewerk, canManage, reload, person } = useTeam()
  const [link, setLink] = useState('')
  const current = person(p.id) ?? p

  async function toggleGewerk(g: string, on: boolean) {
    const q = on ? db().from('gewerk_members').delete().eq('gewerk_id', g).eq('profile_id', p.id)
      : db().from('gewerk_members').insert({ gewerk_id: g, profile_id: p.id })
    const { error } = await q
    if (error) toast(errorText(error)); else reload()
  }
  async function setAccess(a: Access) {
    const { error } = await db().rpc('set_access', { p_profile: p.id, p_access: a })
    if (error) toast(errorText(error)); else { toast(`${p.name} hat jetzt Zugang: ${ACCESS_LABEL[a]}.`); reload() }
  }
  async function relogin() {
    const { data, error } = await db().rpc('create_relogin_link', { p_profile: p.id })
    if (error) return toast(errorText(error))
    setLink(appLink('wieder/' + data))
  }

  return (
    <Sheet title="Person bearbeiten" onClose={onClose}>
      <div className="row"><Avatar p={current} /><h2>{current.name}</h2></div>
      <div className="field"><label htmlFor="acc">Zugang</label>
        {isAdmin && p.id !== me.id
          ? <select id="acc" value={current.access} onChange={e => setAccess(e.target.value as Access)}>
              {(Object.keys(ACCESS_LABEL) as Access[]).map(a => <option key={a} value={a}>{ACCESS_LABEL[a]}</option>)}</select>
          : <><span>{ACCESS_LABEL[current.access]}</span><span className="hint">Den Zugang ändert nur ein Admin.</span></>}
      </div>
      <div className="field"><span className="flabel">Bereiche</span>
        <div className="pick">{gewerke.map(g => {
          const on = inGewerk(g.id, p.id)
          const ok = canManage(g.id)
          return <button type="button" key={g.id} aria-pressed={on} disabled={!ok} onClick={() => toggleGewerk(g.id, on)}><span className="box" aria-hidden="true">{on ? '✓' : ''}</span>{g.name}</button>
        })}</div></div>
      <PersonTokens p={current} />
      <div className="field"><span className="flabel">Neues Handy?</span>
        <span className="hint">Erzeugt einen Link, mit dem {current.name.split(' ')[0]} auf einem neuen Gerät wieder reinkommt. Er gilt einmal und 24 Stunden.</span>
        {link ? <><span className="linkbox">{link}</span><button className="btn sm" onClick={() => copyText(link, 'Link kopiert. Schick ihn direkt an die Person.')}><Icon name="copy" size={18} />Kopieren</button></>
          : <button className="btn sm" onClick={relogin}>Wiederanmelde-Link erzeugen</button>}
      </div>
      <button className="btn" onClick={onClose}>Fertig</button>
    </Sheet>
  )
}

function Invites({ onClose }: { onClose: () => void }) {
  const { isAdmin, gewerke } = useTeam()
  const [invites, setInvites] = useState<Invite[]>([])
  const [g, setG] = useState(gewerke.find(x => x.kind !== 'orga')?.id ?? '')
  const [qr, setQr] = useState<{ code: string; title: string; hint: string } | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await db().from('invites').select('id,code,access,gewerk_id,active').eq('active', true).is('gewerk_id', null)
    if (error) toast(errorText(error)); else setInvites(data)
  }, [])
  useEffect(() => { load() }, [load])

  const byAccess = (a: Access) => invites.find(i => i.access === a)
  async function renew(i: Invite) {
    const { error } = await db().rpc('renew_invite', { p_invite: i.id })
    if (error) toast(errorText(error)); else { toast('Neuer Link erzeugt. Der alte funktioniert nicht mehr.'); load() }
  }
  const gewerkCode = async () => {
    const { data, error } = await db().rpc('gewerk_invite', { p_gewerk: g })
    if (error) { toast(errorText(error)); return null }
    return data as string
  }
  async function copyGewerk() {
    const code = await gewerkCode()
    if (code) copyText(appLink('join/' + code), 'Link kopiert. Wer darüber kommt, ist gleich im Team.')
  }
  async function qrGewerk() {
    const code = await gewerkCode()
    if (code) setQr({ code, title: `Helfer:in für ${gewerke.find(x => x.id === g)?.name ?? 'Bereich'}`, hint: 'Wer diesen Code scannt, ist Helfer:in und gleich im Team dieses Bereichs.' })
  }
  const row = (i: Invite | undefined, title: string, hint: string) => i && <>
    <span className="linkbox">{appLink('join/' + i.code)}</span>
    <div className="row"><button className="btn sm" onClick={() => copyText(appLink('join/' + i.code), 'Link kopiert. Schick ihn z. B. in eure WhatsApp-Gruppe.')}><Icon name="copy" size={18} />Kopieren</button>
      <button className="btn sm" onClick={() => setQr({ code: i.code, title, hint })}>QR-Code zeigen</button>
      {isAdmin && <button className="btn sm" onClick={() => renew(i)}>Neuen Link erzeugen</button>}</div></>

  return (
    <Sheet title="Leute einladen" onClose={onClose}>
      <h2>Leute einladen</h2>
      <section className="stack"><h3>Helfer:innen</h3>
        <p className="small muted">Wer sich über diesen Link anmeldet, ist automatisch Helfer:in.</p>{row(byAccess('helfer'), 'Helfer:in einladen', 'Wer diesen Code scannt, ist automatisch Helfer:in.')}
        <div className="field"><label htmlFor="invG">Link für einen Bereich</label><span className="hint">Wer darüber kommt, landet direkt im Team.</span>
          <div className="addrow"><select id="invG" value={g} onChange={e => setG(e.target.value)}>
            {gewerke.filter(x => x.kind !== 'orga').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="row"><button className="btn sm" onClick={copyGewerk}><Icon name="copy" size={18} />Kopieren</button><button className="btn sm" onClick={qrGewerk}>QR-Code zeigen</button></div></div>
      </section>
      {isAdmin && <section className="stack"><h3>Crew</h3><p className="small muted">Nur an Leute geben, die Crew-Rechte bekommen sollen.</p>{row(byAccess('crew'), 'Crew einladen', 'Wer diesen Code scannt, ist Crew und in der Gruppe Orga. Nur persönlich zeigen.')}</section>}
      <button className="btn" onClick={onClose}>Fertig</button>
      {qr && <QrSheet {...qr} onClose={() => setQr(null)} />}
    </Sheet>
  )
}

// Getränkemarken einer Person: Stand für die Crew, eigene Zahl und Rückgabe
function PersonTokens({ p }: { p: Profile }) {
  const { isAdmin, reload } = useTeam()
  const [tk, setTk] = useState<{ total: number; used: number } | null>(null)
  const [own, setOwn] = useState(p.tokens_override === null || p.tokens_override === undefined ? '' : String(p.tokens_override))
  const load = useCallback(async () => {
    const { data } = await db().rpc('person_tokens', { p_profile: p.id })
    const row = (data as { total: number; used: number }[] | null)?.[0]
    setTk(row ? { total: Number(row.total), used: Number(row.used) } : null)
  }, [p.id])
  useEffect(() => { load() }, [load])
  if (!tk) return null
  async function refund() {
    const { error } = await db().rpc('refund_token', { p_profile: p.id })
    if (error) toast(errorText(error)); else { toast('Marke zurückgegeben.'); load() }
  }
  async function saveOwn() {
    const n = own.trim() === '' ? null : Math.max(0, Math.min(20, Math.round(+own)))
    const { error } = await db().rpc('set_tokens', { p_profile: p.id, p_n: n })
    if (error) toast(errorText(error)); else { toast(n === null ? 'Es gilt wieder die Einstellung für Zugang und Bereich.' : 'Gespeichert.'); load(); reload() }
  }
  return (
    <div className="field"><span className="flabel">Getränkemarken</span>
      <div className="row"><span>{tk.used} von {tk.total} eingelöst</span>{tk.used > 0 && <button className="btn sm" onClick={refund}>Eine Marke zurückgeben</button>}</div>
      {isAdmin && <div className="row small" style={{ gap: 8 }}><label htmlFor="tokp">Eigene Zahl für diese Person:</label>
        <input id="tokp" className="num" type="number" min={0} max={20} placeholder="–" value={own} onChange={e => setOwn(e.target.value)} />
        <button className="btn sm" onClick={saveOwn}>Speichern</button></div>}
      {isAdmin && <span className="hint">Leer lassen, dann gilt die Einstellung für Zugang und Bereich.</span>}
    </div>
  )
}
