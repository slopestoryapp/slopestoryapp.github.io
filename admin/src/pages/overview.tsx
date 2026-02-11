import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { timeAgo } from '@/lib/utils'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Users,
  UserPlus,
  Mountain,
  ShieldAlert,
  Inbox,
  ImagePlus,
  LifeBuoy,
  CalendarDays,
} from 'lucide-react'

interface Metrics {
  totalUsers: number
  newUsersThisWeek: number
  verifiedResorts: number
  unverifiedResorts: number
  pendingSubmissions: number
  pendingPhotos: number
  openTickets: number
  totalVisits: number
}

interface AuditEntry {
  id: string
  admin_email: string
  action: string
  entity_type: string
  created_at: string
}

export function OverviewPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [activity, setActivity] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString()

      const [
        totalUsersRes,
        newUsersRes,
        verifiedRes,
        unverifiedRes,
        pendingSubsRes,
        pendingPhotosRes,
        openTicketsRes,
        totalVisitsRes,
        activityRes,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true }),
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', sevenDaysAgo),
        supabase
          .from('resorts')
          .select('*', { count: 'exact', head: true })
          .eq('verified', true),
        supabase
          .from('resorts')
          .select('*', { count: 'exact', head: true })
          .eq('verified', false),
        supabase
          .from('resort_submissions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('resort_feature_photo_submissions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('support_requests')
          .select('*', { count: 'exact', head: true })
          .in('status', ['pending', 'in_progress']),
        supabase
          .from('user_visits')
          .select('*', { count: 'exact', head: true }),
        supabase
          .from('admin_audit_log')
          .select('id, admin_email, action, entity_type, created_at')
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      setMetrics({
        totalUsers: totalUsersRes.count ?? 0,
        newUsersThisWeek: newUsersRes.count ?? 0,
        verifiedResorts: verifiedRes.count ?? 0,
        unverifiedResorts: unverifiedRes.count ?? 0,
        pendingSubmissions: pendingSubsRes.count ?? 0,
        pendingPhotos: pendingPhotosRes.count ?? 0,
        openTickets: openTicketsRes.count ?? 0,
        totalVisits: totalVisitsRes.count ?? 0,
      })

      setActivity((activityRes.data as AuditEntry[]) ?? [])
    } catch {
      // Silently fail — metrics will show 0
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadData()
  }, [loadData])

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Overview"
        subtitle="Key metrics and recent activity"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))
          ) : metrics ? (
            <>
              <StatsCard label="Total Users" value={metrics.totalUsers} />
              <StatsCard
                label="New Users This Week"
                value={metrics.newUsersThisWeek}
              />
              <StatsCard
                label="Verified Resorts"
                value={metrics.verifiedResorts}
              />
              <StatsCard
                label="Unverified Resorts"
                value={metrics.unverifiedResorts}
              />
              <StatsCard
                label="Pending Submissions"
                value={metrics.pendingSubmissions}
              />
              <StatsCard
                label="Pending Photos"
                value={metrics.pendingPhotos}
              />
              <StatsCard
                label="Open Tickets"
                value={metrics.openTickets}
              />
              <StatsCard
                label="Total Visits"
                value={metrics.totalVisits}
              />
            </>
          ) : null}
        </div>

        {/* Recent Activity */}
        <div className="bg-card border border-border rounded-xl">
          <div className="p-5 border-b border-border">
            <h2 className="text-sm font-semibold">Recent Activity</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last 10 admin actions
            </p>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted-foreground">
              No recent activity
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="divide-y divide-border">
                {activity.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {entry.action}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {entry.admin_email}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant="secondary" className="text-[10px]">
                        {entry.entity_type}
                      </Badge>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgo(entry.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  )
}
