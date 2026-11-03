import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { demoClient } from './demo'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

// Demo-Modus nur beim Entwickeln: localhost:5173/?demo=helfer (fällt im fertigen Build weg)
const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('demo') : null

// Ohne Zugangsdaten zeigt die App eine Einrichtungs-Seite statt abzustürzen
export const supabase: SupabaseClient | null = demo ? demoClient(demo)
  : url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'festival-orga-auth' } })
  : null

export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase ist nicht eingerichtet')
  return supabase
}

// Fehler aus der Datenbank in verständliche Sätze übersetzen
export function errorText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e)
  if (msg.includes('Anonymous sign-ins are disabled')) return 'Die Anmeldung übers Gerät ist in Supabase noch nicht eingeschaltet.'
  if (msg.includes('Failed to fetch')) return 'Keine Verbindung. Prüf dein Internet und versuch es noch mal.'
  if (msg.includes('profiles_name_eindeutig')) return 'Diesen Namen gibt es schon. Schreib noch deinen Nachnamen oder einen Buchstaben dazu, zum Beispiel „Lisa M.“.'
  return msg
}
