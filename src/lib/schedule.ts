import { useCallback, useEffect, useState } from 'react'
import { db, errorText } from './supabase'
import { toast } from './ui'
import type { Collective, Shift, Slot, Termin } from './types'

// Festivaltage, Schichten, Timetable und Termine in einem Rutsch laden
export function useSchedule() {
  const [coll, setColl] = useState<Collective | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [termine, setTermine] = useState<Termin[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [c, s, l, e] = await Promise.all([
      db().from('collectives').select('id,name,fest_start,fest_days').single(),
      db().from('shifts').select('id,gewerk_id,area,day,start_time,end_time,need,shift_members(profile_id)').order('day').order('start_time'),
      db().from('lineup_slots').select('id,day,start_time,end_time,profile_id').order('day').order('start_time'),
      db().from('events').select('id,date,time,title').order('date'),
    ])
    const err = c.error ?? s.error ?? l.error ?? e.error
    if (err) toast(errorText(err))
    if (c.data) setColl(c.data)
    if (s.data) setShifts(s.data as Shift[])
    if (l.data) setSlots(l.data)
    if (e.data) setTermine(e.data)
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])
  return { coll, shifts, slots, termine, loading, reload }
}

export const hhmm = (t: string | null) => t ? t.slice(0, 5) : ''
const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Datum eines Festivaltags (0 = erster Tag), solange fest_start gesetzt ist
export function dayDate(coll: Collective | null, day: number): string | null {
  if (!coll?.fest_start) return null
  const d = new Date(coll.fest_start + 'T12:00')
  d.setDate(d.getDate() + day)
  return isoDate(d)
}

export function dayLabel(coll: Collective | null, day: number): string {
  const d = dayDate(coll, day)
  return d ? new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) : `Tag ${day + 1}`
}

export const dayCount = (coll: Collective | null) => coll?.fest_days ?? 3

// Startzeitpunkt einer Schicht oder eines Slots als Datum
export function startAt(coll: Collective | null, day: number, time: string): Date | null {
  const d = dayDate(coll, day)
  return d ? new Date(`${d}T${hhmm(time)}`) : null
}

export function relDay(d: Date, now = new Date()): string {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((b.getTime() - a.getTime()) / 864e5)
  return diff === 0 ? 'heute' : diff === 1 ? 'morgen' : d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function fmtCountdown(ms: number, precise: boolean): string {
  if (ms <= 0) return 'Jetzt!'
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60
  if (d >= 2 && !precise) return `in ${d} Tagen`
  const parts: string[] = []
  if (d) parts.push(`${d} ${d === 1 ? 'Tag' : 'Tage'}`)
  if (d || h) parts.push(`${h} Std`)
  parts.push(`${m} Min`)
  if (precise || (!d && !h)) parts.push(`${sec} Sek`)
  return 'in ' + parts.join(' ')
}

// Eigene Schichten und Auftritte mit echtem Startzeitpunkt, sortiert
export type Commitment = { kind: 'Schicht' | 'Auftritt'; title: string; day: number; from: string; to: string; start: Date }
export function myCommitments(coll: Collective | null, shifts: Shift[], slots: Slot[], me: string): Commitment[] {
  const out: Commitment[] = []
  for (const s of shifts) if (s.shift_members.some(m => m.profile_id === me)) {
    const start = startAt(coll, s.day, s.start_time)
    if (start) out.push({ kind: 'Schicht', title: s.area, day: s.day, from: hhmm(s.start_time), to: hhmm(s.end_time), start })
  }
  for (const l of slots) if (l.profile_id === me) {
    const start = startAt(coll, l.day, l.start_time)
    if (start) out.push({ kind: 'Auftritt', title: 'Dein Set', day: l.day, from: hhmm(l.start_time), to: hhmm(l.end_time), start })
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}
