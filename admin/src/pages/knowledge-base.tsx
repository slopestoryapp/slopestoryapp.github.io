import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'

interface SupportKbRow {
  id: string
  type: 'kb' | 'faq'
  title: string
  slug: string
  content: string | null
  keywords: string[] | null
  sort_order: number
  created_at: string
}

interface FormState {
  type: 'kb' | 'faq'
  title: string
  slug: string
  content: string
  keywords: string
  sort_order: number
}

const EMPTY_FORM: FormState = {
  type: 'kb',
  title: '',
  slug: '',
  content: '',
  keywords: '',
  sort_order: 0,
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function KnowledgeBasePage() {
  const { log } = useAuditLog()
  const [items, setItems] = useState<SupportKbRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'kb' | 'faq'>('all')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add')
  const [editTarget, setEditTarget] = useState<SupportKbRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<SupportKbRow | null>(null)

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const { data, error } = await supabase
        .from('support_kb')
        .select('id, type, title, slug, content, keywords, sort_order, created_at')
        .order('sort_order')
        .order('title')

      if (error) throw error
      setItems(data ?? [])
    } catch (err) {
      console.error(err)
      toast.error('Failed to load knowledge base')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredItems = items.filter((i) => (typeFilter === 'all' ? true : i.type === typeFilter))

  const openAdd = () => {
    setDialogMode('add')
    setEditTarget(null)
    setForm({
      ...EMPTY_FORM,
      sort_order: items.length,
    })
    setDialogOpen(true)
  }

  const openEdit = (row: SupportKbRow) => {
    setDialogMode('edit')
    setEditTarget(row)
    setForm({
      type: row.type,
      title: row.title,
      slug: row.slug,
      content: row.content ?? '',
      keywords: (row.keywords ?? []).join(', '),
      sort_order: row.sort_order,
    })
    setDialogOpen(true)
  }

  const handleTitleChange = (title: string) => {
    setForm((f) => ({ ...f, title, slug: dialogMode === 'add' ? slugify(title) : f.slug }))
  }

  const handleDialogSave = async () => {
    const title = form.title.trim()
    const slug = form.slug.trim()
    if (!title || !slug) {
      toast.error('Title and slug are required')
      return
    }

    setSaving(true)
    const keywords = form.keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)

    try {
      if (dialogMode === 'add') {
        const { error } = await supabase.from('support_kb').insert({
          type: form.type,
          title,
          slug,
          content: form.content.trim() || null,
          keywords: keywords.length > 0 ? keywords : null,
          sort_order: form.sort_order,
        })
        if (error) throw error
        toast.success('Article created')
        await log({
          action: 'create_resort',
          entity_type: 'support_kb',
          details: { title, type: form.type },
        })
      } else if (editTarget) {
        const { error } = await supabase
          .from('support_kb')
          .update({
            type: form.type,
            title,
            slug,
            content: form.content.trim() || null,
            keywords: keywords.length > 0 ? keywords : null,
            sort_order: form.sort_order,
          })
          .eq('id', editTarget.id)
        if (error) throw error
        toast.success('Article updated')
        await log({
          action: 'edit_resort',
          entity_type: 'support_kb',
          entity_id: editTarget.id,
          details: { title },
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

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const { error } = await supabase.from('support_kb').delete().eq('id', deleteTarget.id)
      if (error) throw error
      toast.success('Article deleted')
      await log({
        action: 'delete_resort',
        entity_type: 'support_kb',
        entity_id: deleteTarget.id,
        details: { title: deleteTarget.title },
      })
      setDeleteTarget(null)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Knowledge Base"
        subtitle="Manage KB and FAQ content for the support page"
        onRefresh={() => fetchData(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | 'kb' | 'faq')}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="kb">KB</SelectItem>
                <SelectItem value="faq">FAQ</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {filteredItems.length} article{filteredItems.length !== 1 ? 's' : ''}
            </span>
          </div>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Article
          </Button>
        </div>

        {loading && (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <Skeleton key={n} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!loading && filteredItems.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-4">
              {typeFilter === 'all'
                ? 'No articles yet.'
                : `No ${typeFilter} articles. Try changing the filter.`}
            </p>
            <Button onClick={openAdd}>
              <Plus className="w-4 h-4 mr-2" />
              Add First Article
            </Button>
          </div>
        )}

        {!loading && filteredItems.length > 0 && (
          <div className="space-y-2">
            {filteredItems.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors"
              >
                <Badge variant={row.type === 'kb' ? 'default' : 'secondary'} className="text-xs shrink-0">
                  {row.type.toUpperCase()}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{row.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{row.slug}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'add' ? 'Add Article' : 'Edit Article'}</DialogTitle>
            <DialogDescription>
              {form.type === 'kb'
                ? 'Knowledge base articles appear as cards on the support page.'
                : 'FAQ items appear in an accordion on the support page.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as 'kb' | 'faq' }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kb">KB (Knowledge Base)</SelectItem>
                  <SelectItem value="faq">FAQ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="How to add a visit"
              />
            </div>

            <div className="space-y-2">
              <Label>Slug (URL-friendly)</Label>
              <Input
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="how-to-add-a-visit"
              />
            </div>

            <div className="space-y-2">
              <Label>Content</Label>
              <textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Article content…"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                rows={5}
              />
            </div>

            <div className="space-y-2">
              <Label>Keywords (comma-separated)</Label>
              <Input
                value={form.keywords}
                onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
                placeholder="add visit, trip, resort"
              />
            </div>

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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Article?"
        description={`This will permanently delete "${deleteTarget?.title}".`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
