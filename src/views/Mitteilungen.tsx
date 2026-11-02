import { useEffect, useState } from 'react'
import { useChat } from '../lib/chat'
import { go } from '../lib/route'
import { Icon, Sheet } from '../lib/ui'

function when(iso: string): string {
  const d = new Date(iso), now = new Date(), y = new Date(now.getTime() - 864e5)
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === now.toDateString() ? `heute, ${time}` : d.toDateString() === y.toDateString() ? `gestern, ${time}`
    : `${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}, ${time}`
}

export function BellButton() {
  const { unreadNotes } = useChat()
  const [open, setOpen] = useState(false)
  return <>
    <button className="btn icon bell" aria-label={`Mitteilungen${unreadNotes ? `, ${unreadNotes} neu` : ''}`} onClick={() => setOpen(true)}>
      <Icon name="bell" />{unreadNotes > 0 && <span className="count">{unreadNotes}</span>}
    </button>
    {open && <NotesSheet onClose={() => setOpen(false)} />}
  </>
}

function NotesSheet({ onClose }: { onClose: () => void }) {
  const { notes, markNotesRead } = useChat()
  // Was beim Öffnen neu war, bleibt in dieser Ansicht als „Neu“ markiert
  const [fresh] = useState(() => new Set(notes.filter(n => !n.read_at).map(n => n.id)))
  useEffect(() => { if (fresh.size) markNotesRead() }, [fresh, markNotesRead])
  return (
    <Sheet title="Mitteilungen" onClose={onClose}>
      <h2>Mitteilungen</h2>
      {notes.length ? <div className="list">{notes.map(n => (
        <button key={n.id} className="item notebtn" onClick={() => { onClose(); if (n.link) go(n.link) }}>
          <div className="body">{fresh.has(n.id) && <span className="tag prio hoch">Neu</span>} {n.body}
            <div className="meta"><span>{when(n.created_at)}</span></div></div>
        </button>))}</div>
        : <p className="muted">Noch keine Mitteilungen. Hier erfährst du, wenn dich etwas betrifft, zum Beispiel eine geänderte Schicht.</p>}
      <button className="btn" onClick={onClose}>Fertig</button>
    </Sheet>
  )
}
