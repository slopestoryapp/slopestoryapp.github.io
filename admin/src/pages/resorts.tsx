import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { PAGE_SIZE } from '@/lib/constants'
import { Header } from '@/components/layout/header'
import { ExportButton } from '@/components/shared/export-button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DataTable } from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { type ColumnDef } from '@tanstack/react-table'
import { Search, Loader2, Trash2, Save, AlertTriangle } from 'lucide-react'

interface Resort {
  id: string
  name: string
  country: string
  country_code: string | null
  region: string | null
  lat: number | null
  lng: number | null
  website: string | null
  vertical_m: number | null
  runs: number | null
  lifts: number | null
  annual_snowfall_cm: number | null
  beginner_pct: number | null
  intermediate_pct: number | null
  advanced_pct: number | null
  cover_image_url: string | null
  verified: boolean
  pass_affiliation: string | null
  season_open: string | null
  season_close: string | null
  has_night_skiing: boolean | null
  instagram_handle: string | null
  description: string | null
}

const columns: ColumnDef<Resort, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue('name')}</span>
    ),
  },
  {
    accessorKey: 'country',
    header: 'Country',
  },
  {
    accessorKey: 'region',
    header: 'Region',
    cell: ({ row }) => row.getValue('region') ?? '-',
  },
  {
    accessorKey: 'verified',
    header: 'Verified',
    cell: ({ row }) =>
      row.getValue('verified') ? (
        <Badge className="bg-green-500/20 text-green-400 border-0">Verified</Badge>
      ) : (
        <Badge variant="secondary">Unverified</Badge>
      ),
  },
  {
    accessorKey: 'lifts',
    header: 'Lifts',
    cell: ({ row }) => row.getValue('lifts') ?? '-',
  },
  {
    accessorKey: 'runs',
    header: 'Runs',
    cell: ({ row }) => row.getValue('runs') ?? '-',
  },
  {
    accessorKey: 'vertical_m',
    header: 'Vertical',
    cell: ({ row }) => {
      const val = row.getValue('vertical_m') as number | null
      return val ? `${val}m` : '-'
    },
  },
]

