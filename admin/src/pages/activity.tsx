import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { PAGE_SIZE } from '@/lib/constants'
import { formatDateTime, truncate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable } from '@/components/shared/data-table'
import { ExportButton } from '@/components/shared/export-button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { type ColumnDef } from '@tanstack/react-table'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLogEntry {
  id: string
  admin_email: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_TYPES = [
  { value: 'all', label: 'All Actions' },
  { value: 'approve_submission', label: 'Approve Submission' },
  { value: 'reject_submission', label: 'Reject Submission' },
  { value: 'approve_photo', label: 'Approve Photo' },
  { value: 'reject_photo', label: 'Reject Photo' },
  { value: 'delete_user', label: 'Delete User' },
  { value: 'edit_resort', label: 'Edit Resort' },
  { value: 'delete_resort', label: 'Delete Resort' },
  { value: 'edit_profile', label: 'Edit Profile' },
  { value: 'update_ticket_status', label: 'Update Ticket Status' },
  { value: 'create_resort', label: 'Create Resort' },
  { value: 'add_support_note', label: 'Add Support Note' },
]

const ENTITY_TYPES = [
  { value: 'all', label: 'All Entities' },
  { value: 'resort_submission', label: 'Resort Submission' },
  { value: 'feature_photo', label: 'Feature Photo' },
  { value: 'support_request', label: 'Support Request' },
  { value: 'resort', label: 'Resort' },
  { value: 'profile', label: 'Profile' },
  { value: 'user_visit', label: 'User Visit' },
]

type DateRange = 'today' | 'week' | 'month' | 'all'

function getDateRangeStart(range: DateRange): string | null {
  const now = new Date()
  switch (range) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return start.toISOString()
    }
    case 'week': {
      const start = new Date(now)
      start.setDate(start.getDate() - 7)
      return start.toISOString()
    }
    case 'month': {
      const start = new Date(now)
      start.setMonth(start.getMonth() - 1)
      return start.toISOString()
    }
    case 'all':
      return null
  }
}

// ---------------------------------------------------------------------------
// Action badge color
// ---------------------------------------------------------------------------

