import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_COLORS = ['#4298D2', '#6DB5DE', '#3a87be', '#22c55e', '#f59e0b', '#ef4444']

const PIE_COLORS = ['#4298D2', '#6DB5DE', '#3a87be', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChartDatum {
  name: string
  count: number
}

interface AnalyticsData {
  totalVisits: number
  totalWishlists: number
  totalPhotos: number
  avgVisitsPerUser: number
  mostVisited: ChartDatum[]
  mostWishlisted: ChartDatum[]
  visitsByCountry: ChartDatum[]
  experienceDistribution: ChartDatum[]
}

const EMPTY_DATA: AnalyticsData = {
  totalVisits: 0,
  totalWishlists: 0,
  totalPhotos: 0,
  avgVisitsPerUser: 0,
  mostVisited: [],
  mostWishlisted: [],
  visitsByCountry: [],
  experienceDistribution: [],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countByField<T extends Record<string, unknown>>(
  items: T[],
  fieldPath: string
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    // Support nested access like "resorts.name"
    const parts = fieldPath.split('.')
    let value: unknown = item
    for (const part of parts) {
      value = (value as Record<string, unknown>)?.[part]
    }
    const key = String(value ?? 'Unknown')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function topN(countsMap: Map<string, number>, n: number): ChartDatum[] {
  return Array.from(countsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }))
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">{payload[0].value} visits</p>
    </div>
  )
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium">{payload[0].name}</p>
      <p className="text-muted-foreground">{payload[0].value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAnalytics = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      // Run all queries in parallel
      const [
        visitsResult,
        wishlistsResult,
        photosResult,
        profilesResult,
        visitResortResult,
        wishlistResortResult,
        visitCountryResult,
      ] = await Promise.all([
        // Total visits
        supabase.from('user_visits').select('*', { count: 'exact', head: true }),
        // Total wishlists
        supabase.from('wishlists').select('*', { count: 'exact', head: true }),
        // Total photos
        supabase.from('user_photos').select('*', { count: 'exact', head: true }),
        // Profiles for experience distribution & user count
        supabase.from('profiles').select('id, ski_experience').limit(5000),
        // Visits with resort name for "most visited"
        supabase.from('user_visits').select('resort_id, resorts(name)').limit(5000),
        // Wishlists with resort name for "most wishlisted"
        supabase.from('wishlists').select('resort_id, resorts(name)').limit(5000),
        // Visits with resort country for "visits by country"
        supabase.from('user_visits').select('resort_id, resorts(country)').limit(5000),
      ])

      const totalVisits = visitsResult.count ?? 0
      const totalWishlists = wishlistsResult.count ?? 0
      const totalPhotos = photosResult.count ?? 0

      // Profiles
      const profiles = profilesResult.data ?? []
      const uniqueUsers = new Set(profiles.map((p) => p.id)).size
      const avgVisitsPerUser = uniqueUsers > 0 ? Math.round((totalVisits / uniqueUsers) * 10) / 10 : 0

      // Most visited resorts
      const visitData = (visitResortResult.data ?? []) as unknown as Array<{ resort_id: string; resorts: { name: string } | null }>
      const visitCounts = countByField(
        visitData.map((v) => ({ name: v.resorts?.name ?? 'Unknown' })),
        'name'
      )
      const mostVisited = topN(visitCounts, 10)

      // Most wishlisted resorts
      const wishlistData = (wishlistResortResult.data ?? []) as unknown as Array<{ resort_id: string; resorts: { name: string } | null }>
      const wishlistCounts = countByField(
        wishlistData.map((w) => ({ name: w.resorts?.name ?? 'Unknown' })),
        'name'
      )
      const mostWishlisted = topN(wishlistCounts, 10)

      // Visits by country
      const countryData = (visitCountryResult.data ?? []) as unknown as Array<{ resort_id: string; resorts: { country: string } | null }>
      const countryCounts = countByField(
        countryData.map((v) => ({ name: v.resorts?.country ?? 'Unknown' })),
        'name'
      )
      const visitsByCountry = topN(countryCounts, 20)

      // Experience distribution
      const expCounts = countByField(
        profiles.map((p) => ({ exp: p.ski_experience ?? 'unset' })),
        'exp'
      )
      const experienceDistribution = Array.from(expCounts.entries()).map(([name, count]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        count,
      }))

      setData({
        totalVisits,
        totalWishlists,
        totalPhotos,
        avgVisitsPerUser,
        mostVisited,
        mostWishlisted,
        visitsByCountry,
        experienceDistribution,
      })
    } catch (err) {
      console.error(err)
      toast.error('Failed to load analytics data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  // Memoize chart data to avoid unnecessary re-renders
  const barChartMargin = useMemo(() => ({ top: 5, right: 20, bottom: 5, left: 0 }), [])

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Analytics"
        subtitle="Resort and user analytics overview"
        onRefresh={() => fetchAnalytics(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {/* Summary Stats */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <Skeleton key={n} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard label="Total Visits" value={data.totalVisits.toLocaleString()} />
            <StatsCard label="Total Wishlists" value={data.totalWishlists.toLocaleString()} />
            <StatsCard label="Total Photos" value={data.totalPhotos.toLocaleString()} />
            <StatsCard label="Avg Visits / User" value={data.avgVisitsPerUser} />
          </div>
        )}

        {/* Charts grid */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((n) => (
              <Skeleton key={n} className="h-80 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Most Visited Resorts */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Most Visited Resorts</CardTitle>
              </CardHeader>
              <CardContent>
                {data.mostVisited.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No visit data yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.mostVisited} layout="vertical" margin={barChartMargin}>
                      <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Most Wishlisted Resorts */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Most Wishlisted Resorts</CardTitle>
              </CardHeader>
              <CardContent>
                {data.mostWishlisted.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No wishlist data yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.mostWishlisted} layout="vertical" margin={barChartMargin}>
                      <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Visits by Country */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Visits by Country</CardTitle>
              </CardHeader>
              <CardContent>
                {data.visitsByCountry.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No country data yet.</p>
                ) : (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="60%" height={260}>
                      <PieChart>
                        <Pie
                          data={data.visitsByCountry}
                          dataKey="count"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          strokeWidth={2}
                          stroke="hsl(var(--card))"
                        >
                          {data.visitsByCountry.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1 max-h-[260px] overflow-auto">
                      {data.visitsByCountry.map((item, i) => (
                        <div key={item.name} className="flex items-center gap-2 text-xs">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="flex-1 truncate">{item.name}</span>
                          <span className="text-muted-foreground">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* User Experience Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">User Experience Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {data.experienceDistribution.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No profile data yet.</p>
                ) : (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="60%" height={260}>
                      <PieChart>
                        <Pie
                          data={data.experienceDistribution}
                          dataKey="count"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          strokeWidth={2}
                          stroke="hsl(var(--card))"
                        >
                          {data.experienceDistribution.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1 max-h-[260px] overflow-auto">
                      {data.experienceDistribution.map((item, i) => (
                        <div key={item.name} className="flex items-center gap-2 text-xs">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="flex-1 truncate">{item.name}</span>
                          <span className="text-muted-foreground">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
