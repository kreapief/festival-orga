import { useCallback, useEffect, useState } from 'react'
import { supabase, db, errorText } from './lib/supabase'
import { useRoute } from './lib/route'
import { TeamProvider } from './lib/team'
import { Toaster } from './lib/ui'
import type { Profile } from './lib/types'
import { Join, NoAccess, Relogin, Setup } from './views/Start'
import { Shell } from './views/Shell'
import { Gaeste } from './views/Gaeste'

type Boot = { state: 'loading' } | { state: 'out' } | { state: 'in'; me: Profile } | { state: 'error'; msg: string }

export default function App() {
  const route = useRoute()
  const [boot, setBoot] = useState<Boot>({ state: 'loading' })

  // Ist dieses Gerät angemeldet, und gehört es zu einem Profil?
  const load = useCallback(async () => {
    if (!supabase) return
    try {
      const { data: { session } } = await db().auth.getSession()
      if (!session) return setBoot({ state: 'out' })
      const { data, error } = await db().from('profiles').select('*').eq('user_id', session.user.id).maybeSingle()
      if (error) throw error
      setBoot(data ? { state: 'in', me: data } : { state: 'out' })
    } catch (e) { setBoot({ state: 'error', msg: errorText(e) }) }
  }, [])

  useEffect(() => { load() }, [load])

  let page
  if (!supabase) page = <Setup />
  else if (route.name === 'join') page = <Join code={route.code} me={boot.state === 'in' ? boot.me : null} onDone={load} />
  else if (route.name === 'gaeste') page = <Gaeste />
  else if (route.name === 'wieder') page = <Relogin token={route.token} onDone={load} />
  else if (boot.state === 'loading') page = <div className="wait muted" aria-busy="true">Lädt …</div>
  else if (boot.state === 'error') page = <div className="card stack wait"><h1>Keine Verbindung</h1><p className="error">{boot.msg}</p><button className="btn" onClick={load}>Noch mal versuchen</button></div>
  else if (boot.state === 'out') page = <NoAccess />
  else page = <TeamProvider me={boot.me} onMeChanged={load}><Shell view={route.view} param={route.param} /></TeamProvider>

  return <>{page}<Toaster /></>
}
