import { useCallback, useEffect, useRef, useState } from 'react'
import { useTeam } from '../lib/team'
import { useChat } from '../lib/chat'
import { db, errorText } from '../lib/supabase'
import { Icon, toast } from '../lib/ui'
import type { Redemption } from '../lib/types'

const when = (iso: string) => {
  const d = new Date(iso), now = new Date(), time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === now.toDateString() ? `heute, ${time} Uhr` : `${d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time} Uhr`
}

// Schieber zum Einlösen: nach rechts wischen. Per Tastatur geht auch die Pfeiltaste rechts.
function Swipe({ onDone }: { onDone: () => Promise<boolean> }) {
  const box = useRef<HTMLDivElement>(null)
  const [x, setX] = useState(0)
  const [snap, setSnap] = useState(true)
  const startX = useRef<number | null>(null)
  const busy = useRef(false)
  const KNOB = 56
  const max = () => (box.current?.clientWidth ?? 300) - KNOB - 8

  async function finish(at: number) {
    startX.current = null; setSnap(true)
    if (at >= max() * 0.9 && !busy.current) {
      busy.current = true; setX(max())
      const ok = await onDone()
      busy.current = false
      if (!ok) setX(0); else setTimeout(() => setX(0), 400)
    } else setX(0)
  }
  return (
    <div className="swipe" ref={box}>
      <div className="sfill" style={{ width: x + KNOB / 2, transition: snap ? 'width .2s' : 'none' }} />
      <span className="slabel">Zum Einlösen wischen</span>
      <button className="knob" aria-label="Marke einlösen: nach rechts wischen oder Pfeiltaste rechts drücken" style={{ transform: `translateX(${x}px)`, transition: snap ? 'transform .2s' : 'none' }}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startX.current = e.clientX - x; setSnap(false) }}
        onPointerMove={e => { if (startX.current !== null) setX(Math.max(0, Math.min(max(), e.clientX - startX.current))) }}
        onPointerUp={() => { if (startX.current !== null) finish(x) }}
        onPointerCancel={() => { startX.current = null; setSnap(true); setX(0) }}
        onKeyDown={e => {
          if (e.key === 'ArrowRight') { e.preventDefault(); const n = Math.min(max(), x + max() / 4); setSnap(true); setX(n); if (n >= max()) finish(n) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); setSnap(true); setX(Math.max(0, x - max() / 4)) }
        }}><Icon name="mehr" size={22} /></button>
    </div>
  )
}

// Grüner Vollbild-Bildschirm mit Live-Uhr: So sieht die Bar, dass die Marke gerade entwertet wurde (kein Screenshot)
function Redeemed({ name, left, total, onClose }: { name: string; left: number; total: number; onClose: () => void }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="redeemed" role="alertdialog" aria-label="Marke eingelöst">
      <div className="badge"><span className="ring" aria-hidden="true" /><Icon name="check" size={64} /></div>
      <h2>Marke eingelöst</h2>
      <div className="clock">{now.toLocaleTimeString('de-DE')}</div>
      <div><b>{name}</b><br />Noch {left} von {total} übrig</div>
      <p className="small" style={{ maxWidth: 320 }}>Die Uhr läuft live. So sieht die Bar, dass es kein Screenshot ist.</p>
      <button className="btn" onClick={onClose}>Fertig</button>
    </div>
  )
}

export function Marken() {
  const { me, isLead, person } = useTeam()
  const { tokens, reload } = useChat()
  const [list, setList] = useState<Redemption[]>([])
  const [done, setDone] = useState<{ left: number } | null>(null)
  const left = Math.max(0, tokens.total - tokens.used)

  const load = useCallback(async () => {
    const { data, error } = await db().from('token_redemptions').select('id,profile_id,redeemed_at').order('redeemed_at', { ascending: false }).limit(300)
    if (error) toast(errorText(error)); else setList(data as Redemption[])
  }, [])
  useEffect(() => { load() }, [load])

  async function redeem(): Promise<boolean> {
    const { error } = await db().rpc('redeem_token')
    if (error) { toast(errorText(error)); reload(); return false }
    setDone({ left: left - 1 }); reload(); load()
    return true
  }
  async function refund(pid: string) {
    const { error } = await db().rpc('refund_token', { p_profile: pid })
    if (error) toast(errorText(error)); else { toast('Marke zurückgegeben.'); load(); reload() }
  }

  const mine = list.filter(r => r.profile_id === me.id)
  const seen = new Set<string>()
  const latest = new Set(list.filter(r => { const first = !seen.has(r.profile_id); seen.add(r.profile_id); return first }).map(r => r.id))

  return <>
    <div className="head"><div><h1>Getränkemarken</h1><p className="muted">Zeig dein Handy an der Bar und wisch die Marke vor den Augen der Bar-Crew weg.</p></div></div>

    {tokens.total > 0 && <section className="card stack" style={{ gap: 16 }}>
      <div><div className="big">{left} von {tokens.total}</div><div className="muted">Marken übrig fürs ganze Festival</div></div>
      <div className="tokens" aria-hidden="true">{Array.from({ length: tokens.total }, (_, i) => <span key={i} className={`token ${i < tokens.used ? 'used' : ''}`}>{i + 1}</span>)}</div>
      {left > 0 ? <><Swipe onDone={redeem} /><p className="small muted">Erst an der Bar wischen. Eingelöst ist eingelöst, nur die Crew kann eine Marke zurückgeben.</p></>
        : <p className="note">Alle Marken sind eingelöst.</p>}
    </section>}

    {mine.length > 0 && <section className="card stack"><h2>Schon eingelöst</h2>
      <div className="list">{[...mine].reverse().map((r, i) => <div key={r.id} className="item"><span className="kind">Marke {i + 1}</span><div className="body">{when(r.redeemed_at)}</div></div>)}</div></section>}

    {isLead && <section className="card stack"><h2>Protokoll</h2>
      <p className="small muted">Alle eingelösten Marken, zum Gegenprüfen an der Bar. Bei Versehen gibst du die letzte Marke einer Person zurück.</p>
      {list.length ? <div className="list">{list.map(r => <div key={r.id} className="item"><div className="body"><b>{person(r.profile_id)?.name ?? 'Unbekannt'}</b><div className="meta"><span>{when(r.redeemed_at)}</span></div></div>
        {latest.has(r.id) && <button className="btn sm" onClick={() => refund(r.profile_id)}>Zurückgeben</button>}</div>)}</div>
        : <p className="muted">Noch keine Marke eingelöst.</p>}</section>}

    {done && <Redeemed name={me.name} left={done.left} total={tokens.total} onClose={() => setDone(null)} />}
  </>
}
