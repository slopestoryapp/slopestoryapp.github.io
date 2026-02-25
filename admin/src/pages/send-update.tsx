import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { SUPABASE_URL, COHORTS } from '@/lib/constants'
import { formatDateTime, timeAgo, truncate, cn } from '@/lib/utils'
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { type ColumnDef } from '@tanstack/react-table'
import { Loader2, Send, Mail } from 'lucide-react'

interface BroadcastEntry {
  id: string
  subject: string
  body_text: string
  cohort_filter: string | null
  sent_by: string
  recipient_count: number
  sent_at: string
}

export function SendUpdatePage() {
  const { log } = useAuditLog()

  // Compose form
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [cohort, setCohort] = useState<string>('all')

  // Preview count
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Send
  const [sending, setSending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Broadcast history
  const [broadcasts, setBroadcasts] = useState<BroadcastEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadBroadcasts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('broadcast_log')
        .select('*')
        .order('sent_at', { ascending: false })
      if (error) throw error
      setBroadcasts((data as BroadcastEntry[]) ?? [])
    } catch {
      toast.error('Failed to load broadcast history')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadBroadcasts()
  }, [loadBroadcasts])

  // Fetch preview count when cohort changes
  useEffect(() => {
    async function fetchPreview() {
      setPreviewLoading(true)
      try {
        let query = supabase
          .from('tester_emails')
          .select('*', { count: 'exact', head: true })
          .eq('opted_in', true)
        if (cohort !== 'all') {
          query = query.eq('cohort', cohort)
        }
        const { count } = await query
        setPreviewCount(count ?? 0)
      } catch {
        setPreviewCount(null)
      } finally {
        setPreviewLoading(false)
      }
    }
    fetchPreview()
  }, [cohort])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadBroadcasts()
  }, [loadBroadcasts])

  const handleSend = useCallback(async () => {
    setConfirmOpen(false)
    setSending(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        toast.error('Not authenticated')
        return
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-broadcast-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          subject: subject.trim(),
          body_text: bodyText.trim(),
          ...(cohort !== 'all' ? { cohort } : {}),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 429) {
          toast.error('Rate limit exceeded. Please try again later.')
        } else {
          toast.error(data.error ?? 'Failed to send broadcast')
        }
        return
      }

      await log({
        action: 'send_broadcast',
        entity_type: 'broadcast_log',
        entity_id: undefined,
        details: {
          subject: subject.trim(),
          cohort: cohort === 'all' ? 'all' : cohort,
          recipient_count: data.sent,
        },
      })

      toast.success(`Broadcast sent to ${data.sent} tester(s)`)
      setSubject('')
      setBodyText('')
      setCohort('all')
      loadBroadcasts()
    } catch {
      toast.error('Failed to send broadcast')
    } finally {
      setSending(false)
    }
  }, [subject, bodyText, cohort, log, loadBroadcasts])

  const canSend = subject.trim().length > 0 && bodyText.trim().length > 0 && (previewCount ?? 0) > 0

  const historyColumns: ColumnDef<BroadcastEntry, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'subject',
        header: 'Subject',
        cell: ({ row }) => (
          <span className="font-medium">{truncate(row.original.subject, 50)}</span>
        ),
      },
      {
        accessorKey: 'cohort_filter',
        header: 'Cohort',
        cell: ({ row }) => {
          const c = row.original.cohort_filter
          if (!c) return <Badge variant="secondary">All</Badge>
          const config = COHORTS.find((co) => co.value === c)
          return (
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-md font-medium',
                config?.color ?? 'text-muted-foreground',
              )}
            >
              {config?.label ?? c}
            </span>
          )
        },
      },
      {
        accessorKey: 'recipient_count',
        header: 'Sent To',
        cell: ({ row }) => row.original.recipient_count,
      },
      {
        accessorKey: 'sent_by',
        header: 'Sent By',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.sent_by}</span>
        ),
      },
      {
        accessorKey: 'sent_at',
        header: 'Sent At',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(row.original.sent_at)}
          </span>
        ),
      },
    ],
    [],
  )

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Send Update"
        subtitle="Compose and send broadcast emails to testers"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatsCard label="Total Broadcasts" value={broadcasts.length} />
          <StatsCard
            label="Last Sent"
            value={broadcasts[0] ? timeAgo(broadcasts[0].sent_at) : 'Never'}
          />
          <StatsCard
            label="Recipients (cohort)"
            value={previewLoading ? '...' : previewCount ?? '—'}
          />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Compose Form */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">Compose Email</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What's new in this update?"
                />
              </div>
              <div className="space-y-2">
                <Label>Body</Label>
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="Write your update here... (plain text, double newline for paragraphs)"
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[200px] resize-y"
                />
              </div>
              <div className="space-y-2">
                <Label>Target Cohort</Label>
                <Select value={cohort} onValueChange={setCohort}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Testers</SelectItem>
                    {COHORTS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="w-4 h-4" />
                Will send to{' '}
                <span className="font-semibold text-foreground">
                  {previewLoading ? '...' : previewCount ?? '?'}
                </span>{' '}
                opted-in tester(s)
              </div>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={!canSend || sending}
                className="w-full"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Send Update
              </Button>
            </div>
          </div>

          {/* Right: Broadcast History */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Broadcast History</h2>
              <ExportButton
                data={broadcasts as unknown as Record<string, unknown>[]}
                filename="broadcasts"
              />
            </div>
            <div className="p-4">
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <DataTable columns={historyColumns} data={broadcasts} pageSize={10} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Send Confirmation */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Send Broadcast Email"
        description={`This will send "${subject}" to ${previewCount ?? 0} opted-in tester(s)${cohort !== 'all' ? ` in ${COHORTS.find((c) => c.value === cohort)?.label}` : ''}. This cannot be undone.`}
        confirmLabel="Send Now"
        onConfirm={handleSend}
      />
    </div>
  )
}