function actionBadgeColor(action: string): string {
  if (action.startsWith('approve')) return 'text-green-400 bg-green-400/10'
  if (action.startsWith('reject')) return 'text-red-400 bg-red-400/10'
  if (action.startsWith('delete')) return 'text-red-400 bg-red-400/10'
  if (action.startsWith('edit') || action.startsWith('update')) return 'text-blue-400 bg-blue-400/10'
  if (action.startsWith('create') || action.startsWith('add')) return 'text-purple-400 bg-purple-400/10'
  return 'text-slate-400 bg-slate-400/10'
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function ActivityPage() {
  // Data
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tableError, setTableError] = useState(false)

  // Filters
  const [actionFilter, setActionFilter] = useState('all')
  const [entityFilter, setEntityFilter] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>('all')

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  const fetchLogs = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true)
      else setLoading(true)
      setTableError(false)

      try {
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1

        // Build query
        let countQuery = supabase
          .from('admin_audit_log')
          .select('*', { count: 'exact', head: true })

        let dataQuery = supabase
          .from('admin_audit_log')
          .select('id, admin_email, action, entity_type, entity_id, details, created_at')
          .order('created_at', { ascending: false })
          .range(from, to)

        // Apply filters
        if (actionFilter !== 'all') {
          countQuery = countQuery.eq('action', actionFilter)
          dataQuery = dataQuery.eq('action', actionFilter)
        }
        if (entityFilter !== 'all') {
          countQuery = countQuery.eq('entity_type', entityFilter)
          dataQuery = dataQuery.eq('entity_type', entityFilter)
        }

        const dateStart = getDateRangeStart(dateRange)
        if (dateStart) {
          countQuery = countQuery.gte('created_at', dateStart)
          dataQuery = dataQuery.gte('created_at', dateStart)
        }

        const { count, error: countError } = await countQuery
        if (countError) throw countError

        const { data, error } = await dataQuery
        if (error) throw error

        setTotalCount(count ?? 0)
        setEntries((data as AuditLogEntry[]) ?? [])
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('Audit log fetch error:', message)

        // Check if table doesn't exist
        if (
          message.includes('does not exist') ||
          message.includes('relation') ||
          message.includes('42P01')
        ) {
          setTableError(true)
        } else {
          toast.error('Failed to load audit log')
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, actionFilter, entityFilter, dateRange]
  )

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // Reset page when filters change
  useEffect(() => {
    setPage(0)
  }, [actionFilter, entityFilter, dateRange])

  // -----------------------------------------------------------------------
  // Columns
  // -----------------------------------------------------------------------

  const columns: ColumnDef<AuditLogEntry, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Timestamp',
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap">{formatDateTime(row.original.created_at)}</span>
        ),
      },
      {
        accessorKey: 'admin_email',
        header: 'Admin',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.admin_email ?? 'Unknown'}</span>
        ),
      },
      {
        accessorKey: 'action',
        header: 'Action',
        cell: ({ row }) => (
          <Badge variant="outline" className={actionBadgeColor(row.original.action)}>
            {row.original.action.replace(/_/g, ' ')}
          </Badge>
        ),
      },
      {
        accessorKey: 'entity_type',
        header: 'Entity Type',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.entity_type?.replace(/_/g, ' ') ?? '--'}</span>
        ),
      },
      {
        accessorKey: 'entity_id',
        header: 'Entity ID',
        cell: ({ row }) => (
          <span className="text-xs font-mono text-muted-foreground">
            {row.original.entity_id ? truncate(row.original.entity_id, 12) : '--'}
          </span>
        ),
      },
      {
        accessorKey: 'details',
        header: 'Details',
        enableSorting: false,
        cell: ({ row }) => {
          const d = row.original.details
          if (!d) return <span className="text-xs text-muted-foreground">--</span>
          const preview = JSON.stringify(d).slice(0, 60)
          return (
            <span className="text-xs text-muted-foreground font-mono">
              {preview}{preview.length >= 60 ? '...' : ''}
            </span>
          )
        },
      },
      {
        id: 'expand',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          const isExpanded = expandedId === row.original.id
          return (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setExpandedId(isExpanded ? null : row.original.id)
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )
        },
      },
    ],
    [expandedId]
  )

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  const exportData = useMemo(
    () =>
      entries.map((e) => ({
        timestamp: e.created_at,
        admin: e.admin_email ?? '',
        action: e.action,
        entity_type: e.entity_type ?? '',
        entity_id: e.entity_id ?? '',
        details: e.details ? JSON.stringify(e.details) : '',
      })),
    [entries]
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // Table not created yet
  if (tableError) {
    return (
      <div className="flex flex-col h-full">
        <Header
          title="Activity Log"
          subtitle="Admin audit trail"
          onRefresh={() => fetchLogs(true)}
          refreshing={refreshing}
        />
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md w-full">
            <CardContent className="p-8 text-center space-y-4">
              <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto" />
              <h2 className="text-lg font-semibold">Audit Log Table Not Found</h2>
              <p className="text-sm text-muted-foreground">
                The <code className="text-xs bg-muted px-1.5 py-0.5 rounded">admin_audit_log</code> table
                has not been created yet. Run the database migration to enable audit logging.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Activity Log"
        subtitle={`${totalCount} audit entries`}
        onRefresh={() => fetchLogs(true)}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Action type" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Entity type" />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            {(['today', 'week', 'month', 'all'] as DateRange[]).map((range) => (
              <Button
                key={range}
                variant={dateRange === range ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDateRange(range)}
                className="text-xs"
              >
                {range === 'today'
                  ? 'Today'
                  : range === 'week'
                    ? 'This Week'
                    : range === 'month'
                      ? 'This Month'
                      : 'All Time'}
              </Button>
            ))}
          </div>

          <div className="sm:ml-auto">
            <ExportButton data={exportData as Record<string, unknown>[]} filename="audit-log" />
          </div>
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
          <>
            <DataTable
              columns={columns}
              data={entries}
              onRowClick={(row) =>
                setExpandedId(expandedId === row.id ? null : row.id)
              }
              serverPagination={{
                totalCount,
                page,
                onPageChange: setPage,
              }}
            />

            {/* Expanded detail panel */}
            {expandedId && (
              <Card className="border-primary/30">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Full Details</h3>
                  <pre className="text-xs font-mono bg-muted/50 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap">
                    {JSON.stringify(
                      entries.find((e) => e.id === expandedId)?.details ?? {},
                      null,
                      2
                    )}
                  </pre>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
