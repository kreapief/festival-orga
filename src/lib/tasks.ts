import { useCallback, useEffect, useState } from 'react'
import { db, errorText } from './supabase'
import { toast } from './ui'
import type { Prio, Task } from './types'

// Welche Aufgaben jemand sieht, entscheidet die Datenbank (Helfer:innen: eigene + offene aus ihren Bereichen)
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    const { data, error } = await db().from('tasks')
      .select('id,gewerk_id,title,due_date,due_time,prio,created_by,done,task_assignees(profile_id,claimed,reported_done)')
      .order('due_date', { nullsFirst: false })
    if (error) toast(errorText(error))
    else setTasks(data as Task[])
    setLoading(false)
  }, [])
  useEffect(() => { reload() }, [reload])
  return { tasks, loading, reload }
}

async function run(p: PromiseLike<{ error: unknown }>, ok: string) {
  const { error } = await p
  if (error) { toast(errorText(error)); return false }
  toast(ok); return true
}

export const setDone = (id: string, done: boolean) =>
  run(db().from('tasks').update({ done }).eq('id', id), done ? 'Als erledigt abgehakt.' : 'Wieder offen.')
export const reportDone = (id: string) =>
  run(db().rpc('report_task_done', { p_task: id }), 'Gemeldet. Die Person, die die Aufgabe erstellt hat, hakt sie ab.')
export const claimTask = (id: string) =>
  run(db().rpc('claim_task', { p_task: id }), 'Du hast die Aufgabe übernommen.')

export type NewTask = { title: string; gewerk_id: string; due_date: string; due_time: string; prio: Prio; who: string[] }

export async function createTask(t: NewTask, collectiveId: string, meId: string) {
  const { data, error } = await db().from('tasks').insert({
    collective_id: collectiveId, created_by: meId, title: t.title.trim(), gewerk_id: t.gewerk_id || null,
    due_date: t.due_date || null, due_time: t.due_time || null, prio: t.prio,
  }).select('id').single()
  if (error) { toast(errorText(error)); return false }
  if (t.who.length) {
    const { error: e2 } = await db().from('task_assignees').insert(t.who.map(profile_id => ({ task_id: data.id, profile_id })))
    if (e2) { toast(errorText(e2)); return false }
  }
  toast(t.who.length ? `Aufgabe angelegt für ${t.who.length} ${t.who.length === 1 ? 'Person' : 'Personen'}.` : 'Offene Aufgabe angelegt. Leute aus dem Bereich können sie übernehmen.')
  return true
}
