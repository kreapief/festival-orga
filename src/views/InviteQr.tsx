import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { useTeam } from '../lib/team'
import { db, errorText } from '../lib/supabase'
import { appLink } from '../lib/route'
import { Icon, Sheet, copyText, toast } from '../lib/ui'

// QR-Code als scharfes Vektorbild, direkt im Browser erzeugt (kein Internet nötig)
export function Qr({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text); qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
    return { size: n + 8, path: d } // 4 Felder weißer Rand, damit Kameras den Code sicher erkennen
  }, [text])
  return (
    <svg className="qrcode" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR-Code zum Scannen" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" /><path d={path} fill="#000" />
    </svg>
  )
}

export function QrSheet({ code, title, hint, onClose }: { code: string; title: string; hint: string; onClose: () => void }) {
  const link = appLink('join/' + code)
  // Bildschirm anlassen, solange der Code gezeigt wird (klappt nicht überall, ist dann egal)
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock?.request('screen').then(l => { lock = l }).catch(() => {})
    return () => { lock?.release().catch(() => {}) }
  }, [])
  return (
    <Sheet title={title} onClose={onClose}>
      <h2>{title}</h2>
      <p className="muted">{hint}</p>
      <div className="qrbox"><Qr text={link} /></div>
      <p className="small muted center">Mit der Handykamera scannen. Dann Namen eintippen, fertig.</p>
      <div className="row end"><button className="btn" onClick={() => copyText(link, 'Link kopiert.')}><Icon name="copy" size={18} />Link kopieren</button>
        <button className="btn primary" onClick={onClose}>Fertig</button></div>
    </Sheet>
  )
}

// Knopf für die Startseite und die Menschen-Seite: zeigt den Helfer:innen-QR-Code
export function HelferQrButton({ primary }: { primary?: boolean }) {
  const { isLead } = useTeam()
  const [code, setCode] = useState<string | null>(null)
  if (!isLead) return null
  async function open() {
    const { data, error } = await db().from('invites').select('code').eq('access', 'helfer').eq('active', true).is('gewerk_id', null).limit(1).maybeSingle()
    if (error || !data) return toast(error ? errorText(error) : 'Es gibt gerade keinen gültigen Helfer:innen-Link. Der Admin kann einen neuen erzeugen.')
    setCode(data.code)
  }
  return <>
    <button className={`btn ${primary ? 'primary' : ''}`} onClick={open}>QR-Code für neue Helfer:innen</button>
    {code && <QrSheet code={code} title="Helfer:in einladen" hint="Wer diesen Code scannt, ist automatisch Helfer:in." onClose={() => setCode(null)} />}
  </>
}
