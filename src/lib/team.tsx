import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { db } from './supabase'
import { isLeadAccess, type Gewerk, type Member, type Profile } from './types'

type Team = {
  me: Profile
  people: Profile[]
  gewerke: Gewerk[]
  members: Member[]
  isLead: boolean
  isAdmin: boolean
  person: (id: string | null) => Profile | undefined
  gewerkName: (id: string | null) => string
  inGewerk: (g: string | null, p?: string) => boolean
  // Admin immer, Crew in eigenen Bereichen und bei den DJs (wie in der Datenbank)
  canManage: (g: string) => boolean
  reload: () => Promise<void>
}

const Ctx = createContext<Team | null>(null)

export function TeamProvider({ me, onMeChanged, children }: { me: Profile; onMeChanged: () => void; children: ReactNode }) {
  const [people, setPeople] = useState<Profile[]>([me])
  const [gewerke, setGewerke] = useState<Gewerk[]>([])
  const [members, setMembers] = useState<Member[]>([])

  const reload = useCallback(async () => {
    const [p, g, m] = await Promise.all([
      db().from('profiles').select('*').order('name'),
      db().from('gewerke').select('id,name,kind,sort').order('sort'),
      db().from('gewerk_members').select('gewerk_id,profile_id'),
    ])
    if (p.data) setPeople(p.data)
    if (g.data) setGewerke(g.data)
    if (m.data) setMembers(m.data)
    // Der eigene Zugang kann sich geändert haben
    const fresh = p.data?.find(x => x.id === me.id)
    if (fresh && (fresh.access !== me.access || fresh.name !== me.name)) onMeChanged()
  }, [me.id, me.access, me.name, onMeChanged])

  useEffect(() => { reload() }, [reload])

  const inGewerk = (g: string | null, p = me.id) => !!g && members.some(x => x.gewerk_id === g && x.profile_id === p)
  const value: Team = {
    me, people, gewerke, members,
    isLead: isLeadAccess(me.access),
    isAdmin: me.access === 'admin',
    person: id => people.find(p => p.id === id),
    gewerkName: id => gewerke.find(g => g.id === id)?.name ?? '',
    inGewerk,
    canManage: g => me.access === 'admin' || (me.access === 'crew' && (inGewerk(g) || gewerke.find(x => x.id === g)?.kind === 'djs')),
    reload,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTeam(): Team {
  const t = useContext(Ctx)
  if (!t) throw new Error('useTeam außerhalb von TeamProvider')
  return t
}
