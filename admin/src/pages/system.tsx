import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Activity,
  AlertTriangle,
  Cloud,
  Database,
  ExternalLink,
  HardDrive,
  Loader2,
  Server,
  Zap,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableStat {
  label: string
  count: number | null
  error?: boolean
  sub?: { label: string; count: number | null }[]
}

interface EdgeFunction {
  name: string
  description: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPABASE_PROJECT_REF = 'rnudbfdhrenesamdjzdk'
const SUPABASE_DASHBOARD_BASE = `https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}`

const EDGE_FUNCTIONS: EdgeFunction[] = [
  { name: 'admin-delete-user', description: 'Delete a user account (admin action)' },
  { name: 'process-resort-image', description: 'Process and optimize resort images' },
  { name: 'notify-user-resort-approved', description: 'Notify user when their resort submission is approved' },
  { name: 'notify-resort-submission', description: 'Notify admins of new resort submissions' },
  { name: 'send-support-notification', description: 'Send notifications for support requests' },
  { name: 'notify-password-changed', description: 'Notify user of password change' },
  { name: 'delete-user-account', description: 'User-initiated account deletion' },
  { name: 'discover-resorts', description: 'AI-powered resort discovery' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCount(table: string, filter?: Record<string, string>): Promise<number | null> {
  try {
    let query = supabase.from(table).select('*', { count: 'exact', head: true })
    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        query = query.eq(key, value)
      }
    }
    const { count, error } = await query
    if (error) throw error
    return count
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Stat Card Component
// ---------------------------------------------------------------------------

function StatBlock({ stat, loading }: { stat: TableStat; loading: boolean }) {
  if (loading) {
    return <Skeleton className="h-24 rounded-xl" />
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-xs text-muted-foreground mb-2">{stat.label}</div>
      {stat.error ? (
        <div className="flex items-center gap-2 text-yellow-400">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">Not available</span>
        </div>
      ) : (
        <>
          <div className="text-3xl font-bold">
            {stat.count !== null ? stat.count.toLocaleString() : '--'}
          </div>
          {stat.sub && stat.sub.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {stat.sub.map((s) => (
                <Badge key={s.label} variant="outline" className="text-[10px]">
                  {s.label}: {s.count !== null ? s.count.toLocaleString() : '--'}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function SystemPage() {
  const [stats, setStats] = useState<TableStat[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStats = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const [
        profilesCount,
        resortsTotal,
        resortsVerified,
        resortsUnverified,
        visitsCount,
        photosCount,
        wishlistsCount,
        submissionsTotal,
        submissionsPending,
        submissionsApproved,
        submissionsRejected,
        photoSubsTotal,
        photoSubsPending,
        supportTotal,
        supportPending,
        supportInProgress,
        featuresCount,
        auditCount,
      ] = await Promise.all([
        getCount('profiles'),
        getCount('resorts'),
        getCount('resorts', { verified: 'true' }),
        getCount('resorts', { verified: 'false' }),
        getCount('user_visits'),
        getCount('user_photos'),
        getCount('wishlists'),
        getCount('resort_submissions'),
        getCount('resort_submissions', { status: 'pending' }),
        getCount('resort_submissions', { status: 'approved' }),
        getCount('resort_submissions', { status: 'rejected' }),
        getCount('resort_feature_photo_submissions'),
        getCount('resort_feature_photo_submissions', { status: 'pending' }),
        getCount('support_requests'),
        getCount('support_requests', { status: 'pending' }),
        getCount('support_requests', { status: 'in_progress' }),
        getCount('app_features'),
        getCount('admin_audit_log'),
      ])

      setStats([
        { label: 'Profiles', count: profilesCount },
        {
          label: 'Resorts',
          count: resortsTotal,
          sub: [
            { label: 'Verified', count: resortsVerified },
            { label: 'Unverified', count: resortsUnverified },
          ],
        },
        { label: 'User Visits', count: visitsCount },
        { label: 'User Photos', count: photosCount },
        { label: 'Wishlists', count: wishlistsCount },
        {
          label: 'Resort Submissions',
          count: submissionsTotal,
          sub: [
            { label: 'Pending', count: submissionsPending },
            { label: 'Approved', count: submissionsApproved },
            { label: 'Rejected', count: submissionsRejected },
          ],
        },
        {
          label: 'Feature Photo Submissions',
          count: photoSubsTotal,
          sub: [{ label: 'Pending', count: photoSubsPending }],
        },
        {
          label: 'Support Requests',
          count: supportTotal,
          sub: [
            { label: 'Pending', count: supportPending },
            { label: 'In Progress', count: supportInProgress },
          ],
        },
        { label: 'App Features (Roadmap)', count: featuresCount },
        {
          label: 'Audit Log Entries',
          count: auditCount,
          error: auditCount === null,
        },
      ])
    } catch (err) {
      console.error(err)
      toast.error('Failed to load system stats')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  return (
    <div className="flex flex-col h-full">
      <Header
        title="System Health"
        subtitle="Database stats, storage, and edge functions"
        onRefresh={() => fetchStats(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {/* Database Stats */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">Database Row Counts</h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))
              : stats.map((stat) => (
                  <StatBlock key={stat.label} stat={stat} loading={false} />
                ))}
          </div>
        </section>

        {/* Storage */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">Storage</h2>
          </div>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <Cloud className="w-8 h-8 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Storage metrics (bucket sizes, bandwidth) require the Supabase Management API and are
                    not available through the client SDK.
                  </p>
                  <a
                    href={`${SUPABASE_DASHBOARD_BASE}/storage/buckets`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    View Storage in Supabase Dashboard
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Edge Functions */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">Edge Functions</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {EDGE_FUNCTIONS.map((fn) => (
              <Card key={fn.name} className="group hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-muted-foreground shrink-0" />
                        <code className="text-sm font-mono font-medium truncate">{fn.name}</code>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 ml-6">{fn.description}</p>
                    </div>
                    <a
                      href={`${SUPABASE_DASHBOARD_BASE}/functions/${fn.name}/details`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* WatermelonDB Sync Status */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">WatermelonDB Sync Status</h2>
          </div>

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-muted-foreground" />
                Coming Soon
              </CardTitle>
              <CardDescription>
                WatermelonDB sync monitoring will be available when offline sync is enabled. This will
                show sync health, conflict rates, and last sync timestamps per user.
              </CardDescription>
            </CardHeader>
          </Card>
        </section>
      </div>
    </div>
  )
}
