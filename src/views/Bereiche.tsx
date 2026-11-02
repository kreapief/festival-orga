import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTeam } from '../lib/team'
import { useChat } from '../lib/chat'
import { db, errorText } from '../lib/supabase'
import { go } from '../lib/route'
import { Avatar, Icon, Sheet, toast } from '../lib/ui'
import { ACCESS_LABEL, isLeadAccess, type Message } from '../lib/types'

const HELFER = 'helfer'
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
const dayKey = (iso: string) => new Date(iso).toDateString()
function dayLabel(iso: string): string {
  const d = new Date(iso), now = new Date(), y = new Date(now.getTime() - 864e5)
  return d.toDateString() === now.toDateString() ? 'Heute' : d.toDateString() === y.toDateString() ? 'Gestern'
    : d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}
function shortTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  return d.toDateString() === now.toDateString() ? hhmm(iso) : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}

export function Bereiche({ param }: { param?: string }) {
  return param ? <Raum channel={param} /> : <Raumliste />
}

function useRoomName() {
  const { gewerke } = useTeam()
  return (ch: string) => ch === HELFER ? 'Helfer:innen' : gewerke.find(g => g.id === ch)?.name ?? 'Raum'
}

function Raumliste() {
  const { rooms } = useChat()
  const { members, isLead } = useTeam()
  const name = useRoomName()
  // Der Raum mit der neuesten Nachricht steht oben, leere Räume danach nach Namen
  const sorted = [...rooms].sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? '') || name(a.channel).localeCompare(name(b.channel)))
  const count = (ch: string) => members.filter(m => m.gewerk_id === ch).length

  return <>
    <div className="head"><div><h1>Bereiche</h1>
      <p className="muted">{isLead ? 'Alle Räume zum Schreiben. Als Crew kannst du in jeden Raum.' : 'Deine Bereiche und der Raum für alle Helfer:innen.'}</p></div></div>
    <div className="rooms">
      {sorted.map(r => (
        <button key={r.channel} className={`card room ${r.unread ? 'unread' : ''}`} onClick={() => go('bereiche/' + r.channel)}>
          <div className="row between tight"><h3>{name(r.channel)}</h3>{r.unread > 0 && <span className="count">{r.unread} neu</span>}</div>
          <span className="small muted">{r.channel === HELFER ? 'Für alle im Team' : `${count(r.channel)} im Team`}</span>
          {r.last_body ? <span className={`preview ${r.unread ? 'strong' : ''}`}><b>{r.last_name?.split(' ')[0]}:</b> {r.last_body}<span className="muted"> · {shortTime(r.last_at)}</span></span>
            : <span className="small muted">Noch keine Nachrichten</span>}
        </button>
      ))}
    </div>
  </>
}

