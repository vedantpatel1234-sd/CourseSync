import { supabase } from './supabase'

type NotificationType = 'notify_assigned' | 'notify_unassigned' | 'notify_qualification_verified'

interface NotificationPrefsRow {
  notify_assigned: boolean
  notify_unassigned: boolean
  notify_qualification_verified: boolean
}

export async function notifyInstructor(instructorId: string, type: NotificationType, message: string) {
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('notify_assigned, notify_unassigned, notify_qualification_verified')
    .eq('user_id', instructorId)
    .single()

  // No saved row yet means the instructor has never visited the Notifications
  // page — default to notifying, matching that page's own default toggle state.
  const enabled = prefs ? (prefs as NotificationPrefsRow)[type] : true
  if (!enabled) return

  await supabase.from('notifications').insert({
    user_id: instructorId,
    type,
    message
  })
}
