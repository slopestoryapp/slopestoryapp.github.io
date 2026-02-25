import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { COHORTS } from '@/lib/constants'
import { formatDate, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { ExportButton } from '@/components/shared/export-button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DataTable } from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { type ColumnDef } from '@tanstack/react-table'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'

interface Tester {
  id: string
  email: string
  name: string | null
  cohort: string
  opted_in: boolean
  added_at: string
}

interface TesterForm {
  email: string
  name: string
  cohort: string
  opted_in: boolean
}

const EMPTY_FORM: TesterForm = { email: '', name: '', cohort: 'phase1', opted_in: true }

export function TestersPage() {
  const { log } = useAuditLog()

  const [testers, setTesters] = useState<Tester[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Cohort filter
  const [cohortFilter, setCohortFilter] = useState<string>('all')

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add')
  const [editTarget, setEditTarget] = useState<Tester | null>(null)
  const [form, setForm] = useState<TesterForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Tester | null>(null)

  const loadTesters = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tester_emails')
        .select('*')
        .order('added_at', { ascending: false })
      if (error) throw error
      setTesters((data as Tester[]) ?? [])
    } catch {
      toast.error('Failed to load testers')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadTesters()
  }, [loadTesters])

  const filteredTesters = useMemo(
    () => cohortFilter === 'all' ? testers : testers.filter((t) => t.cohort === cohortFilter),
    [testers, cohortFilter],
  )

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadTesters()
  }, [loadTesters])

  const openAddDialog = useCallback(() => {
    setForm(EMPTY_FORM)
    setDialogMode('add')
    setEditTarget(null)
    setDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((tester: Tester) => {
    setForm({
      email: tester.email,
      name: tester.name ?? '',
      cohort: tester.cohort,
      opted_in: tester.opted_in,
    })
    setDialogMode('edit')
    setEditTarget(tester)
    setDialogOpen(true)
  }, [])

  const handleSave = useCallback(async () => {
    const email = form.email.trim().toLowerCase()
    if (!email) {
      toast.error('Email is required')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Invalid email format')
      return
    }

    setSaving(true)
    try {
      if (dialogMode === 'add') {
        const { error } = await supabase.from('tester_emails').insert({
          email,
          name: form.name.trim() || null,
          cohort: form.cohort,
          opted_in: form.opted_in,
        })
        if (error) throw error
        await log({
          action: 'add_tester',
          entity_type: 'tester_email',
          entity_id: undefined,
          details: { email, cohort: form.cohort },
        })
        toast.success(`Added ${email}`)
      } else if (editTarget) {
        const { error } = await supabase
          .from('tester_emails')
          .update({
            email,
            name: form.name.trim() || null,
            cohort: form.cohort,
            opted_in: form.opted_in,
          })
          .eq('id', editTarget.id)
        if (error) throw error
        await log({
          action: 'update_tester',
          entity_type: 'tester_email',
          entity_id: editTarget.id,
          details: { email, cohort: form.cohort },
        })
        toast.success(`Updated ${email}`)
      }
      setDialogOpen(false)
      loadTesters()
    } catch {
      toast.error(dialogMode === 'add' ? 'Failed to add tester' : 'Failed to update tester')
    } finally {
      setSaving(false)
    }
  }, [form, dialogMode, editTarget, log, loadTesters])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      const { error } = await supabase
        .from('tester_emails')
        .delete()
        .eq('id', deleteTarget.id)
      if (error) throw error
      await log({
        action: 'delete_tester',
        entity_type: 'tester_email',
        entity_id: deleteTarget.id,
        details: { email: deleteTarget.email },
      })
      toast.success(`Removed ${deleteTarget.email}`)
      setDeleteTarget(null)
      loadTesters()
    } catch {
      toast.error('Failed to delete tester')
    }
  }, [deleteTarget, log, loadTesters])

  const columns: ColumnDef<Tester, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => <span className="font-medium">{row.original.email}</span>,
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.name ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'cohort',
        header: 'Cohort',
        cell: ({ row }) => {
          const c = COHORTS.find((co) => co.value === row.original.cohort)
          return (
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-md font-medium',
                c?.color ?? 'text-muted-foreground',
              )}
            >
              {c?.label ?? row.original.cohort}
            </span>
          )
        },
      },
      {
        accessorKey: 'opted_in',
        header: 'Opted In',
        cell: ({ row }) =>
          row.original.opted_in ? (
            <Badge className="bg-green-500/20 text-green-400 border-0">Yes</Badge>
          ) : (
            <Badge variant="secondary">No</Badge>
          ),
      },
      {
        accessorKey: 'added_at',
        header: 'Added',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(row.original.added_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation()
                openEditDialog(row.original)
              }}
            >
              <Pencil className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                setDeleteTarget(row.original)
              }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ),
      },
    ],
    [openEditDialog],
  )

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Testers"
        subtitle="Manage beta tester email list"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatsCard label="Total Testers" value={testers.length} />
          <StatsCard
            label="Phase 1"
            value={testers.filter((t) => t.cohort === 'phase1').length}
          />
          <StatsCard
            label="Phase 2"
            value={testers.filter((t) => t.cohort === 'phase2').length}
          />
          <StatsCard
            label="Opted In"
            value={testers.filter((t) => t.opted_in).length}
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={cohortFilter} onValueChange={setCohortFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Cohort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cohorts</SelectItem>
              {COHORTS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {filteredTesters.length} tester(s)
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ExportButton
              data={filteredTesters as unknown as Record<string, unknown>[]}
              filename="testers"
            />
            <Button onClick={openAddDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Add Tester
            </Button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredTesters}
            searchColumn="email"
            searchPlaceholder="Search by email..."
          />
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'add' ? 'Add Tester' : 'Edit Tester'}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'add'
                ? 'Add a new email to the beta tester list.'
                : 'Update tester details.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="tester@example.com"
                type="email"
              />
            </div>
            <div className="space-y-2">
              <Label>Name (optional)</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label>Cohort</Label>
              <Select
                value={form.cohort}
                onValueChange={(v) => setForm((f) => ({ ...f, cohort: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COHORTS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Opted In</Label>
              <Select
                value={form.opted_in ? 'yes' : 'no'}
                onValueChange={(v) => setForm((f) => ({ ...f, opted_in: v === 'yes' }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {dialogMode === 'add' ? 'Add Tester' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Tester"
        description={`Remove "${deleteTarget?.email}" from the tester list? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