function Raum({ channel }: { channel: string }) {
  const { me, person, members, gewerke, canManage, people, inGewerk, reload: reloadTeam } = useTeam()
  const { rooms, reload: reloadRooms } = useChat()
  const name = useRoomName()
  const [tab, setTab] = useState<'chat' | 'team'>('chat')
  const [msgs, setMsgs] = useState<Message[] | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [adding, setAdding] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const firstLoad = useRef(true)
  const unreadAtOpen = useRef<number | null>(null)
  const [divider, setDivider] = useState<string | null>(null)
  const g = gewerke.find(x => x.id === channel)

  // Wie viele waren beim Öffnen ungelesen? Daraus ergibt sich die „Neu“-Linie.
  if (unreadAtOpen.current === null && rooms.length) unreadAtOpen.current = rooms.find(r => r.channel === channel)?.unread ?? 0

  const load = useCallback(async () => {
    const { data, error } = await db().from('messages').select('id,channel,profile_id,body,created_at').eq('channel', channel).order('created_at', { ascending: false }).limit(150)
    if (error) return toast(errorText(error))
    const rows = (data as Message[]).sort((a, b) => a.created_at.localeCompare(b.created_at))
    setMsgs(rows)
    if (rows.length) {
      const newest = rows[rows.length - 1].created_at
      db().rpc('mark_read', { ch: channel, upto: newest }).then(() => reloadRooms())
    }
  }, [channel, reloadRooms])

  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 4000)
    return () => clearInterval(t)
  }, [load])

  // Neu-Linie einmalig beim Öffnen setzen
  useEffect(() => {
    if (!msgs || !firstLoad.current) return
    const n = unreadAtOpen.current ?? 0
    const others = msgs.filter(m => m.profile_id !== me.id)
    if (n > 0 && others.length) setDivider(others[Math.max(0, others.length - n)].id)
  }, [msgs, me.id])

  // Scrollen: beim Öffnen zur Neu-Linie oder ganz nach unten, später nur wenn man ohnehin unten war
  useEffect(() => {
    const el = list.current
    if (!el || !msgs) return
    if (firstLoad.current) {
      firstLoad.current = false
      const d = el.querySelector('.newline') as HTMLElement | null
      el.scrollTop = d ? d.offsetTop - 12 : el.scrollHeight
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) el.scrollTop = el.scrollHeight
  }, [msgs, divider])

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    const { error } = await db().from('messages').insert({ collective_id: me.collective_id, channel, profile_id: me.id, body })
    setSending(false)
    if (error) return toast(errorText(error))
    setText('')
    await load()
    requestAnimationFrame(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight })
  }

  const team = channel === HELFER ? people : people.filter(p => inGewerk(channel, p.id))
  const groups = [['Crew und Admin', team.filter(p => isLeadAccess(p.access))], ['Helfer:innen', team.filter(p => p.access === 'helfer')]] as const
  const manage = !!g && canManage(g.id)

  async function removeMember(pid: string) {
    const { error } = await db().from('gewerk_members').delete().eq('gewerk_id', channel).eq('profile_id', pid)
    if (error) toast(errorText(error)); else { toast('Aus dem Team genommen.'); reloadTeam() }
  }

  return <>
    <div className="stack tight">
      <button className="btn sm" onClick={() => go('bereiche')}><Icon name="bereiche" size={18} />Alle Räume</button>
      <div className="head"><div><h1>{name(channel)}</h1><p className="muted">{team.length} im Team{members.some(m => m.gewerk_id === channel && m.profile_id === me.id) ? ' · du bist dabei' : ''}</p></div></div>
    </div>
    <div className="tabs" role="tablist">
      <button className="tab" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>Chat</button>
      <button className="tab" role="tab" aria-selected={tab === 'team'} onClick={() => setTab('team')}>Team ({team.length})</button>
    </div>

    {tab === 'chat' && <section className="card chatcard">
      <div className="chat" ref={list} aria-live="polite">
        {msgs === null ? <p className="muted">Lädt …</p> : !msgs.length ? <p className="muted">Noch keine Nachrichten. Schreib die erste.</p>
          : msgs.map((m, i) => {
              const mine = m.profile_id === me.id, p = person(m.profile_id)
              return <div key={m.id} className="msgwrap">
                {(i === 0 || dayKey(msgs[i - 1].created_at) !== dayKey(m.created_at)) && <div className="daysep">{dayLabel(m.created_at)}</div>}
                {m.id === divider && <div className="newline">Neu</div>}
                <div className={`msg ${mine ? 'mine' : ''}`}>
                  {!mine && <div className="from">{p?.name ?? 'Unbekannt'}</div>}
                  <div className="text">{m.body}</div><div className="tm">{hhmm(m.created_at)}</div>
                </div></div>
            })}
      </div>
      <form className="addrow" onSubmit={send}>
        <input aria-label="Nachricht" placeholder={`Nachricht an ${name(channel)}`} value={text} maxLength={2000} autoComplete="off" onChange={e => setText(e.target.value)} />
        <button className="btn primary icon" aria-label="Senden" disabled={!text.trim() || sending}><Icon name="send" /></button>
      </form>
    </section>}

    {tab === 'team' && <section className="card stack">
      {groups.map(([label, list2]) => list2.length > 0 && <div key={label}><h3>{label} ({list2.length})</h3>
        <div className="list">{list2.map(p => <div key={p.id} className="item"><Avatar p={p} /><div className="body"><b>{p.name}</b><div className="meta"><span>{ACCESS_LABEL[p.access]}</span></div></div>
          {manage && p.id !== me.id && g && members.some(m => m.gewerk_id === g.id && m.profile_id === p.id) && <button className="btn sm" onClick={() => removeMember(p.id)}>Entfernen</button>}</div>)}</div></div>)}
      {channel === HELFER && <p className="small muted">Hier sind automatisch alle drin, die freigeschaltet sind.</p>}
      {manage && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Person ins Team holen</button>}
    </section>}
    {adding && g && <AddSheet gewerkId={g.id} title={g.name} onClose={() => setAdding(false)} />}
  </>
}

function AddSheet({ gewerkId, title, onClose }: { gewerkId: string; title: string; onClose: () => void }) {
  const { people, inGewerk, reload } = useTeam()
  const [q, setQ] = useState('')
  const cands = people.filter(p => !inGewerk(gewerkId, p.id) && p.name.toLowerCase().includes(q.toLowerCase()))
  async function add(pid: string) {
    const { error } = await db().from('gewerk_members').insert({ gewerk_id: gewerkId, profile_id: pid })
    if (error) toast(errorText(error)); else { toast('Ins Team geholt.'); reload() }
  }
  return (
    <Sheet title="Ins Team holen" onClose={onClose}>
      <h2>Ins Team {title} holen</h2>
      <input placeholder="Name suchen" aria-label="Name suchen" value={q} onChange={e => setQ(e.target.value)} />
      <div className="list">{cands.map(p => <div key={p.id} className="item"><Avatar p={p} /><div className="body"><b>{p.name}</b><div className="meta"><span>{ACCESS_LABEL[p.access]}</span></div></div>
        <button className="btn sm primary" onClick={() => add(p.id)}>Hinzufügen</button></div>)}
        {!cands.length && <p className="muted">Niemand gefunden.</p>}</div>
      <button className="btn" onClick={onClose}>Fertig</button>
    </Sheet>
  )
}
