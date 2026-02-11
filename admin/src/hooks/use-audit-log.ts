import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface AuditEntry {
  action: string
  entity_type: string
  entity_id?: string
  details?: Record<string, unknown>
}

export function useAuditLog() {
  const log = useCallback(async (entry: AuditEntry) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const email = session?.user?.email ?? 'unknown'

      await supabase.from('admin_audit_log').insert({
        admin_email: email,
        action: entry.action,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id ?? null,
        details: entry.details ?? null,
      })
    } catch (err) {
      console.error('Failed to write audit log:', err)
    }
  }, [])

  return { log }
}
