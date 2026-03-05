import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { timeAgo } from '@/lib/utils'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  Users,
  Mountain,
  Inbox,
  ImagePlus,
  LifeBuoy,
  CalendarDays,
  Settings,
  ExternalLink,
  Key,
  Database,
  HardDrive,
  Bug,
  BarChart3,
  Loader2,
  ArrowRight,
  TestTubes,
} from 'lucide-react'
import type { PageId } from '@/lib/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Metrics {
  totalUsers: number
  newUsersThisWeek: number
  newUsersLastWeek: number
  verifiedResorts: number
  unverifiedResorts: number
  pendingSubmissions: number
  pendingPhotos: number
  openTickets: number
  totalVisits: number
  betaTesters: number
}

interface AuditEntry {
  id: string
  admin_email: string
  action: string
  entity_type: string
  created_at: string
}

interface DailySignup {
  day: string
  thisWeek: number
  lastWeek: number
}

interface ServiceConfig {
  key: string
  value: Record<string, unknown>
  updated_at: string
}

interface SystemMetrics {
  db_size_mb: number
  total_storage_bytes: number
  total_photos: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const SERVICE_LINKS: Record<string, string> = {
  service_supabase: 'https://supabase.com/dashboard/project/rnudbfdhrenesamdjzdk',
  service_sentry: 'https://slopestory.sentry.io/',
  service_posthog: 'https://us.posthog.com/',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHealthColor(ratio: number): string {
  if (ratio >= 0.85) return 'text-red-400'
  if (ratio >= 0.6) return 'text-yellow-400'
  return 'text-green-400'
}

function getBarColor(ratio: number): string {
  if (ratio >= 0.85) return 'bg-red-400'
  if (ratio >= 0.6) return 'bg-yellow-400'
  return 'bg-green-400'
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function getKeyStatusColor(days: number): string {
  if (days <= 0) return 'text-red-400'
  if (days <= 7) return 'text-red-400'
  if (days <= 30) return 'text-yellow-400'
  return 'text-green-400'
}

function getKeyBgColor(days: number): string {
  if (days <= 0) return 'bg-red-500/10 border-red-500/20'
  if (days <= 7) return 'bg-red-500/10 border-red-500/20'
  if (days <= 30) return 'bg-yellow-500/10 border-yellow-500/20'
  return 'bg-card border-border'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

/** Get Monday 00:00 of a given week offset (0 = this week, -1 = last week) */
function getMondayOfWeek(weekOffset: number): Date {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1 // days since Monday
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff + weekOffset * 7)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function buildDailySignups(
  recentUsers: { created_at: string }[]
): DailySignup[] {
  const thisMonday = getMondayOfWeek(0)
  const lastMonday = getMondayOfWeek(-1)

  return DAY_NAMES.map((day, i) => {
    const thisDay = new Date(thisMonday)
    thisDay.setDate(thisMonday.getDate() + i)
    const nextThisDay = new Date(thisDay)
    nextThisDay.setDate(thisDay.getDate() + 1)

    const lastDay = new Date(lastMonday)
    lastDay.setDate(lastMonday.getDate() + i)
    const nextLastDay = new Date(lastDay)
    nextLastDay.setDate(lastDay.getDate() + 1)

    const thisWeek = recentUsers.filter((u) => {
      const d = new Date(u.created_at)
      return d >= thisDay && d < nextThisDay
    }).length

    const lastWeek = recentUsers.filter((u) => {
      const d = new Date(u.created_at)
      return d >= lastDay && d < nextLastDay
    }).length

    return { day, thisWeek, lastWeek }
  })
}

// ---------------------------------------------------------------------------
// Custom chart tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-muted-foreground">
          {p.dataKey === 'thisWeek' ? 'This week' : 'Last week'}: {p.value}
        </p>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverviewPage({
  onNavigate,
}: {
  onNavigate: (page: PageId) => void
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [activity, setActivity] = useState<AuditEntry[]>([])
  const [dailySignups, setDailySignups] = useState<DailySignup[]>([])
  const [systemConfigs, setSystemConfigs] = useState<ServiceConfig[]>([])
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Configure dialog
  const [configOpen, setConfigOpen] = useState(false)
  const [configForm, setConfigForm] = useState<Record<string, Record<string, unknown>>>({})
  const [configSaving, setConfigSaving] = useState(false)

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    try {
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString()
      const fourteenDaysAgo = new Date(
        Date.now() - 14 * 24 * 60 * 60 * 1000
      ).toISOString()
      const lastMonday = getMondayOfWeek(-1)

      const [
        totalUsersRes,
        newUsersRes,
        lastWeekUsersRes,
        verifiedRes,
        unverifiedRes,
        pendingSubsRes,
        pendingPhotosRes,
        openTicketsRes,
        totalVisitsRes,
        betaTestersRes,
        recentUsersRes,
        activityRes,
        configsRes,
        sysMetricsRes,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true }),
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', sevenDaysAgo),
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', lastMonday.toISOString())
          .lt('created_at', sevenDaysAgo),
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
          .from('tester_emails')
          .select('*', { count: 'exact', head: true }),
        supabase
          .from('profiles')
          .select('created_at')
          .gte('created_at', fourteenDaysAgo),
        supabase
          .from('admin_audit_log')
          .select('id, admin_email, action, entity_type, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('app_config')
          .select('key, value, updated_at')
          .like('key', 'service_%'),
        supabase.rpc('get_system_metrics'),
      ])

      setMetrics({
        totalUsers: totalUsersRes.count ?? 0,
        newUsersThisWeek: newUsersRes.count ?? 0,
        newUsersLastWeek: lastWeekUsersRes.count ?? 0,
        verifiedResorts: verifiedRes.count ?? 0,
        unverifiedResorts: unverifiedRes.count ?? 0,
        pendingSubmissions: pendingSubsRes.count ?? 0,
        pendingPhotos: pendingPhotosRes.count ?? 0,
        openTickets: openTicketsRes.count ?? 0,
        totalVisits: totalVisitsRes.count ?? 0,
        betaTesters: betaTestersRes.count ?? 0,
      })

      if (recentUsersRes.data) {
        setDailySignups(
          buildDailySignups(recentUsersRes.data as { created_at: string }[])
        )
      }

      setActivity((activityRes.data as AuditEntry[]) ?? [])
      setSystemConfigs((configsRes.data as ServiceConfig[]) ?? [])

      if (sysMetricsRes.data) {
        setSystemMetrics(sysMetricsRes.data as unknown as SystemMetrics)
      }
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

  // -------------------------------------------------------------------------
  // System health helpers
  // -------------------------------------------------------------------------

  function getConfig(key: string): Record<string, unknown> | null {
    const entry = systemConfigs.find((c) => c.key === key)
    return entry ? (entry.value as Record<string, unknown>) : null
  }

  // -------------------------------------------------------------------------
  // Configure dialog
  // -------------------------------------------------------------------------

  const openConfigDialog = useCallback(() => {
    const form: Record<string, Record<string, unknown>> = {}
    for (const cfg of systemConfigs) {
      form[cfg.key] = { ...(cfg.value as Record<string, unknown>) }
    }
    // Ensure all keys exist with defaults
    if (!form.service_apple_key) {
      form.service_apple_key = { expires_at: '', rotation_months: 6, notes: '' }
    }
    if (!form.service_supabase) {
      form.service_supabase = { plan: 'Free', db_limit_mb: 500 }
    }
    if (!form.service_cloudflare_r2) {
      form.service_cloudflare_r2 = { plan: 'Free', storage_limit_gb: 10 }
    }
    if (!form.service_sentry) {
      form.service_sentry = { plan: 'Developer', events_limit_monthly: 5000 }
    }
    if (!form.service_posthog) {
      form.service_posthog = { plan: 'Free', events_limit_monthly: 1000000 }
    }
    setConfigForm(form)
    setConfigOpen(true)
  }, [systemConfigs])

  const updateConfigField = useCallback(
    (service: string, field: string, value: unknown) => {
      setConfigForm((prev) => ({
        ...prev,
        [service]: { ...prev[service], [field]: value },
      }))
    },
    []
  )

  const handleSaveConfig = useCallback(async () => {
    setConfigSaving(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const email = user?.email ?? 'unknown'

      for (const [key, value] of Object.entries(configForm)) {
        await supabase.from('app_config').upsert(
          {
            key,
            value,
            updated_at: new Date().toISOString(),
            updated_by: email,
          },
          { onConflict: 'key' }
        )
      }

      setConfigOpen(false)
      loadData()
    } catch {
      // Error saving
    } finally {
      setConfigSaving(false)
    }
  }, [configForm, loadData])

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------

  const newUsersChange =
    metrics && metrics.newUsersLastWeek > 0
      ? `${metrics.newUsersThisWeek >= metrics.newUsersLastWeek ? '+' : ''}${metrics.newUsersThisWeek - metrics.newUsersLastWeek} vs last week`
      : metrics?.newUsersLastWeek === 0 && metrics.newUsersThisWeek > 0
        ? `+${metrics.newUsersThisWeek} vs last week`
        : undefined

  const appleConfig = getConfig('service_apple_key')
  const supabaseConfig = getConfig('service_supabase')
  const r2Config = getConfig('service_cloudflare_r2')
  const sentryConfig = getConfig('service_sentry')
  const posthogConfig = getConfig('service_posthog')

  const appleKeyDays = appleConfig?.expires_at
    ? daysUntil(appleConfig.expires_at as string)
    : null

  const dbSizeMb = systemMetrics?.db_size_mb ?? 0
  const dbLimitMb = (supabaseConfig?.db_limit_mb as number) ?? 500
  const dbRatio = dbLimitMb > 0 ? dbSizeMb / dbLimitMb : 0

  const totalStorageBytes = systemMetrics?.total_storage_bytes ?? 0
  const r2LimitGb = (r2Config?.storage_limit_gb as number) ?? 10
  const r2StorageGb = totalStorageBytes / 1073741824
  const r2Ratio = r2LimitGb > 0 ? r2StorageGb / r2LimitGb : 0

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Overview"
        subtitle="Key metrics and system health"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* ── Metrics Grid ── */}
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
                change={newUsersChange}
              />
              <StatsCard
                label="Resorts"
                value={`${metrics.verifiedResorts} / ${metrics.unverifiedResorts}`}
                subtitle="verified / unverified"
              />
              <StatsCard
                label="Beta Testers"
                value={metrics.betaTesters}
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
                subtitle="across all users"
              />
            </>
          ) : null}
        </div>

        {/* ── Quick Actions ── */}
        {!loading && metrics && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate('submissions')}
              className="gap-1.5"
            >
              <Inbox className="w-3.5 h-3.5" />
              Review Submissions
              {metrics.pendingSubmissions > 0 && (
                <Badge variant="destructive" className="ml-1 text-[10px] px-1.5 py-0">
                  {metrics.pendingSubmissions}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate('feature-photos')}
              className="gap-1.5"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              Check Feature Photos
              {metrics.pendingPhotos > 0 && (
                <Badge variant="destructive" className="ml-1 text-[10px] px-1.5 py-0">
                  {metrics.pendingPhotos}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate('support')}
              className="gap-1.5"
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              View Support Tickets
              {metrics.openTickets > 0 && (
                <Badge variant="destructive" className="ml-1 text-[10px] px-1.5 py-0">
                  {metrics.openTickets}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate('resorts')}
              className="gap-1.5"
            >
              <Mountain className="w-3.5 h-3.5" />
              Manage Resorts
            </Button>
          </div>
        )}

        {/* ── New Users Chart ── */}
        <div className="bg-card border border-border rounded-xl">
          <div className="p-5 border-b border-border">
            <h2 className="text-sm font-semibold">New Users — This Week vs Last Week</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Daily signups by day of week
            </p>
          </div>
          <div className="p-5">
            {loading ? (
              <Skeleton className="h-[200px] rounded-lg" />
            ) : dailySignups.every((d) => d.thisWeek === 0 && d.lastWeek === 0) ? (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                No signups in the last 2 weeks
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailySignups} barGap={2}>
                  <XAxis
                    dataKey="day"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={false} />
                  <Legend
                    formatter={(value: string) =>
                      value === 'thisWeek' ? 'This week' : 'Last week'
                    }
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Bar
                    dataKey="lastWeek"
                    fill="#4298D2"
                    opacity={0.3}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="thisWeek"
                    fill="#4298D2"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── System Health ── */}
        <div className="bg-card border border-border rounded-xl">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">System Health</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Service limits and key dates
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openConfigDialog}>
              <Settings className="w-3.5 h-3.5 mr-1" />
              Configure
            </Button>
          </div>

          {loading ? (
            <div className="p-5 grid grid-cols-2 md:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : systemConfigs.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted-foreground">
              No system health configs found. Click Configure to set up service tracking.
            </div>
          ) : (
            <div className="p-5 grid grid-cols-2 md:grid-cols-5 gap-4">
              {/* Apple Key */}
              <div
                className={`rounded-lg border p-4 space-y-2 ${
                  appleKeyDays !== null
                    ? getKeyBgColor(appleKeyDays)
                    : 'bg-muted/30 border-border'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Key className="w-3.5 h-3.5" />
                  Apple Cert
                </div>
                {appleConfig?.expires_at ? (
                  <>
                    <div
                      className={`text-lg font-bold ${
                        appleKeyDays !== null
                          ? getKeyStatusColor(appleKeyDays)
                          : ''
                      }`}
                    >
                      {appleKeyDays !== null && appleKeyDays > 0
                        ? `${appleKeyDays}d`
                        : appleKeyDays === 0
                          ? 'Today'
                          : `${Math.abs(appleKeyDays ?? 0)}d ago`}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {appleKeyDays !== null && appleKeyDays > 0
                        ? 'until expiry'
                        : 'EXPIRED — renew now'}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">Not configured</div>
                )}
              </div>

              {/* Supabase */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Database className="w-3.5 h-3.5" />
                    Supabase
                  </div>
                  <a
                    href={SERVICE_LINKS.service_supabase}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className={`text-lg font-bold ${getHealthColor(dbRatio)}`}>
                  {dbSizeMb} MB
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${getBarColor(dbRatio)}`}
                    style={{ width: `${Math.min(dbRatio * 100, 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {supabaseConfig?.plan as string ?? 'Free'} — {dbLimitMb} MB limit
                </div>
              </div>

              {/* Cloudflare R2 */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <HardDrive className="w-3.5 h-3.5" />
                  Cloudflare R2
                </div>
                <div className={`text-lg font-bold ${getHealthColor(r2Ratio)}`}>
                  {formatBytes(totalStorageBytes)}
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${getBarColor(r2Ratio)}`}
                    style={{ width: `${Math.min(r2Ratio * 100, 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {r2Config?.plan as string ?? 'Free'} — {r2LimitGb} GB limit
                  {systemMetrics ? ` · ${systemMetrics.total_photos} photos` : ''}
                </div>
              </div>

              {/* Sentry */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Bug className="w-3.5 h-3.5" />
                    Sentry
                  </div>
                  <a
                    href={SERVICE_LINKS.service_sentry}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-lg font-bold text-muted-foreground">—</div>
                <div className="text-[10px] text-muted-foreground">
                  {sentryConfig?.plan as string ?? 'Developer'} —{' '}
                  {((sentryConfig?.events_limit_monthly as number) ?? 5000).toLocaleString()} events/mo
                </div>
              </div>

              {/* PostHog */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <BarChart3 className="w-3.5 h-3.5" />
                    PostHog
                  </div>
                  <a
                    href={SERVICE_LINKS.service_posthog}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-lg font-bold text-muted-foreground">—</div>
                <div className="text-[10px] text-muted-foreground">
                  {posthogConfig?.plan as string ?? 'Free'} —{' '}
                  {((posthogConfig?.events_limit_monthly as number) ?? 1000000).toLocaleString()} events/mo
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Recent Activity ── */}
        <div className="bg-card border border-border rounded-xl">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Recent Activity</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last 20 admin actions
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate('activity')}
              className="gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View all
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
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
            )}
          </div>
        </div>
      </div>

      {/* ── Configure Dialog ── */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>System Health Configuration</DialogTitle>
            <DialogDescription>
              Update service plan limits and key dates.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-6">
            {/* Apple Key */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5" />
                Apple Certificate
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Expiry Date</Label>
                  <Input
                    type="date"
                    value={(configForm.service_apple_key?.expires_at as string) ?? ''}
                    onChange={(e) =>
                      updateConfigField('service_apple_key', 'expires_at', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Rotation (months)</Label>
                  <Input
                    type="number"
                    value={(configForm.service_apple_key?.rotation_months as number) ?? 6}
                    onChange={(e) =>
                      updateConfigField(
                        'service_apple_key',
                        'rotation_months',
                        parseInt(e.target.value) || 6
                      )
                    }
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Supabase */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" />
                Supabase
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Plan</Label>
                  <Input
                    value={(configForm.service_supabase?.plan as string) ?? ''}
                    onChange={(e) =>
                      updateConfigField('service_supabase', 'plan', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">DB Limit (MB)</Label>
                  <Input
                    type="number"
                    value={(configForm.service_supabase?.db_limit_mb as number) ?? 500}
                    onChange={(e) =>
                      updateConfigField(
                        'service_supabase',
                        'db_limit_mb',
                        parseInt(e.target.value) || 500
                      )
                    }
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Cloudflare R2 */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" />
                Cloudflare R2
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Plan</Label>
                  <Input
                    value={(configForm.service_cloudflare_r2?.plan as string) ?? ''}
                    onChange={(e) =>
                      updateConfigField('service_cloudflare_r2', 'plan', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Storage Limit (GB)</Label>
                  <Input
                    type="number"
                    value={(configForm.service_cloudflare_r2?.storage_limit_gb as number) ?? 10}
                    onChange={(e) =>
                      updateConfigField(
                        'service_cloudflare_r2',
                        'storage_limit_gb',
                        parseInt(e.target.value) || 10
                      )
                    }
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Sentry */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" />
                Sentry
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Plan</Label>
                  <Input
                    value={(configForm.service_sentry?.plan as string) ?? ''}
                    onChange={(e) =>
                      updateConfigField('service_sentry', 'plan', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Monthly Event Limit</Label>
                  <Input
                    type="number"
                    value={(configForm.service_sentry?.events_limit_monthly as number) ?? 5000}
                    onChange={(e) =>
                      updateConfigField(
                        'service_sentry',
                        'events_limit_monthly',
                        parseInt(e.target.value) || 5000
                      )
                    }
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* PostHog */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" />
                PostHog
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Plan</Label>
                  <Input
                    value={(configForm.service_posthog?.plan as string) ?? ''}
                    onChange={(e) =>
                      updateConfigField('service_posthog', 'plan', e.target.value)
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Monthly Event Limit</Label>
                  <Input
                    type="number"
                    value={
                      (configForm.service_posthog?.events_limit_monthly as number) ?? 1000000
                    }
                    onChange={(e) =>
                      updateConfigField(
                        'service_posthog',
                        'events_limit_monthly',
                        parseInt(e.target.value) || 1000000
                      )
                    }
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveConfig} disabled={configSaving}>
              {configSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
