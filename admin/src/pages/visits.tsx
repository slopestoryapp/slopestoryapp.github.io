import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
import { PAGE_SIZE } from '@/lib/constants'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DataTable } from '@/components/shared/data-table'
import { ExportButton } from '@/components/shared/export-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, Search, Star } from 'lucide-react'
import { type ColumnDef } from '@tanstack/react-table'

// ---------------------------------------------------------------------------
// Types (matches actual user_visits schema)
// ---------------------------------------------------------------------------

interface VisitRow {
  id: string
  resort_id: string | null
  user_id: string
  entry_type: string | null
  title: string | null
  start_date: string | null
  end_date: string | null
  date_precision: string | null
  notes: string | null
  rating_terrain: number | null
  rating_facilities: number | null
  rating_service: number | null
  created_at: string
  pending_resort_name: string | null
  resort_name: string
  resort_country: string
  user_email: string
  user_name: string
}

interface RawVisit {
  id: string
  resort_id: string | null
  user_id: string
  entry_type: string | null
  title: string | null
  start_date: string | null
  end_date: string | null
  date_precision: string | null
  notes: string | null
  rating_terrain: number | null
  rating_facilities: number | null
  rating_service: number | null
  created_at: string
  pending_resort_name: string | null
  resorts: { name: string; country: string } | null
}

