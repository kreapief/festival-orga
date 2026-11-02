import { useEffect, useState, type ReactNode } from 'react'
import type { Profile } from './types'

const PATHS: Record<string, string> = {
  heute: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  aufgaben: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  menschen: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3.2 3.9 1.8 4.5 4.5"/>',
  profil: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-7 8-7s7 2.5 8 7"/>',
  schichten: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  kalender: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  lineup: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  einstellungen: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  bereiche: '<path d="M4 5h16v11H9l-5 4z"/>',
  dateien: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  bell: '<path d="M6 16v-5a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
  send: '<path d="M4 12l16-8-6 16-2-6z"/>',
  mehr: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
}

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[name] ?? '' }} />
}

export const initials = (n: string) => n.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()

export function Avatar({ p, size }: { p: Pick<Profile, 'name' | 'photo_url'>; size?: 'xs' | 'sm' }) {
  return <span className={`avatar ${size ?? ''}`} aria-hidden="true">{p.photo_url ? <img src={p.photo_url} alt="" /> : initials(p.name)}</span>
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [onClose])
  return (
    <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>{children}</div>
    </div>
  )
}

// Kurze Rückmeldung unten
let pushToast: ((msg: string) => void) | null = null
export const toast = (msg: string) => pushToast?.(msg)
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t: number | undefined
    pushToast = m => { setMsg(m); clearTimeout(t); t = window.setTimeout(() => setMsg(null), 4500) }
    return () => { pushToast = null; clearTimeout(t) }
  }, [])
  return msg ? <div className="toast" role="status">{msg}</div> : null
}

export async function copyText(text: string, okMsg: string) {
  try { await navigator.clipboard.writeText(text); toast(okMsg) }
  catch { toast(text) }
}

export const fmtDate = (d: string) => new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
