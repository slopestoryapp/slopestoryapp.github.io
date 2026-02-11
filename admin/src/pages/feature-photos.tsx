import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, X, CheckSquare, Loader2 } from 'lucide-react'

interface PhotoSubmission {
  id: string
  resort_id: string
  user_id: string
  photo_url: string
  caption: string | null
  status: string
  created_at: string
  resorts: { name: string } | null
}

export function FeaturePhotosPage() {
  const { log } = useAuditLog()

  const [photos, setPhotos] = useState<PhotoSubmission[]>([])
  const [selected, setSelected] = useState<PhotoSubmission | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Stats
  const [pendingCount, setPendingCount] = useState(0)
  const [approvedMonthCount, setApprovedMonthCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null)

  const loadPhotos = useCallback(async () => {
    try {
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)

      const [photosRes, pendingRes, approvedMonthRes, totalRes] =
        await Promise.all([
          supabase
            .from('resort_feature_photo_submissions')
            .select('*, resorts(name)')
            .eq('status', 'pending')
            .order('created_at', { ascending: false }),
          supabase
            .from('resort_feature_photo_submissions')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending'),
          supabase
            .from('resort_feature_photo_submissions')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'approved')
            .gte('created_at', startOfMonth.toISOString()),
          supabase
            .from('resort_feature_photo_submissions')
            .select('*', { count: 'exact', head: true }),
        ])

      setPhotos((photosRes.data as PhotoSubmission[]) ?? [])
      setPendingCount(pendingRes.count ?? 0)
      setApprovedMonthCount(approvedMonthRes.count ?? 0)
      setTotalCount(totalRes.count ?? 0)
    } catch {
      toast.error('Failed to load photos')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadPhotos()
  }, [loadPhotos])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadPhotos()
  }, [loadPhotos])

  const handleAction = useCallback(
    async (action: 'approved' | 'rejected') => {
      if (!selected) return
      setActionLoading(true)

      const { error } = await supabase
        .from('resort_feature_photo_submissions')
        .update({ status: action })
        .eq('id', selected.id)

      if (error) {
        toast.error(`Failed to ${action === 'approved' ? 'approve' : 'reject'} photo`)
        setActionLoading(false)
        return
      }

      await log({
        action: `${action === 'approved' ? 'approve' : 'reject'}_feature_photo`,
        entity_type: 'feature_photo_submission',
        entity_id: selected.id,
        details: {
          resort_name: selected.resorts?.name,
          resort_id: selected.resort_id,
        },
      })

      toast.success(
        `Photo ${action === 'approved' ? 'approved' : 'rejected'}: ${selected.resorts?.name ?? 'Unknown'}`
      )
      setSelected(null)
      setConfirmAction(null)
      setActionLoading(false)
      loadPhotos()
    },
    [selected, log, loadPhotos]
  )

  const toggleSelectId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleBulkAction = useCallback(
    async (action: 'approved' | 'rejected') => {
      if (selectedIds.size === 0) return
      setBulkLoading(true)

      const ids = Array.from(selectedIds)
      const { error } = await supabase
        .from('resort_feature_photo_submissions')
        .update({ status: action })
        .in('id', ids)

      if (error) {
        toast.error(`Failed to bulk ${action === 'approved' ? 'approve' : 'reject'}`)
        setBulkLoading(false)
        return
      }

      await log({
        action: `bulk_${action === 'approved' ? 'approve' : 'reject'}_feature_photos`,
        entity_type: 'feature_photo_submission',
        details: { count: ids.length, ids },
      })

      toast.success(
        `${ids.length} photo(s) ${action === 'approved' ? 'approved' : 'rejected'}`
      )
      setSelectedIds(new Set())
      setBulkLoading(false)
      loadPhotos()
    },
    [selectedIds, log, loadPhotos]
  )

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Feature Photos"
        subtitle="Moderate user-submitted feature photos"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatsCard label="Pending" value={pendingCount} />
          <StatsCard label="Approved This Month" value={approvedMonthCount} />
          <StatsCard label="Total" value={totalCount} />
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-accent/50 border border-border rounded-lg px-4 py-2">
            <span className="text-sm font-medium">
              {selectedIds.size} selected
            </span>
            <Button
              size="sm"
              onClick={() => handleBulkAction('approved')}
              disabled={bulkLoading}
            >
              {bulkLoading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-1" />
              )}
              Bulk Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleBulkAction('rejected')}
              disabled={bulkLoading}
            >
              {bulkLoading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <X className="w-4 h-4 mr-1" />
              )}
              Bulk Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        )}

        {/* Main content: list + details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Pending Photos List */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">Pending Photos</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {pendingCount} photos awaiting review
              </p>
            </div>
            <ScrollArea className="max-h-[500px]">
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 rounded-lg" />
                  ))}
                </div>
              ) : photos.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No pending photos
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer',
                        selected?.id === photo.id && 'bg-accent'
                      )}
                      onClick={() => setSelected(photo)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(photo.id)}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleSelectId(photo.id)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-border"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {photo.resorts?.name ?? 'Unknown Resort'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(photo.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right: Photo Details */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">Photo Details</h2>
            </div>
            {selected ? (
              <div className="p-4 space-y-4">
                {/* Photo Preview */}
                <div className="rounded-lg overflow-hidden border border-border">
                  <img
                    src={selected.photo_url}
                    alt={selected.resorts?.name ?? 'Photo'}
                    className="w-full max-h-[300px] object-cover"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Resort</span>
                    <p className="font-medium">
                      {selected.resorts?.name ?? 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Caption</span>
                    <p className="font-medium">
                      {selected.caption ?? 'No caption'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">User ID</span>
                    <p className="font-medium font-mono text-xs">
                      {selected.user_id}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Submitted</span>
                    <p className="font-medium">
                      {formatDate(selected.created_at)}
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => setConfirmAction('approve')}
                    className="flex-1"
                    disabled={actionLoading}
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmAction('reject')}
                    className="flex-1"
                    disabled={actionLoading}
                  >
                    <X className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Select a photo to view details
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={confirmAction === 'approve'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Approve Photo"
        description={`Approve this photo for ${selected?.resorts?.name ?? 'the resort'}?`}
        confirmLabel="Approve"
        onConfirm={() => handleAction('approved')}
      />
      <ConfirmDialog
        open={confirmAction === 'reject'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Reject Photo"
        description={`Reject this photo for ${selected?.resorts?.name ?? 'the resort'}? This cannot be undone.`}
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={() => handleAction('rejected')}
      />
    </div>
  )
}
