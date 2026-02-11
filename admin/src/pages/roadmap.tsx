import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
import { ROADMAP_STATUSES } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppFeature {
  id: string
  parent_id: string | null
  name: string
  node_type: 'branch' | 'feature'
  status: string | null
  sort_order: number
}

interface FormState {
  name: string
  status: string
  sort_order: number
}

const EMPTY_FORM: FormState = { name: '', status: 'exploring', sort_order: 0 }

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusColor(status: string | null): string {
  switch (status) {
    case 'exploring':
      return 'text-purple-400 bg-purple-400/10'
    case 'planned':
      return 'text-blue-400 bg-blue-400/10'
    case 'dusted':
      return 'text-slate-400 bg-slate-400/10'
    case 'in_progress':
      return 'text-yellow-400 bg-yellow-400/10'
    case 'done':
      return 'text-green-400 bg-green-400/10'
    default:
      return 'text-muted-foreground bg-muted'
  }
}

// ---------------------------------------------------------------------------
// Sortable Feature Row
// ---------------------------------------------------------------------------

interface SortableFeatureRowProps {
  feature: AppFeature
  onNameUpdate: (id: string, name: string) => void
  onStatusUpdate: (id: string, status: string) => void
  onDelete: (feature: AppFeature) => void
}

function SortableFeatureRow({
  feature,
  onNameUpdate,
  onStatusUpdate,
  onDelete,
}: SortableFeatureRowProps) {
  const [localName, setLocalName] = useState(feature.name)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: feature.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleBlur = () => {
    const trimmed = localName.trim()
    if (trimmed && trimmed !== feature.name) {
      onNameUpdate(feature.id, trimmed)
    } else {
      setLocalName(feature.name)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-2 border border-border rounded-lg bg-background group hover:border-primary/30 transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <Input
        value={localName}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="flex-1 h-8 text-sm border-transparent hover:border-input focus:border-input"
      />

      <Select value={feature.status ?? 'exploring'} onValueChange={(v) => onStatusUpdate(feature.id, v)}>
        <SelectTrigger className="w-[130px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROADMAP_STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              <span className={statusColor(s.value)}>{s.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onDelete(feature)}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sortable Branch Card
// ---------------------------------------------------------------------------

interface SortableBranchCardProps {
  branch: AppFeature
  features: AppFeature[]
  collapsed: boolean
  onToggle: () => void
  onEdit: (branch: AppFeature) => void
  onDelete: (branch: AppFeature) => void
  onAddFeature: (branchId: string) => void
  onFeatureNameUpdate: (id: string, name: string) => void
  onFeatureStatusUpdate: (id: string, status: string) => void
  onFeatureDelete: (feature: AppFeature) => void
  onFeatureReorder: (branchId: string, event: DragEndEvent) => void
}

function SortableBranchCard({
  branch,
  features,
  collapsed,
  onToggle,
  onEdit,
  onDelete,
  onAddFeature,
  onFeatureNameUpdate,
  onFeatureStatusUpdate,
  onFeatureDelete,
  onFeatureReorder,
}: SortableBranchCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: branch.id,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <CardHeader className="p-4">
          <div className="flex items-center gap-3">
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            >
              <GripVertical className="w-4 h-4" />
            </button>

            <button onClick={onToggle} className="flex items-center gap-2 flex-1 text-left">
              {collapsed ? (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
              <CardTitle className="text-sm">{branch.name}</CardTitle>
              <Badge variant="secondary" className="text-[10px]">
                {features.length} feature{features.length !== 1 ? 's' : ''}
              </Badge>
            </button>

            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onAddFeature(branch.id)}>
                <Plus className="w-3 h-3 mr-1" />
                Add Feature
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(branch)}>
                <Pencil className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(branch)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {!collapsed && (
          <CardContent className="p-4 pt-0">
            {features.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No features yet. Click "Add Feature" to create one.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => onFeatureReorder(branch.id, event)}
              >
                <SortableContext items={features.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {features.map((feature) => (
                      <SortableFeatureRow
                        key={feature.id}
                        feature={feature}
                        onNameUpdate={onFeatureNameUpdate}
                        onStatusUpdate={onFeatureStatusUpdate}
                        onDelete={onFeatureDelete}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function RoadmapPage() {
  const { log } = useAuditLog()

  // Data
  const [items, setItems] = useState<AppFeature[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // UI
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set())

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'add-branch' | 'add-feature' | 'edit'>('add-branch')
  const [dialogTarget, setDialogTarget] = useState<AppFeature | null>(null) // editing item, or parent branch for add-feature
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<AppFeature | null>(null)

  // DnD sensors (branch level)
  const branchSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const { data, error } = await supabase
        .from('app_features')
        .select('id, parent_id, name, node_type, status, sort_order')
        .order('sort_order')
        .order('name')

      if (error) throw error
      setItems(data ?? [])
    } catch (err) {
      console.error(err)
      toast.error('Failed to load roadmap data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const branches = items.filter((i) => i.node_type === 'branch' && i.parent_id === null)
  const featuresForBranch = (branchId: string) =>
    items
      .filter((i) => i.node_type === 'feature' && i.parent_id === branchId)
      .sort((a, b) => a.sort_order - b.sort_order)

  // -----------------------------------------------------------------------
  // Toggle collapse
  // -----------------------------------------------------------------------

  const toggleBranch = (id: string) => {
    setCollapsedBranches((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // -----------------------------------------------------------------------
  // Inline feature updates
  // -----------------------------------------------------------------------

  const handleFeatureNameUpdate = async (id: string, name: string) => {
    try {
      const { error } = await supabase.from('app_features').update({ name }).eq('id', id)
      if (error) throw error
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, name } : i)))
      toast.success('Feature name updated')
    } catch {
      toast.error('Failed to update feature name')
    }
  }

  const handleFeatureStatusUpdate = async (id: string, status: string) => {
    try {
      const { error } = await supabase.from('app_features').update({ status }).eq('id', id)
      if (error) throw error
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))
      toast.success('Status updated')
      await log({
        action: 'edit_resort',
        entity_type: 'app_feature',
        entity_id: id,
        details: { field: 'status', value: status },
      })
    } catch {
      toast.error('Failed to update status')
    }
  }

  // -----------------------------------------------------------------------
  // Drag & drop: features within a branch
  // -----------------------------------------------------------------------

  const handleFeatureReorder = async (branchId: string, event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const branchFeatures = featuresForBranch(branchId)
    const oldIndex = branchFeatures.findIndex((f) => f.id === active.id)
    const newIndex = branchFeatures.findIndex((f) => f.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(branchFeatures, oldIndex, newIndex)

    // Optimistic update
    const updatedItems = items.map((item) => {
      const idx = reordered.findIndex((r) => r.id === item.id)
      if (idx !== -1) return { ...item, sort_order: idx }
      return item
    })
    setItems(updatedItems)

    // Persist
    try {
      await Promise.all(
        reordered.map((f, idx) =>
          supabase.from('app_features').update({ sort_order: idx }).eq('id', f.id)
        )
      )
    } catch {
      toast.error('Failed to save reorder')
      fetchData()
    }
  }

  // -----------------------------------------------------------------------
  // Drag & drop: branches
  // -----------------------------------------------------------------------

  const handleBranchReorder = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = branches.findIndex((b) => b.id === active.id)
    const newIndex = branches.findIndex((b) => b.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(branches, oldIndex, newIndex)

    // Optimistic
    const updatedItems = items.map((item) => {
      const idx = reordered.findIndex((r) => r.id === item.id)
      if (idx !== -1) return { ...item, sort_order: idx }
      return item
    })
    setItems(updatedItems)

    // Persist
    try {
      await Promise.all(
        reordered.map((b, idx) =>
          supabase.from('app_features').update({ sort_order: idx }).eq('id', b.id)
        )
      )
    } catch {
      toast.error('Failed to save branch reorder')
      fetchData()
    }
  }

  // -----------------------------------------------------------------------
  // Add / Edit dialog
  // -----------------------------------------------------------------------

  const openAddBranch = () => {
    setDialogMode('add-branch')
    setDialogTarget(null)
    setForm({ ...EMPTY_FORM, sort_order: branches.length })
    setDialogOpen(true)
  }

  const openAddFeature = (branchId: string) => {
    const branch = items.find((i) => i.id === branchId)
    setDialogMode('add-feature')
    setDialogTarget(branch ?? null)
    const count = featuresForBranch(branchId).length
    setForm({ ...EMPTY_FORM, sort_order: count })
    setDialogOpen(true)
  }

  const openEditItem = (item: AppFeature) => {
    setDialogMode('edit')
    setDialogTarget(item)
    setForm({
      name: item.name,
      status: item.status ?? 'exploring',
      sort_order: item.sort_order,
    })
    setDialogOpen(true)
  }

  const handleDialogSave = async () => {
    const name = form.name.trim()
    if (!name) {
      toast.error('Name is required')
      return
    }

    setSaving(true)

    try {
      if (dialogMode === 'add-branch') {
        const { error } = await supabase.from('app_features').insert({
          name,
          node_type: 'branch',
          parent_id: null,
          sort_order: form.sort_order,
          status: null,
        })
        if (error) throw error
        toast.success('Branch created')
        await log({ action: 'create_resort', entity_type: 'app_feature', details: { name, node_type: 'branch' } })
      } else if (dialogMode === 'add-feature') {
        const { error } = await supabase.from('app_features').insert({
          name,
          node_type: 'feature',
          parent_id: dialogTarget?.id ?? null,
          sort_order: form.sort_order,
          status: form.status,
        })
        if (error) throw error
        toast.success('Feature created')
        await log({
          action: 'create_resort',
          entity_type: 'app_feature',
          details: { name, node_type: 'feature', parent: dialogTarget?.name },
        })
      } else if (dialogMode === 'edit' && dialogTarget) {
        const updates: Partial<AppFeature> = { name, sort_order: form.sort_order }
        if (dialogTarget.node_type === 'feature') updates.status = form.status
        const { error } = await supabase.from('app_features').update(updates).eq('id', dialogTarget.id)
        if (error) throw error
        toast.success('Item updated')
        await log({
          action: 'edit_resort',
          entity_type: 'app_feature',
          entity_id: dialogTarget.id,
          details: { name, sort_order: form.sort_order },
        })
      }

      setDialogOpen(false)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Failed to save')
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
      // If deleting a branch, also delete its features
      if (deleteTarget.node_type === 'branch') {
        const { error: childError } = await supabase
          .from('app_features')
          .delete()
          .eq('parent_id', deleteTarget.id)
        if (childError) throw childError
      }

      const { error } = await supabase.from('app_features').delete().eq('id', deleteTarget.id)
      if (error) throw error

      toast.success(`${deleteTarget.node_type === 'branch' ? 'Branch' : 'Feature'} deleted`)
      await log({
        action: 'delete_resort',
        entity_type: 'app_feature',
        entity_id: deleteTarget.id,
        details: { name: deleteTarget.name, node_type: deleteTarget.node_type },
      })
      setDeleteTarget(null)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete')
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Feature Roadmap"
        subtitle="Manage feature branches and roadmap items"
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {branches.length} branch{branches.length !== 1 ? 'es' : ''},{' '}
            {items.filter((i) => i.node_type === 'feature').length} features
          </p>
          <Button onClick={openAddBranch}>
            <Plus className="w-4 h-4 mr-2" />
            Add Branch
          </Button>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && branches.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-4">No roadmap branches yet.</p>
            <Button onClick={openAddBranch}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Branch
            </Button>
          </div>
        )}

        {/* Branch list with DnD */}
        {!loading && branches.length > 0 && (
          <DndContext
            sensors={branchSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleBranchReorder}
          >
            <SortableContext items={branches.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {branches.map((branch) => (
                  <SortableBranchCard
                    key={branch.id}
                    branch={branch}
                    features={featuresForBranch(branch.id)}
                    collapsed={collapsedBranches.has(branch.id)}
                    onToggle={() => toggleBranch(branch.id)}
                    onEdit={openEditItem}
                    onDelete={setDeleteTarget}
                    onAddFeature={openAddFeature}
                    onFeatureNameUpdate={handleFeatureNameUpdate}
                    onFeatureStatusUpdate={handleFeatureStatusUpdate}
                    onFeatureDelete={setDeleteTarget}
                    onFeatureReorder={handleFeatureReorder}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'add-branch'
                ? 'Add Branch'
                : dialogMode === 'add-feature'
                  ? `Add Feature to "${dialogTarget?.name}"`
                  : `Edit ${dialogTarget?.node_type === 'branch' ? 'Branch' : 'Feature'}`}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'add-branch'
                ? 'Create a new feature branch to group related features.'
                : dialogMode === 'add-feature'
                  ? 'Add a new feature under this branch.'
                  : 'Update the details of this item.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Feature or branch name"
              />
            </div>

            {(dialogMode === 'add-feature' || (dialogMode === 'edit' && dialogTarget?.node_type === 'feature')) && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROADMAP_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDialogSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {dialogMode === 'edit' ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.node_type === 'branch' ? 'Branch' : 'Feature'}?`}
        description={
          deleteTarget?.node_type === 'branch'
            ? `This will permanently delete the branch "${deleteTarget.name}" and all its features.`
            : `This will permanently delete the feature "${deleteTarget?.name}".`
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