interface ProfileRow {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avgRating(t: number | null, f: number | null, s: number | null): number | null {
  const vals = [t, f, s].filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
}

function ratingBadgeColor(rating: number | null): string {
  if (rating === null) return 'text-slate-400 bg-slate-400/10'
  if (rating >= 4) return 'text-green-400 bg-green-400/10'
  if (rating >= 3) return 'text-yellow-400 bg-yellow-400/10'
  return 'text-red-400 bg-red-400/10'
}

function entryTypeBadge(type: string | null): string {
  switch (type) {
    case 'day_trip':
      return 'text-blue-400 bg-blue-400/10'
    case 'album':
      return 'text-purple-400 bg-purple-400/10'
    default:
      return 'text-slate-400 bg-slate-400/10'
  }
}

function flattenVisit(raw: RawVisit, profilesMap: Map<string, ProfileRow>): VisitRow {
  const profile = profilesMap.get(raw.user_id)
  const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || ''
  return {
    id: raw.id,
    resort_id: raw.resort_id,
    user_id: raw.user_id,
    entry_type: raw.entry_type,
    title: raw.title,
    start_date: raw.start_date,
    end_date: raw.end_date,
    date_precision: raw.date_precision,
    notes: raw.notes,
    rating_terrain: raw.rating_terrain,
    rating_facilities: raw.rating_facilities,
    rating_service: raw.rating_service,
    created_at: raw.created_at,
    pending_resort_name: raw.pending_resort_name,
    resort_name: raw.resorts?.name ?? raw.pending_resort_name ?? 'Unknown Resort',
    resort_country: raw.resorts?.country ?? '',
    user_email: profile?.email ?? raw.user_id.slice(0, 8),
    user_name: userName,
  }
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function VisitsPage() {
  const { log } = useAuditLog()

  // Data
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')

  // Edit dialog
  const [editVisit, setEditVisit] = useState<VisitRow | null>(null)
  const [editForm, setEditForm] = useState({
    start_date: '',
    end_date: '',
    rating_terrain: '',
    rating_facilities: '',
    rating_service: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<VisitRow | null>(null)

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  const fetchVisits = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true)
      else setLoading(true)

      try {
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1

        const [countRes, dataRes] = await Promise.all([
          supabase
            .from('user_visits')
            .select('*', { count: 'exact', head: true }),
          supabase
            .from('user_visits')
            .select('id, resort_id, user_id, entry_type, title, start_date, end_date, date_precision, notes, rating_terrain, rating_facilities, rating_service, created_at, pending_resort_name, resorts(name, country)')
            .order('created_at', { ascending: false })
            .range(from, to),
        ])

        if (countRes.error) throw countRes.error
        if (dataRes.error) throw dataRes.error
        setTotalCount(countRes.count ?? 0)

        const rawVisits = (dataRes.data ?? []) as unknown as RawVisit[]

        // Fetch profiles for the user_ids on this page
        const userIds = [...new Set(rawVisits.map((v) => v.user_id))]
        const profilesMap = new Map<string, ProfileRow>()

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, email, first_name, last_name')
            .in('id', userIds)

          for (const p of (profiles ?? []) as ProfileRow[]) {
            profilesMap.set(p.id, p)
          }
        }

        setVisits(rawVisits.map((v) => flattenVisit(v, profilesMap)))
      } catch (err) {
        console.error(err)
        toast.error('Failed to load visits')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page]
  )

  useEffect(() => {
    fetchVisits()
  }, [fetchVisits])

  // -----------------------------------------------------------------------
  // Filtered data for client-side search
  // -----------------------------------------------------------------------

  const filteredVisits = useMemo(() => {
    if (!search.trim()) return visits
    const q = search.toLowerCase()
    return visits.filter(
      (v) =>
        v.resort_name.toLowerCase().includes(q) ||
        v.user_email.toLowerCase().includes(q) ||
        v.user_name.toLowerCase().includes(q)
    )
  }, [visits, search])

  // -----------------------------------------------------------------------
  // Columns
  // -----------------------------------------------------------------------

  const columns: ColumnDef<VisitRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'resort_name',
        header: 'Resort',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.resort_name}</div>
            {row.original.resort_country && (
              <div className="text-xs text-muted-foreground">{row.original.resort_country}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'user_email',
        header: 'User',
        cell: ({ row }) => (
          <div>
            {row.original.user_name && (
              <div className="text-sm font-medium">{row.original.user_name}</div>
            )}
            <div className="text-xs text-muted-foreground">{row.original.user_email}</div>
          </div>
        ),
      },
      {
        accessorKey: 'start_date',
        header: 'Date',
        cell: ({ row }) => {
          const start = row.original.start_date
          const end = row.original.end_date
          if (!start) return <span className="text-xs text-muted-foreground">--</span>
          if (end && end !== start) {
            return (
              <span className="text-sm">
                {formatDate(start)} — {formatDate(end)}
              </span>
            )
          }
          return <span className="text-sm">{formatDate(start)}</span>
        },
      },
      {
        id: 'avg_rating',
        header: 'Rating',
        cell: ({ row }) => {
          const avg = avgRating(
            row.original.rating_terrain,
            row.original.rating_facilities,
            row.original.rating_service
          )
          return avg !== null ? (
            <Badge variant="outline" className={ratingBadgeColor(avg)}>
              <Star className="w-3 h-3 mr-1 fill-current" />
              {avg}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">--</span>
          )
        },
      },
      {
        accessorKey: 'entry_type',
        header: 'Type',
        cell: ({ row }) => {
          const t = row.original.entry_type
          return t ? (
            <Badge variant="outline" className={entryTypeBadge(t)}>
              {t === 'day_trip' ? 'Day Trip' : t === 'album' ? 'Album' : t}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">--</span>
          )
        },
      },
    ],
    []
  )

  // -----------------------------------------------------------------------
  // Edit dialog
  // -----------------------------------------------------------------------

  const openEdit = (visit: VisitRow) => {
    setEditVisit(visit)
    setEditForm({
      start_date: visit.start_date ?? '',
      end_date: visit.end_date ?? '',
      rating_terrain: visit.rating_terrain !== null ? String(visit.rating_terrain) : '',
      rating_facilities: visit.rating_facilities !== null ? String(visit.rating_facilities) : '',
      rating_service: visit.rating_service !== null ? String(visit.rating_service) : '',
      notes: visit.notes ?? '',
    })
  }

  const handleSave = async () => {
    if (!editVisit) return
    setSaving(true)

    try {
      const updates: Record<string, unknown> = {}
      if (editForm.start_date) updates.start_date = editForm.start_date
      if (editForm.end_date) updates.end_date = editForm.end_date
      updates.rating_terrain = editForm.rating_terrain !== '' ? parseFloat(editForm.rating_terrain) : null
      updates.rating_facilities = editForm.rating_facilities !== '' ? parseFloat(editForm.rating_facilities) : null
      updates.rating_service = editForm.rating_service !== '' ? parseFloat(editForm.rating_service) : null
      updates.notes = editForm.notes || null

      const { error } = await supabase.from('user_visits').update(updates).eq('id', editVisit.id)
      if (error) throw error

      toast.success('Visit updated')
      await log({
        action: 'edit_visit',
        entity_type: 'user_visit',
        entity_id: editVisit.id,
        details: updates,
      })
      setEditVisit(null)
      fetchVisits()
    } catch (err) {
      console.error(err)
      toast.error('Failed to update visit')
    } finally {
      setSaving(false)
    }
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  const handleDelete = async () => {
    if (!deleteTarget) return

    try {
      const { error } = await supabase.from('user_visits').delete().eq('id', deleteTarget.id)
      if (error) throw error

      toast.success('Visit deleted')
      await log({
        action: 'delete_visit',
        entity_type: 'user_visit',
        entity_id: deleteTarget.id,
        details: {
          resort: deleteTarget.resort_name,
          user: deleteTarget.user_email,
          date: deleteTarget.start_date,
        },
      })
      setDeleteTarget(null)
      fetchVisits()
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete visit')
    }
  }

  // -----------------------------------------------------------------------
  // Export data
  // -----------------------------------------------------------------------

  const exportData = useMemo(
    () =>
      visits.map((v) => ({
        id: v.id,
        resort: v.resort_name,
        country: v.resort_country,
        user_email: v.user_email,
        user_name: v.user_name,
        entry_type: v.entry_type ?? '',
        start_date: v.start_date ?? '',
        end_date: v.end_date ?? '',
        rating_terrain: v.rating_terrain ?? '',
        rating_facilities: v.rating_facilities ?? '',
        rating_service: v.rating_service ?? '',
        notes: v.notes ?? '',
      })),
    [visits]
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Visits"
        subtitle={`${totalCount} total visit records`}
        onRefresh={() => fetchVisits(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by resort or user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <ExportButton data={exportData as Record<string, unknown>[]} filename="visits" />
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <Skeleton key={n} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        )}

        {/* Data table */}
        {!loading && (
          <DataTable
            columns={columns}
            data={filteredVisits}
            onRowClick={openEdit}
            searchColumn="resort_name"
            searchPlaceholder="Filter results..."
            serverPagination={{
              totalCount,
              page,
              onPageChange: setPage,
            }}
          />
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editVisit} onOpenChange={(open) => !open && setEditVisit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Visit</DialogTitle>
            <DialogDescription>
              {editVisit?.resort_name} — {editVisit?.user_email}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={editForm.start_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={editForm.end_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Terrain</Label>
                <Input
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={editForm.rating_terrain}
                  onChange={(e) => setEditForm((f) => ({ ...f, rating_terrain: e.target.value }))}
                  placeholder="--"
                />
              </div>
              <div className="space-y-2">
                <Label>Facilities</Label>
                <Input
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={editForm.rating_facilities}
                  onChange={(e) => setEditForm((f) => ({ ...f, rating_facilities: e.target.value }))}
                  placeholder="--"
                />
              </div>
              <div className="space-y-2">
                <Label>Service</Label>
                <Input
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={editForm.rating_service}
                  onChange={(e) => setEditForm((f) => ({ ...f, rating_service: e.target.value }))}
                  placeholder="--"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="No notes"
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[60px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <Label className="text-muted-foreground text-xs">Resort ID</Label>
                <p className="text-xs font-mono mt-1 truncate">{editVisit?.resort_id ?? 'None'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">User ID</Label>
                <p className="text-xs font-mono mt-1 truncate">{editVisit?.user_id}</p>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="sm:mr-auto"
              onClick={() => {
                if (editVisit) {
                  setDeleteTarget(editVisit)
                  setEditVisit(null)
                }
              }}
            >
              Delete Visit
            </Button>
            <Button variant="outline" onClick={() => setEditVisit(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Visit"
        description="This will permanently delete this visit record. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
