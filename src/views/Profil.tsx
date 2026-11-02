import { useState, type FormEvent } from 'react'
import { useTeam } from '../lib/team'
import { db, errorText } from '../lib/supabase'
import { Avatar, toast } from '../lib/ui'
import { ACCESS_LABEL } from '../lib/types'

export function Profil() {
  const { me, members, gewerkName, reload } = useTeam()
  const [name, setName] = useState(me.name)

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await db().from('profiles').update({ name: name.trim() }).eq('id', me.id)
    if (error) return toast(errorText(error))
    toast('Name gespeichert.'); reload()
  }

  return <>
    <div className="head"><div><h1>Mein Profil</h1><p className="muted">So sehen dich die anderen in der App.</p></div></div>
    <section className="card stack">
      <div className="row"><Avatar p={me} /><div><b>{me.name}</b><div className="row tags"><span className="tag role">{ACCESS_LABEL[me.access]}</span>
        {members.filter(m => m.profile_id === me.id).map(m => <span key={m.gewerk_id} className="tag">{gewerkName(m.gewerk_id)}</span>)}</div></div></div>
      <form className="addrow" onSubmit={save}>
        <input aria-label="Dein Name" required maxLength={60} value={name} onChange={e => setName(e.target.value)} />
        <button className="btn" disabled={name.trim() === me.name}>Speichern</button>
      </form>
    </section>
    <p className="note">Du bist über dieses Gerät angemeldet, ohne Passwort. Neues Handy oder Browserdaten gelöscht? Dann erzeugt dir die Crew einen Wiederanmelde-Link.</p>
  </>
}
