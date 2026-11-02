import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { db } from './supabase'
import type { Note, RoomInfo } from './types'

type Live = {
  rooms: RoomInfo[]; unread: number
  notes: Note[]; unreadNotes: number
  tokens: { total: number; used: number }
  reload: () => Promise<void>
  markNotesRead: () => Promise<void>
}
const Ctx = createContext<Live | null>(null)

// Raumliste (mit ungelesenen Nachrichten) und Mitteilungen. Wird alle 15 Sekunden und beim Zurückkehren in die App aufgefrischt.
export function ChatProvider({ children }: { children: ReactNode }) {
  const [rooms, setRooms] = useState<RoomInfo[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [tokens, setTokens] = useState({ total: 0, used: 0 })

  const reload = useCallback(async () => {
    const [r, n, tk] = await Promise.all([
      db().rpc('chat_overview'),
      db().from('notifications').select('id,body,link,created_at,read_at').order('created_at', { ascending: false }).limit(60),
      db().rpc('my_tokens'),
    ])
    const row = (tk.data as { total: number; used: number }[] | null)?.[0]
    if (!tk.error && row) setTokens({ total: Number(row.total), used: Number(row.used) })
    if (!r.error && r.data) setRooms((r.data as RoomInfo[]).map(x => ({ ...x, unread: Number(x.unread) })))
    if (!n.error && n.data) setNotes((n.data as Note[]).sort((a, b) => b.created_at.localeCompare(a.created_at)))
  }, [])

  const markNotesRead = useCallback(async () => {
    setNotes(list => list.map(x => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })))
    await db().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  }, [])

  useEffect(() => {
    reload()
    const t = setInterval(reload, 15000)
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [reload])

  const unread = rooms.reduce((n, r) => n + r.unread, 0)
  const unreadNotes = notes.filter(n => !n.read_at).length
  return <Ctx.Provider value={{ rooms, unread, notes, unreadNotes, tokens, reload, markNotesRead }}>{children}</Ctx.Provider>
}

export function useChat(): Live {
  const c = useContext(Ctx)
  if (!c) throw new Error('useChat außerhalb von ChatProvider')
  return c
}
