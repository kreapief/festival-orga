import { useEffect, useRef, useState } from 'react'

// Mit dem Finger von oben nach unten ziehen, um die App zu aktualisieren (wie bei anderen Apps).
// Läuft nur ganz oben auf der Seite und nicht in Chats, Fenstern oder Eingabefeldern.
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<void> | void }) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const start = useRef<number | null>(null)
  const value = useRef(0)
  const refresh = useRef(onRefresh)
  refresh.current = onRefresh

  useEffect(() => {
    const LIMIT = 90, TRIGGER = 60
    const onStart = (e: TouchEvent) => {
      const el = e.target as HTMLElement | null
      start.current = window.scrollY > 0 || el?.closest('.scrim, .chat, input, textarea, select') ? null : e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return
      const dy = e.touches[0].clientY - start.current
      if (dy > 0 && window.scrollY === 0) { value.current = Math.min(dy * 0.5, LIMIT); setPull(value.current) }
      else if (value.current) { value.current = 0; setPull(0) }
    }
    const onEnd = async () => {
      const v = value.current
      start.current = null; value.current = 0
      if (v < TRIGGER) return setPull(0)
      setBusy(true); setPull(TRIGGER)
      await Promise.all([Promise.resolve(refresh.current()), new Promise(r => setTimeout(r, 700))])
      setBusy(false); setPull(0)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart); window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd); window.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  if (!pull && !busy) return null
  const ready = pull >= 60
  return (
    <div className="pull" style={{ transform: `translateY(${pull - 44}px)` }} role="status" aria-live="polite">
      <span className={`pullicon ${busy ? 'spin' : ''}`} style={{ transform: busy ? undefined : `rotate(${Math.min(pull / 60, 1) * 180}deg)` }} aria-hidden="true">↓</span>
      {busy ? 'Aktualisiert …' : ready ? 'Loslassen zum Aktualisieren' : 'Zum Aktualisieren ziehen'}
    </div>
  )
}