export function ResortsPage() {
  const { log } = useAuditLog()

  const [resorts, setResorts] = useState<Resort[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')

  // Edit dialog
  const [editResort, setEditResort] = useState<Resort | null>(null)
  const [editForm, setEditForm] = useState<Partial<Resort>>({})
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Duplicates
  const [duplicates, setDuplicates] = useState<string[]>([])

  const loadResorts = useCallback(async () => {
    try {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      let query = supabase
        .from('resorts')
        .select('*')
        .order('name', { ascending: true })
        .range(from, to)

      if (search.trim()) {
        query = query.ilike('name', `%${search.trim()}%`)
      }

      let countQuery = supabase
        .from('resorts')
        .select('*', { count: 'exact', head: true })

      if (search.trim()) {
        countQuery = countQuery.ilike('name', `%${search.trim()}%`)
      }

      const [dataRes, countRes] = await Promise.all([query, countQuery])

      const data = (dataRes.data as Resort[]) ?? []
      setResorts(data)
      setTotalCount(countRes.count ?? 0)

      // Detect duplicates
      const nameCountryMap = new Map<string, number>()
      for (const r of data) {
        const key = `${r.name.toLowerCase()}|${r.country.toLowerCase()}`
        nameCountryMap.set(key, (nameCountryMap.get(key) ?? 0) + 1)
      }
      const dupes: string[] = []
      nameCountryMap.forEach((count, key) => {
        if (count > 1) {
          const [name, country] = key.split('|')
          dupes.push(`${name} (${country})`)
        }
      })
      setDuplicates(dupes)
    } catch {
      toast.error('Failed to load resorts')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [page, search])

  useEffect(() => {
    loadResorts()
  }, [loadResorts])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadResorts()
  }, [loadResorts])

  const handleSearchSubmit = useCallback(() => {
    setPage(0)
    setLoading(true)
    loadResorts()
  }, [loadResorts])

  const openEdit = useCallback((resort: Resort) => {
    setEditResort(resort)
    setEditForm({ ...resort })
  }, [])

  const updateField = useCallback(
    (field: keyof Resort, value: string | number | boolean | null) => {
      setEditForm((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const handleSave = useCallback(async () => {
    if (!editResort) return
    setSaving(true)

    const {
      id: _id,
      ...payload
    } = editForm as Resort

    const { error } = await supabase
      .from('resorts')
      .update(payload)
      .eq('id', editResort.id)

    if (error) {
      toast.error(`Failed to save: ${error.message}`)
      setSaving(false)
      return
    }

    await log({
      action: 'update_resort',
      entity_type: 'resort',
      entity_id: editResort.id,
      details: { resort_name: editForm.name },
    })

    toast.success(`Saved: ${editForm.name}`)
    setSaving(false)
    setEditResort(null)
    loadResorts()
  }, [editResort, editForm, log, loadResorts])

  const handleDelete = useCallback(async () => {
    if (!editResort) return
    setDeleting(true)

    const { error } = await supabase
      .from('resorts')
      .delete()
      .eq('id', editResort.id)

    if (error) {
      toast.error(`Failed to delete: ${error.message}`)
      setDeleting(false)
      return
    }

    await log({
      action: 'delete_resort',
      entity_type: 'resort',
      entity_id: editResort.id,
      details: { resort_name: editResort.name },
    })

    toast.success(`Deleted: ${editResort.name}`)
    setDeleting(false)
    setDeleteConfirmOpen(false)
    setEditResort(null)
    loadResorts()
  }, [editResort, log, loadResorts])

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Resorts"
        subtitle="Manage ski resort database"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search resorts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleSearchSubmit}>
            Search
          </Button>
          <ExportButton
            data={resorts as unknown as Record<string, unknown>[]}
            filename="resorts"
          />
        </div>

        {/* Data Table */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={resorts}
            onRowClick={openEdit}
            pageSize={PAGE_SIZE}
            serverPagination={{
              totalCount,
              page,
              onPageChange: (p) => {
                setPage(p)
                setLoading(true)
              },
            }}
          />
        )}

        {/* Duplicate Warning */}
        {duplicates.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-yellow-400">
                Duplicate Resorts Detected
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                The following resorts appear more than once on this page (same name + country):
              </p>
              <ul className="mt-2 text-xs space-y-1">
                {duplicates.map((d) => (
                  <li key={d} className="text-yellow-300">
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog
        open={!!editResort}
        onOpenChange={(open) => !open && setEditResort(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Resort</DialogTitle>
            <DialogDescription>
              {editForm.name ?? 'Resort'} &middot; {editForm.country ?? ''}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="grid grid-cols-2 gap-4 py-4">
              {/* Text fields */}
              {([
                ['name', 'Name'],
                ['country', 'Country'],
                ['country_code', 'Country Code'],
                ['region', 'Region'],
                ['website', 'Website'],
                ['cover_image_url', 'Cover Image URL'],
                ['pass_affiliation', 'Pass Affiliation'],
                ['season_open', 'Season Open'],
                ['season_close', 'Season Close'],
                ['instagram_handle', 'Instagram'],
              ] as [keyof Resort, string][]).map(([field, label]) => (
                <div key={field}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    value={(editForm[field] as string) ?? ''}
                    onChange={(e) => updateField(field, e.target.value || null)}
                    className="mt-1"
                  />
                </div>
              ))}

              {/* Number fields */}
              {([
                ['lat', 'Latitude'],
                ['lng', 'Longitude'],
                ['vertical_m', 'Vertical (m)'],
                ['runs', 'Runs'],
                ['lifts', 'Lifts'],
                ['annual_snowfall_cm', 'Snowfall (cm)'],
                ['beginner_pct', 'Beginner %'],
                ['intermediate_pct', 'Intermediate %'],
                ['advanced_pct', 'Advanced %'],
              ] as [keyof Resort, string][]).map(([field, label]) => (
                <div key={field}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    type="number"
                    value={(editForm[field] as number) ?? ''}
                    onChange={(e) =>
                      updateField(
                        field,
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    className="mt-1"
                  />
                </div>
              ))}

              {/* Boolean: Verified */}
              <div>
                <Label className="text-xs">Verified</Label>
                <Select
                  value={editForm.verified ? 'true' : 'false'}
                  onValueChange={(v) => updateField('verified', v === 'true')}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Verified</SelectItem>
                    <SelectItem value="false">Unverified</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Boolean: Night Skiing */}
              <div>
                <Label className="text-xs">Night Skiing</Label>
                <Select
                  value={
                    editForm.has_night_skiing === null
                      ? 'null'
                      : editForm.has_night_skiing
                        ? 'true'
                        : 'false'
                  }
                  onValueChange={(v) =>
                    updateField(
                      'has_night_skiing',
                      v === 'null' ? null : v === 'true'
                    )
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                    <SelectItem value="null">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Description */}
              <div className="col-span-2">
                <Label className="text-xs">Description</Label>
                <textarea
                  value={(editForm.description as string) ?? ''}
                  onChange={(e) =>
                    updateField('description', e.target.value || null)
                  }
                  className="mt-1 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px]"
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleting}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-1" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Resort"
        description={`Are you sure you want to permanently delete "${editResort?.name}"? This will also delete all associated visits, photos, and wishlists. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
