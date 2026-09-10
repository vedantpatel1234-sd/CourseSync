import { supabase } from './supabase'

export async function logAction(
  userId: string,
  action: string,
  entity: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  await supabase.from('audit_logs').insert({
    user_id: userId,
    action,
    entity,
    entity_id: entityId || null,
    details: details || null,
  })
}