export type Access = 'admin' | 'crew' | 'helfer'
export type Prio = 'hoch' | 'mittel' | 'niedrig'

export type Profile = {
  id: string
  collective_id: string
  user_id: string | null
  name: string
  access: Access
  photo_url: string | null
  act_name: string | null
  act_genre: string | null
  tokens_override: number | null
}

export type Collective = {
  id: string; name: string; fest_start: string | null; fest_days: number
  tokens_helfer: number; tokens_crew: number; tokens_admin: number; guest_text: string | null; guest_packlist: string[]
}
export type Shift = {
  id: string; gewerk_id: string | null; area: string; day: number
  start_time: string; end_time: string; need: number
  shift_members: { profile_id: string }[]
}
export type Slot = { id: string; day: number; start_time: string; end_time: string; profile_id: string | null; act_name: string | null; act_genre: string | null }
export type Termin = { id: string; date: string; time: string | null; title: string }

export type Gewerk = { id: string; name: string; kind: 'orga' | 'djs' | null; sort: number; tokens: number }
export type Member = { gewerk_id: string; profile_id: string }

export type Assignee = { profile_id: string; claimed: boolean; reported_done: boolean }

export type Task = {
  id: string
  gewerk_id: string | null
  title: string
  due_date: string | null
  due_time: string | null
  prio: Prio
  created_by: string | null
  done: boolean
  done_at: string | null
  task_assignees: Assignee[]
}

export type Message = { id: string; channel: string; profile_id: string; body: string; created_at: string }
export type RoomInfo = { channel: string; last_body: string | null; last_at: string | null; last_name: string | null; unread: number }
export type Note = { id: string; body: string; link: string | null; created_at: string; read_at: string | null }
export type Folder = { id: string; name: string; note: string | null; url: string | null; crew_only: boolean; guest_visible: boolean; sort: number }
export type Redemption = { id: string; profile_id: string; redeemed_at: string }

export type Invite = { id: string; code: string; access: Access; gewerk_id: string | null; active: boolean }

export const ACCESS_LABEL: Record<Access, string> = { admin: 'Admin', crew: 'Crew', helfer: 'Helfer:in' }
export const PRIO_LABEL: Record<Prio, string> = { hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig' }
export const PRIO_ICON: Record<Prio, string> = { hoch: '▲▲', mittel: '▲', niedrig: '▽' }
export const isLeadAccess = (a: Access) => a === 'admin' || a === 'crew'
