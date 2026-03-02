import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAuditLog } from '@/hooks/use-audit-log'
import { timeAgo } from '@/lib/utils'
import {
  Activity,
  AlertTriangle,
  Bot,
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

interface AppConfigRow {
  key: string
  value: boolean
  updated_at: string
  updated_by: string | null
}

interface SyncMetrics {
  deletions_24h: number | null
  deletions_7d: number | null
  active_users_1h: number | null
  active_users_24h: number | null
  active_users_7d: number | null
  users_with_visits: number | null
  users_with_photos: number | null
  total_deletions: number | null
  deletion_by_table: { table: string; count: number }[]
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

  // AI kill switch state
  const [aiConfigs, setAiConfigs] = useState<AppConfigRow[]>([])
  const [aiConfigLoading, setAiConfigLoading] = useState(true)
  const [togglingKey, setTogglingKey] = useState<string | null>(null)

  // WDB sync metrics state
  const [syncMetrics, setSyncMetrics] = useState<SyncMetrics | null>(null)
  const [syncMetricsLoading, setSyncMetricsLoading] = useState(true)

  const { log } = useAuditLog()

  const fetchAiConfigs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('key, value, updated_at, updated_by')
        .in('key', ['ai_discovery_enabled', 'ai_summary_enabled'])
        .order('key')
      if (error) throw error
      setAiConfigs((data as AppConfigRow[]) ?? [])
    } catch (err) {
      console.error('Failed to load AI config:', err)
    } finally {
      setAiConfigLoading(false)
    }
  }, [])

  const fetchSyncMetrics = useCallback(async () => {
    setSyncMetricsLoading(true)
    try {
      const now = new Date()
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

      // Recent deletions
      const [deletions24hRes, deletions7dRes, totalDeletionsRes, deletionsByTableRes] = await Promise.all([
        supabase.from('deleted_records').select('*', { count: 'exact', head: true }).gte('deleted_at', oneDayAgo.toISOString()),
        supabase.from('deleted_records').select('*', { count: 'exact', head: true }).gte('deleted_at', sevenDaysAgo.toISOString()),
        supabase.from('deleted_records').select('*', { count: 'exact', head: true }),
        supabase.from('deleted_records').select('table_name'),
      ])

      // Active users (users with recent data updates from visits or photos)
      const [visitsUsers1h, visitsUsers24h, visitsUsers7d, photosUsers1h, photosUsers24h, photosUsers7d] = await Promise.all([
        supabase.from('user_visits').select('user_id').gte('updated_at', oneHourAgo.toISOString()),
        supabase.from('user_visits').select('user_id').gte('updated_at', oneDayAgo.toISOString()),
        supabase.from('user_visits').select('user_id').gte('updated_at', sevenDaysAgo.toISOString()),
        supabase.from('user_photos').select('visit_id!inner(user_id)').gte('updated_at', oneHourAgo.toISOString()),
        supabase.from('user_photos').select('visit_id!inner(user_id)').gte('updated_at', oneDayAgo.toISOString()),
        supabase.from('user_photos').select('visit_id!inner(user_id)').gte('updated_at', sevenDaysAgo.toISOString()),
      ])

      // Count distinct users from visits and photos
      const getUniqueUserCount = (visitsData: any[], photosData: any[]) => {
        const userIds = new Set<string>()
        visitsData?.forEach((v) => v.user_id && userIds.add(v.user_id))
        photosData?.forEach((p: any) => {
          const userId = p?.visit_id?.user_id
          if (userId) userIds.add(userId)
        })
        return userIds.size
      }

      const activeUsers1h = getUniqueUserCount(visitsUsers1h.data || [], photosUsers1h.data || [])
      const activeUsers24h = getUniqueUserCount(visitsUsers24h.data || [], photosUsers24h.data || [])
      const activeUsers7d = getUniqueUserCount(visitsUsers7d.data || [], photosUsers7d.data || [])

      // Data health - count distinct users with visits or photos
      const [allVisitsRes, allPhotosRes] = await Promise.all([
        supabase.from('user_visits').select('user_id'),
        supabase.from('user_photos').select('visit_id!inner(user_id)'),
      ])

      const usersWithVisits = new Set(allVisitsRes.data?.map((v: any) => v.user_id) || []).size
      const usersWithPhotos = new Set(
        allPhotosRes.data?.map((p: any) => p?.visit_id?.user_id).filter(Boolean) || []
      ).size

      // Process deletion by table
      const deletionCounts: Record<string, number> = {}
      if (deletionsByTableRes.data) {
        for (const record of deletionsByTableRes.data) {
          const table = record.table_name || 'unknown'
          deletionCounts[table] = (deletionCounts[table] || 0) + 1
        }
      }
      const deletionByTable = Object.entries(deletionCounts)
        .map(([table, count]) => ({ table, count }))
        .sort((a, b) => b.count - a.count)

      setSyncMetrics({
        deletions_24h: deletions24hRes.count,
        deletions_7d: deletions7dRes.count,
        total_deletions: totalDeletionsRes.count,
        deletion_by_table: deletionByTable,
        active_users_1h: activeUsers1h,
        active_users_24h: activeUsers24h,
        active_users_7d: activeUsers7d,
        users_with_visits: usersWithVisits,
        users_with_photos: usersWithPhotos,
      })
    } catch (err) {
      console.error('Failed to load WDB sync metrics:', err)
      setSyncMetrics(null)
    } finally {
      setSyncMetricsLoading(false)
    }
  }, [])

  const toggleAiConfig = useCallback(
    async (key: string, enabled: boolean) => {
      setTogglingKey(key)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const adminEmail = session?.user?.email ?? 'unknown'

        const { error } = await supabase
          .from('app_config')
          .update({
            value: enabled,
            updated_at: new Date().toISOString(),
            updated_by: adminEmail,
          })
          .eq('key', key)

        if (error) throw error

        toast.success(`AI ${enabled ? 'enabled' : 'paused'}`)

        await log({
          action: `toggle_${key}`,
          entity_type: 'app_config',
          entity_id: key,
          details: { enabled },
        })

        // Refresh config state
        setAiConfigs((prev) =>
          prev.map((c) =>
            c.key === key
              ? { ...c, value: enabled, updated_at: new Date().toISOString(), updated_by: adminEmail }
              : c,
          ),
        )
      } catch (err) {
        console.error('Failed to toggle AI config:', err)
        toast.error('Failed to update AI config')
      } finally {
        setTogglingKey(null)
      }
    },
    [log],
  )

  useEffect(() => {
    fetchAiConfigs()
    fetchSyncMetrics()
  }, [fetchAiConfigs, fetchSyncMetrics])

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
        onRefresh={() => { fetchStats(true); fetchAiConfigs(); fetchSyncMetrics() }}
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

        {/* AI Service Controls */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Bot className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">AI Service Controls</h2>
          </div>

          {aiConfigLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          ) : aiConfigs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">
                  No AI config rows found. The <code>app_config</code> table may not be seeded yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {aiConfigs.map((config) => {
                const isDiscovery = config.key === 'ai_discovery_enabled'
                const label = isDiscovery ? 'AI Discovery' : 'AI Summaries'
                const subtitle = isDiscovery ? 'Resort Recommendations' : 'Album & Visit'
                const description = isDiscovery
                  ? 'Claude Haiku generates personalized resort picks. When off: users get template recommendations.'
                  : 'Claude Haiku generates trip summaries. When off: users see "AI unavailable" message.'
                const enabled = config.value === true
                const toggling = togglingKey === config.key

                return (
                  <Card key={config.key}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold">{label}</span>
                            <span className="text-xs text-muted-foreground">({subtitle})</span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                            {description}
                          </p>
                          <div className="flex items-center gap-2">
                            <Badge variant={enabled ? 'default' : 'destructive'} className="text-[10px]">
                              {enabled ? 'Enabled' : 'Paused'}
                            </Badge>
                            {config.updated_at && (
                              <span className="text-[10px] text-muted-foreground">
                                Updated {timeAgo(config.updated_at)}
                                {config.updated_by ? ` by ${config.updated_by}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <Switch
                          checked={enabled}
                          disabled={toggling}
                          onCheckedChange={(checked) => toggleAiConfig(config.key, checked)}
                          aria-label={`Toggle ${label}`}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
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
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold">WatermelonDB Sync Activity</h2>
            </div>
            <a
              href={`${SUPABASE_DASHBOARD_BASE}/functions/sync/logs`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              View Sync Function Logs
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {syncMetricsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          ) : !syncMetrics ? (
            <Card className="border-dashed">
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">
                  Failed to load sync metrics. Try refreshing the page.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Recent Deletions */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Recent Deletions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <div className="text-2xl font-bold">{syncMetrics.deletions_24h ?? 0}</div>
                      <p className="text-xs text-muted-foreground">Last 24 hours</p>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Last 7 days</span>
                      <span className="font-medium">{syncMetrics.deletions_7d ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-medium">{syncMetrics.total_deletions ?? 0}</span>
                    </div>
                    {syncMetrics.deletion_by_table.length > 0 && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-1">By Table</p>
                        <div className="flex flex-wrap gap-1">
                          {syncMetrics.deletion_by_table.slice(0, 3).map((item) => (
                            <Badge key={item.table} variant="outline" className="text-[10px]">
                              {item.table}: {item.count}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Active Users */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Active Users</CardTitle>
                  <CardDescription className="text-xs">Users with data updates</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <div className="text-2xl font-bold">{syncMetrics.active_users_24h ?? 0}</div>
                      <p className="text-xs text-muted-foreground">Last 24 hours</p>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Last 1 hour</span>
                      <span className="font-medium">{syncMetrics.active_users_1h ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Last 7 days</span>
                      <span className="font-medium">{syncMetrics.active_users_7d ?? 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Data Health */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Data Health</CardTitle>
                  <CardDescription className="text-xs">Users with synced data</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <div className="text-2xl font-bold">{syncMetrics.users_with_visits ?? 0}</div>
                      <p className="text-xs text-muted-foreground">Users with visits</p>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Users with photos</span>
                      <span className="font-medium">{syncMetrics.users_with_photos ?? 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
