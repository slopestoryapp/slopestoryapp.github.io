import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime, truncate, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { ExportButton } from '@/components/shared/export-button'
import { DataTable } from '@/components/shared/data-table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { type ColumnDef } from '@tanstack/react-table'
import { Star } from 'lucide-react'

interface ProfileInfo {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
}

interface RawFeedback {
  id: string
  user_id: string
  rating: number
  what_went_well: string | null
  what_needs_work: string | null
  app_version: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  device_info: any
  created_at: string
}

interface BetaFeedbackEntry extends RawFeedback {
  profile: ProfileInfo | null
}

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const px = size === 'lg' ? 'w-5 h-5' : 'w-3.5 h-3.5'
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            px,
            i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground/30',
          )}
        />
      ))}
    </div>
  )
}

export function BetaFeedbackPage() {
  const [feedback, setFeedback] = useState<BetaFeedbackEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Filter
  const [ratingFilter, setRatingFilter] = useState<string>('all')

  // Detail
  const [selected, setSelected] = useState<BetaFeedbackEntry | null>(null)

  const loadFeedback = useCallback(async () => {
    try {
      // Two-query approach: beta_feedback.user_id FK is to auth.users, not profiles
      const { data: rawData, error: fbError } = await supabase
        .from('beta_feedback')
        .select('*')
        .order('created_at', { ascending: false })
      if (fbError) throw fbError

      const raw = (rawData as RawFeedback[]) ?? []

      // Fetch profiles for unique user IDs
      const userIds = [...new Set(raw.map((f) => f.user_id))]
      let profileMap = new Map<string, ProfileInfo>()

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email, first_name, last_name')
          .in('id', userIds)
        if (profiles) {
          profileMap = new Map(
            (profiles as ProfileInfo[]).map((p) => [p.id, p]),
          )
        }
      }

      // Merge
      setFeedback(
        raw.map((f) => ({
          ...f,
          profile: profileMap.get(f.user_id) ?? null,
        })),
      )
    } catch {
      toast.error('Failed to load feedback')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadFeedback()
  }, [loadFeedback])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadFeedback()
  }, [loadFeedback])

  const filteredFeedback = useMemo(
    () =>
      ratingFilter === 'all'
        ? feedback
        : feedback.filter((f) => f.rating === Number(ratingFilter)),
    [feedback, ratingFilter],
  )

  // Stats
  const totalFeedback = feedback.length
  const avgRating =
    feedback.length > 0
      ? (feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length).toFixed(1)
      : '—'
  const ratingDistribution = useMemo(
    () => [1, 2, 3, 4, 5].map((r) => feedback.filter((f) => f.rating === r).length),
    [feedback],
  )

  const getUserDisplay = useCallback((entry: BetaFeedbackEntry) => {
    const p = entry.profile
    if (!p) return entry.user_id.slice(0, 8) + '...'
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ')
    return name || p.email || entry.user_id.slice(0, 8) + '...'
  }, [])

  const columns: ColumnDef<BetaFeedbackEntry, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'rating',
        header: 'Rating',
        cell: ({ row }) => <StarRating rating={row.original.rating} />,
      },
      {
        id: 'user',
        header: 'User',
        accessorFn: (row) => getUserDisplay(row),
        cell: ({ getValue }) => (
          <span className="text-sm">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'what_went_well',
        header: 'Went Well',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {truncate(row.original.what_went_well ?? '—', 60)}
          </span>
        ),
      },
      {
        accessorKey: 'what_needs_work',
        header: 'Needs Work',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {truncate(row.original.what_needs_work ?? '—', 60)}
          </span>
        ),
      },
      {
        accessorKey: 'app_version',
        header: 'Version',
        cell: ({ row }) =>
          row.original.app_version ? (
            <Badge variant="secondary" className="text-[10px]">
              {row.original.app_version}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'created_at',
        header: 'Date',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
    ],
    [getUserDisplay],
  )

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Beta Feedback"
        subtitle="User feedback from beta testing"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats */}
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatsCard label="Total Feedback" value={totalFeedback} />
              <StatsCard label="Average Rating" value={avgRating} />
              <StatsCard label="5-Star" value={ratingDistribution[4]} />
              <StatsCard label="1-Star" value={ratingDistribution[0]} />
            </div>
          </div>
          <ExportButton
            data={feedback as unknown as Record<string, unknown>[]}
            filename="beta-feedback"
          />
        </div>

        {/* Rating distribution */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-xs text-muted-foreground mb-3">Rating Distribution</h3>
          <div className="flex items-end gap-3 h-20">
            {[1, 2, 3, 4, 5].map((r) => {
              const count = ratingDistribution[r - 1]
              const maxCount = Math.max(...ratingDistribution, 1)
              const heightPct = (count / maxCount) * 100
              return (
                <div key={r} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-medium">{count}</span>
                  <div className="w-full relative" style={{ height: '48px' }}>
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-primary/80 rounded-t transition-all"
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{r}★</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3">
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Rating" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ratings</SelectItem>
              {[5, 4, 3, 2, 1].map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r} Star{r > 1 ? 's' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {filteredFeedback.length} response(s)
          </span>
        </div>

        {/* Main content: table + detail panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: DataTable */}
          <div className="lg:col-span-2">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={filteredFeedback}
                onRowClick={setSelected}
                searchColumn="what_went_well"
                searchPlaceholder="Search feedback..."
              />
            )}
          </div>

          {/* Right: Detail Panel */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">Feedback Detail</h2>
            </div>
            {selected ? (
              <ScrollArea className="max-h-[calc(100vh-280px)]">
                <div className="p-4 space-y-5">
                  {/* Rating */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Rating</div>
                    <StarRating rating={selected.rating} size="lg" />
                  </div>

                  {/* User */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">User</div>
                    <div className="text-sm font-medium">
                      {getUserDisplay(selected)}
                    </div>
                    {selected.profile?.email && (
                      <div className="text-xs text-muted-foreground">
                        {selected.profile.email}
                      </div>
                    )}
                  </div>

                  {/* What went well */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      What went well
                    </div>
                    <div className="text-sm whitespace-pre-wrap">
                      {selected.what_went_well || '—'}
                    </div>
                  </div>

                  {/* What needs work */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      What needs work
                    </div>
                    <div className="text-sm whitespace-pre-wrap">
                      {selected.what_needs_work || '—'}
                    </div>
                  </div>

                  {/* App version */}
                  {selected.app_version && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        App Version
                      </div>
                      <Badge variant="secondary">{selected.app_version}</Badge>
                    </div>
                  )}

                  {/* Device info */}
                  {selected.device_info && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        Device Info
                      </div>
                      <pre className="text-xs bg-slope-slate-dark rounded-lg p-3 overflow-auto">
                        {JSON.stringify(selected.device_info, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Timestamp */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Submitted</div>
                    <div className="text-sm">
                      {formatDateTime(selected.created_at)}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Select a feedback entry to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
