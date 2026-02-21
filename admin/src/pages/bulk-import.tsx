import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { SUPABASE_URL, PAGE_SIZE } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DataTable } from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileJson,
  X,
  Eye,
  ShieldCheck,
  ImageIcon,
  Trash2,
  Database,
  CircleDot,
  SkipForward,
  RefreshCw,
  XCircle,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportResortRow {
  name: string
  country: string
  country_code: string
  region?: string
  lat: number
  lng: number
  website?: string
  vertical_m?: number
  runs?: number
  lifts?: number
  annual_snowfall_cm?: number
  beginner_pct?: number
  intermediate_pct?: number
  advanced_pct?: number
  season_open?: string
  season_close?: string
  has_night_skiing?: boolean
  pass_affiliation?: string
  instagram_handle?: string
  description?: string
}

interface RowIssue {
  field: string
  message: string
}

interface WorkbenchRow {
  index: number
  data: ImportResortRow
  originalData: ImportResortRow
  status: 'error' | 'warning' | 'ready' | 'skipped'
  errors: RowIssue[]
  warnings: RowIssue[]
  checked: boolean
  matchType: 'new' | 'exact' | 'similar' | null
  matchedResortId: string | null
  matchedResortName: string | null
  matchSimilarity: number | null
  matchedData: Record<string, unknown> | null
  action: 'import' | 'merge' | 'skip' | null
  completeness: { filled: number; total: number }
  isDirty: boolean
}

interface UnverifiedResort {
  id: string
  name: string
  country: string
  country_code: string
  region: string | null
  lat: number
  lng: number
  website: string | null
  vertical_m: number | null
  runs: number | null
  lifts: number | null
  verified: boolean
  verification_notes: string | null
  pass_affiliation: string | null
  annual_snowfall_cm: number | null
  beginner_pct: number | null
  intermediate_pct: number | null
  advanced_pct: number | null
  season_open: string | null
  season_close: string | null
  has_night_skiing: boolean | null
  description: string | null
  budget_tier: string | null
  instagram_handle: string | null
  cover_image_url: string | null
}

type TopTab = 'import' | 'verification' | 'placeholders'
type StatusFilter = 'all' | 'error' | 'warning' | 'ready' | 'skipped'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPLETENESS_FIELDS: (keyof ImportResortRow)[] = [
  'country_code', 'region', 'vertical_m', 'runs', 'lifts',
  'annual_snowfall_cm', 'beginner_pct', 'intermediate_pct', 'advanced_pct',
  'season_open', 'season_close', 'has_night_skiing', 'description',
]

// For verification queue — same fields but checked on UnverifiedResort
const VERIFY_COMPLETENESS_FIELDS: (keyof UnverifiedResort)[] = [
  'country_code', 'region', 'vertical_m', 'runs', 'lifts',
  'annual_snowfall_cm', 'beginner_pct', 'intermediate_pct', 'advanced_pct',
  'season_open', 'season_close', 'has_night_skiing', 'description', 'budget_tier',
]

const BATCH_SIZE = 500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"(.*)"$/, '$1'))
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const fields: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of lines[i]) {
      if (char === '"') { inQuotes = !inQuotes; continue }
      if (char === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue }
      current += char
    }
    fields.push(current.trim())
    if (fields.length !== headers.length) continue
    const row: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      const val = fields[idx]
      if (val === '' || val === 'null' || val === 'undefined') { row[h] = null; return }
      if (val === 'true') { row[h] = true; return }
      if (val === 'false') { row[h] = false; return }
      const num = Number(val)
      if (!isNaN(num) && val !== '') { row[h] = num; return }
      row[h] = val
    })
    rows.push(row)
  }
  return rows
}

function normalizeRow(raw: Record<string, unknown>): ImportResortRow {
  return {
    name: String(raw.name ?? '').trim(),
    country: String(raw.country ?? '').trim(),
    country_code: String(raw.country_code ?? '').trim().toUpperCase(),
    region: raw.region ? String(raw.region).trim() : undefined,
    lat: Number(raw.lat ?? raw.latitude ?? 0),
    lng: Number(raw.lng ?? raw.longitude ?? 0),
    website: raw.website ? String(raw.website).trim() : undefined,
    vertical_m: raw.vertical_m != null ? Number(raw.vertical_m) : (raw.vertical_drop_m != null ? Number(raw.vertical_drop_m) : undefined),
    runs: raw.runs != null ? Number(raw.runs) : (raw.number_of_runs != null ? Number(raw.number_of_runs) : undefined),
    lifts: raw.lifts != null ? Number(raw.lifts) : (raw.number_of_lifts != null ? Number(raw.number_of_lifts) : undefined),
    annual_snowfall_cm: raw.annual_snowfall_cm != null ? Number(raw.annual_snowfall_cm) : undefined,
    beginner_pct: raw.beginner_pct != null ? Number(raw.beginner_pct) : undefined,
    intermediate_pct: raw.intermediate_pct != null ? Number(raw.intermediate_pct) : undefined,
    advanced_pct: raw.advanced_pct != null ? Number(raw.advanced_pct) : undefined,
    season_open: raw.season_open ? String(raw.season_open).trim() : undefined,
    season_close: raw.season_close ? String(raw.season_close).trim() : undefined,
    has_night_skiing: raw.has_night_skiing != null ? Boolean(raw.has_night_skiing) : undefined,
    pass_affiliation: raw.pass_affiliation ? String(raw.pass_affiliation).trim() : undefined,
    instagram_handle: raw.instagram_handle ? String(raw.instagram_handle).trim() : undefined,
    description: raw.description ? String(raw.description).trim() : undefined,
  }
}

function computeCompleteness(data: ImportResortRow): { filled: number; total: number } {
  const total = COMPLETENESS_FIELDS.length
  let filled = 0
  for (const field of COMPLETENESS_FIELDS) {
    const val = data[field]
    if (val !== null && val !== undefined && val !== '') filled++
  }
  return { filled, total }
}

function validateAndScore(data: ImportResortRow): { errors: RowIssue[]; warnings: RowIssue[] } {
  const errors: RowIssue[] = []
  const warnings: RowIssue[] = []

  if (!data.name?.trim()) errors.push({ field: 'name', message: 'Name is required' })
  if (!data.country?.trim()) errors.push({ field: 'country', message: 'Country is required' })
  if (!data.country_code?.trim()) errors.push({ field: 'country_code', message: 'Country code is required' })
  else if (data.country_code.length !== 2) errors.push({ field: 'country_code', message: 'Country code must be 2 characters' })
  if (typeof data.lat !== 'number' || isNaN(data.lat) || data.lat < -90 || data.lat > 90)
    errors.push({ field: 'lat', message: 'Latitude must be between -90 and 90' })
  if (typeof data.lng !== 'number' || isNaN(data.lng) || data.lng < -180 || data.lng > 180)
    errors.push({ field: 'lng', message: 'Longitude must be between -180 and 180' })

  // Terrain percentage check
  const b = data.beginner_pct ?? 0
  const i = data.intermediate_pct ?? 0
  const a = data.advanced_pct ?? 0
  if ((b > 0 || i > 0 || a > 0) && Math.abs(b + i + a - 100) > 5) {
    warnings.push({ field: 'terrain_pct', message: `Terrain percentages sum to ${b + i + a}% (expected ~100%)` })
  }

  return { errors, warnings }
}

function computeRowStatus(row: WorkbenchRow): WorkbenchRow['status'] {
  if (row.action === 'skip') return 'skipped'
  if (row.errors.length > 0) return 'error'
  if (row.checked && (row.matchType === 'exact' || row.matchType === 'similar') && !row.action) return 'warning'
  if (row.isDirty && row.checked) return 'warning' // edited after DB check, needs re-check
  return 'ready'
}

function getVerifyCompleteness(resort: UnverifiedResort): { filled: number; total: number; label: string; color: string } {
  const total = VERIFY_COMPLETENESS_FIELDS.length
  let filled = 0
  for (const field of VERIFY_COMPLETENESS_FIELDS) {
    const val = resort[field]
    if (val !== null && val !== undefined && val !== '') filled++
  }
  let label: string
  let color: string
  if (filled === total) {
    label = 'Ready'
    color = 'text-green-400'
  } else if (filled >= 10) {
    label = 'Almost'
    color = 'text-yellow-400'
  } else {
    label = 'Needs Work'
    color = 'text-red-400'
  }
  return { filled, total, label, color }
}

function statusIcon(status: WorkbenchRow['status']) {
  switch (status) {
    case 'error': return <XCircle className="w-4 h-4 text-red-400" />
    case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-400" />
    case 'ready': return <CheckCircle2 className="w-4 h-4 text-green-400" />
    case 'skipped': return <SkipForward className="w-4 h-4 text-slate-400" />
  }
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BulkImportPage() {
  const { log } = useAuditLog()

  // Top-level tab
  const [topTab, setTopTab] = useState<TopTab>('import')

  // =========================================================================
  // IMPORT WORKBENCH STATE
  // =========================================================================
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [workbenchRows, setWorkbenchRows] = useState<WorkbenchRow[]>([])
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dbCheckLoading, setDbCheckLoading] = useState(false)
  const [dbCheckProgress, setDbCheckProgress] = useState({ batch: 0, total: 0 })
  const [pushLoading, setPushLoading] = useState(false)
  const [pushProgress, setPushProgress] = useState({ batch: 0, total: 0 })
  const [pushResults, setPushResults] = useState<{ inserted: number; updated: number; placeholders: number } | null>(null)
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)

  // -- Placeholder discovery (shared between Import + Placeholders tabs) --
  const [discoveredPlaceholders, setDiscoveredPlaceholders] = useState<string[]>([])
  const [placeholdersFetching, setPlaceholdersFetching] = useState(false)

  // -- Verification Tab State --
  const [unverifiedResorts, setUnverifiedResorts] = useState<UnverifiedResort[]>([])
  const [unverifiedLoading, setUnverifiedLoading] = useState(false)
  const [unverifiedPage, setUnverifiedPage] = useState(0)
  const [unverifiedTotal, setUnverifiedTotal] = useState(0)
  const [verifiedTotal, setVerifiedTotal] = useState(0)
  const [selectedVerifyIds, setSelectedVerifyIds] = useState<Set<string>>(new Set())
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false)
  const [verifyDialogResort, setVerifyDialogResort] = useState<UnverifiedResort | null>(null)
  const [verifyNotes, setVerifyNotes] = useState('')
  const [verifySaving, setVerifySaving] = useState(false)
  const [verifyDirty, setVerifyDirty] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteBlockedDialogOpen, setDeleteBlockedDialogOpen] = useState(false)
  const [deleteBlockedResorts, setDeleteBlockedResorts] = useState<{ id: string; name: string; reason: string }[]>([])
  const [deleteResult, setDeleteResult] = useState<{ deleted: number } | null>(null)

  // -- Placeholders Tab State --
  const [noCoverCount, setNoCoverCount] = useState(0)
  const [hasCoverCount, setHasCoverCount] = useState(0)
  const [assigningPlaceholders, setAssigningPlaceholders] = useState(false)
  const [placeholdersLoading, setPlaceholdersLoading] = useState(false)

  // =========================================================================
  // SHARED: Placeholder discovery from R2
  // =========================================================================

  const fetchPlaceholderUrls = useCallback(async (force = false) => {
    if (discoveredPlaceholders.length > 0 && !force) return
    setPlaceholdersFetching(true)
    try {
      const res = await callEdgeFunction('admin-bulk-import-resorts', {
        action: 'list_placeholders',
      })
      setDiscoveredPlaceholders(res.urls ?? [])
    } catch (err) {
      console.error('Failed to fetch placeholders:', err)
      toast.error('Failed to load placeholder images from R2')
    } finally {
      setPlaceholdersFetching(false)
    }
  }, [discoveredPlaceholders.length])

  // =========================================================================
  // IMPORT WORKBENCH
  // =========================================================================

  const buildWorkbenchRow = useCallback((data: ImportResortRow, index: number): WorkbenchRow => {
    const { errors, warnings } = validateAndScore(data)
    const completeness = computeCompleteness(data)
    const row: WorkbenchRow = {
      index,
      data: { ...data },
      originalData: { ...data },
      status: 'ready',
      errors,
      warnings,
      checked: false,
      matchType: null,
      matchedResortId: null,
      matchedResortName: null,
      matchSimilarity: null,
      matchedData: null,
      action: null,
      completeness,
      isDirty: false,
    }
    row.status = computeRowStatus(row)
    return row
  }, [])

  // -- File handling --
  const handleFile = useCallback((file: File) => {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        let rawRows: Record<string, unknown>[]
        if (file.name.endsWith('.csv')) {
          rawRows = parseCSV(text)
        } else {
          const parsed = JSON.parse(text)
          rawRows = Array.isArray(parsed) ? parsed : (parsed.resorts ?? parsed.data ?? [])
        }

        const errors: string[] = []
        const rows: WorkbenchRow[] = []
        for (let i = 0; i < rawRows.length; i++) {
          const normalized = normalizeRow(rawRows[i])
          // Basic parse-level check
          const name = rawRows[i].name
          if (!name || (typeof name === 'string' && !name.trim())) {
            errors.push(`Row ${i + 1}: missing name`)
            continue
          }
          rows.push(buildWorkbenchRow(normalized, rows.length))
        }

        setWorkbenchRows(rows)
        setParseErrors(errors)
        setSelectedRowIndex(null)
        setPushResults(null)
        if (rows.length > 0) toast.success(`Parsed ${rows.length} resorts`)
        else toast.error('No valid resort rows found')
      } catch {
        toast.error('Failed to parse file')
        setWorkbenchRows([])
        setParseErrors(['Failed to parse file. Ensure it is valid JSON or CSV.'])
      }
    }
    reader.readAsText(file)
  }, [buildWorkbenchRow])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const clearWorkbench = useCallback(() => {
    setFileName('')
    setWorkbenchRows([])
    setParseErrors([])
    setSelectedRowIndex(null)
    setPushResults(null)
    setStatusFilter('all')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // -- Update a row's data field --
  const updateRowField = useCallback((index: number, field: keyof ImportResortRow, value: unknown) => {
    setWorkbenchRows(prev => {
      const next = [...prev]
      const row = { ...next[index] }
      row.data = { ...row.data, [field]: value }
      row.isDirty = true
      const { errors, warnings } = validateAndScore(row.data)
      row.errors = errors
      row.warnings = warnings
      row.completeness = computeCompleteness(row.data)
      row.status = computeRowStatus(row)
      next[index] = row
      return next
    })
  }, [])

  // -- Set row action --
  const setRowAction = useCallback((index: number, action: WorkbenchRow['action']) => {
    setWorkbenchRows(prev => {
      const next = [...prev]
      const row = { ...next[index], action }
      row.status = computeRowStatus(row)
      next[index] = row
      return next
    })
  }, [])

  // -- Check Against DB --
  const checkAgainstDB = useCallback(async () => {
    if (workbenchRows.length === 0) return
    setDbCheckLoading(true)

    try {
      const batches: WorkbenchRow[][] = []
      for (let i = 0; i < workbenchRows.length; i += BATCH_SIZE) {
        batches.push(workbenchRows.slice(i, i + BATCH_SIZE))
      }
      setDbCheckProgress({ batch: 0, total: batches.length })

      const updatedRows = [...workbenchRows]

      for (let b = 0; b < batches.length; b++) {
        setDbCheckProgress({ batch: b + 1, total: batches.length })
        const batch = batches[b]
        const resorts = batch.map(r => ({
          name: r.data.name,
          country: r.data.country,
        }))

        const res = await callEdgeFunction('admin-bulk-import-resorts', {
          action: 'preview',
          resorts,
        })

        const allResults = [
          ...(res.results?.new ?? []),
          ...(res.results?.exact_matches ?? []),
          ...(res.results?.similar_matches ?? []),
        ]

        const offset = b * BATCH_SIZE
        for (const result of allResults) {
          const rowIndex = result.input_index + offset
          if (rowIndex >= updatedRows.length) continue
          const row = { ...updatedRows[rowIndex] }
          row.checked = true
          row.matchType = result.match_type
          row.matchedResortId = result.existing_resort_id ?? null
          row.matchedResortName = result.existing_name ?? null
          row.matchSimilarity = result.similarity_score ?? null
          row.matchedData = result.existing_data ?? null
          row.isDirty = false

          // Auto-set action for new matches
          if (result.match_type === 'new') {
            row.action = 'import'
          }

          row.status = computeRowStatus(row)
          updatedRows[rowIndex] = row
        }
      }

      setWorkbenchRows(updatedRows)
      toast.success('DB check complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'DB check failed')
    } finally {
      setDbCheckLoading(false)
    }
  }, [workbenchRows])

  // -- Push to DB --
  const pushToDB = useCallback(async () => {
    setPushConfirmOpen(false)
    setPushLoading(true)
    setPushResults(null)

    try {
      const newResorts: ImportResortRow[] = []
      const updates: { resort_id: string; fields: Partial<ImportResortRow> }[] = []

      for (const row of workbenchRows) {
        if (row.status === 'error' || row.status === 'skipped') continue
        if (row.action === 'skip') continue

        if (row.action === 'merge' && row.matchedResortId) {
          updates.push({ resort_id: row.matchedResortId, fields: row.data })
        } else if (row.action === 'import' || row.matchType === 'new' || !row.matchType) {
          newResorts.push(row.data)
        }
      }

      if (newResorts.length === 0 && updates.length === 0) {
        toast.error('No resorts to import')
        setPushLoading(false)
        return
      }

      // Fetch placeholders from R2
      let placeholderUrls: string[] | undefined
      if (newResorts.length > 0) {
        if (discoveredPlaceholders.length === 0) {
          await fetchPlaceholderUrls(true)
        }
        if (discoveredPlaceholders.length > 0) {
          placeholderUrls = discoveredPlaceholders
        }
      }

      const newBatches: ImportResortRow[][] = []
      for (let i = 0; i < newResorts.length; i += BATCH_SIZE) {
        newBatches.push(newResorts.slice(i, i + BATCH_SIZE))
      }

      const totalBatches = Math.max(newBatches.length, 1)
      setPushProgress({ batch: 0, total: totalBatches })

      let totalInserted = 0
      let totalUpdated = 0
      let totalPlaceholders = 0

      if (newBatches.length === 0 && updates.length > 0) {
        setPushProgress({ batch: 1, total: 1 })
        const res = await callEdgeFunction('admin-bulk-import-resorts', {
          action: 'import',
          new_resorts: [],
          updates,
        })
        totalUpdated = res.updated ?? 0
      } else {
        for (let i = 0; i < newBatches.length; i++) {
          setPushProgress({ batch: i + 1, total: totalBatches })
          const payload: Record<string, unknown> = {
            action: 'import',
            new_resorts: newBatches[i],
          }
          if (i === 0) {
            if (updates.length > 0) payload.updates = updates
            if (placeholderUrls?.length) payload.placeholder_urls = placeholderUrls
          }
          const res = await callEdgeFunction('admin-bulk-import-resorts', payload)
          totalInserted += res.inserted ?? 0
          totalUpdated += res.updated ?? 0
          totalPlaceholders += res.placeholders_assigned ?? 0
        }
      }

      setPushResults({ inserted: totalInserted, updated: totalUpdated, placeholders: totalPlaceholders })
      toast.success(`Import complete! ${totalInserted} inserted, ${totalUpdated} updated`)

      await log({
        action: 'bulk_import_resorts',
        entity_type: 'resort',
        details: { inserted: totalInserted, updated: totalUpdated, placeholders_assigned: totalPlaceholders },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setPushLoading(false)
    }
  }, [workbenchRows, discoveredPlaceholders, fetchPlaceholderUrls, log])

  // -- Computed counts --
  const counts = useMemo(() => ({
    errors: workbenchRows.filter(r => r.status === 'error').length,
    warnings: workbenchRows.filter(r => r.status === 'warning').length,
    ready: workbenchRows.filter(r => r.status === 'ready').length,
    skipped: workbenchRows.filter(r => r.status === 'skipped').length,
    total: workbenchRows.length,
    checked: workbenchRows.filter(r => r.checked).length,
  }), [workbenchRows])

  const canPush = counts.errors === 0
    && counts.warnings === 0
    && counts.ready > 0
    && counts.total > 0
    && !pushLoading

  const filteredRows = useMemo(() => {
    if (statusFilter === 'all') return workbenchRows
    return workbenchRows.filter(r => r.status === statusFilter)
  }, [workbenchRows, statusFilter])

  const selectedRow = selectedRowIndex !== null ? workbenchRows[selectedRowIndex] : null

  // =========================================================================
  // VERIFICATION TAB
  // =========================================================================

  const loadUnverified = useCallback(async () => {
    setUnverifiedLoading(true)
    try {
      const from = unverifiedPage * PAGE_SIZE
      const [unverified, verified, total] = await Promise.all([
        supabase
          .from('resorts')
          .select('id, name, country, country_code, region, lat, lng, website, vertical_m, runs, lifts, verified, verification_notes, pass_affiliation, annual_snowfall_cm, beginner_pct, intermediate_pct, advanced_pct, season_open, season_close, has_night_skiing, description, budget_tier, instagram_handle, cover_image_url')
          .eq('verified', false)
          .order('name')
          .range(from, from + PAGE_SIZE - 1),
        supabase
          .from('resorts')
          .select('*', { count: 'exact', head: true })
          .eq('verified', true),
        supabase
          .from('resorts')
          .select('*', { count: 'exact', head: true }),
      ])
      setUnverifiedResorts((unverified.data ?? []) as UnverifiedResort[])
      setUnverifiedTotal((total.count ?? 0) - (verified.count ?? 0))
      setVerifiedTotal(verified.count ?? 0)
    } catch {
      toast.error('Failed to load resorts')
    } finally {
      setUnverifiedLoading(false)
    }
  }, [unverifiedPage])

  useEffect(() => {
    if (topTab === 'verification') loadUnverified()
  }, [topTab, unverifiedPage, loadUnverified])

  const handleBulkVerify = useCallback(async (verified: boolean) => {
    if (selectedVerifyIds.size === 0) return
    setVerifyLoading(true)
    try {
      const res = await callEdgeFunction('admin-bulk-import-resorts', {
        action: 'bulk_verify',
        resort_ids: Array.from(selectedVerifyIds),
        verified,
      })
      toast.success(`${verified ? 'Verified' : 'Flagged'} ${res.affected ?? selectedVerifyIds.size} resorts`)
      setSelectedVerifyIds(new Set())
      await loadUnverified()
      await log({
        action: verified ? 'bulk_verify_resorts' : 'bulk_flag_resorts',
        entity_type: 'resort',
        details: { count: res.affected ?? selectedVerifyIds.size },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to verify')
    } finally {
      setVerifyLoading(false)
    }
  }, [selectedVerifyIds, loadUnverified, log])

  const handleSingleVerify = useCallback(async (resortId: string, verified: boolean, notes: string) => {
    setVerifyLoading(true)
    try {
      await callEdgeFunction('admin-bulk-import-resorts', {
        action: 'verify',
        resort_id: resortId,
        verified,
        notes: notes || undefined,
      })
      toast.success(verified ? 'Resort verified' : 'Resort flagged')
      setVerifyDialogOpen(false)
      setVerifyDialogResort(null)
      setVerifyNotes('')
      await loadUnverified()
      await log({
        action: verified ? 'verify_resort' : 'flag_resort',
        entity_type: 'resort',
        entity_id: resortId,
        details: notes ? { notes } : undefined,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to verify')
    } finally {
      setVerifyLoading(false)
    }
  }, [loadUnverified, log])

  const updateVerifyField = useCallback(<K extends keyof UnverifiedResort>(field: K, value: UnverifiedResort[K]) => {
    setVerifyDialogResort(prev => prev ? { ...prev, [field]: value } : prev)
    setVerifyDirty(true)
  }, [])

  const handleSaveResortFields = useCallback(async (thenVerify?: { verified: boolean; notes: string }) => {
    if (!verifyDialogResort) return
    setVerifySaving(true)
    try {
      const { error } = await supabase
        .from('resorts')
        .update({
          name: verifyDialogResort.name,
          country: verifyDialogResort.country,
          country_code: verifyDialogResort.country_code,
          region: verifyDialogResort.region,
          lat: verifyDialogResort.lat,
          lng: verifyDialogResort.lng,
          website: verifyDialogResort.website,
          vertical_m: verifyDialogResort.vertical_m,
          runs: verifyDialogResort.runs,
          lifts: verifyDialogResort.lifts,
          annual_snowfall_cm: verifyDialogResort.annual_snowfall_cm,
          beginner_pct: verifyDialogResort.beginner_pct,
          intermediate_pct: verifyDialogResort.intermediate_pct,
          advanced_pct: verifyDialogResort.advanced_pct,
          season_open: verifyDialogResort.season_open,
          season_close: verifyDialogResort.season_close,
          has_night_skiing: verifyDialogResort.has_night_skiing,
          description: verifyDialogResort.description,
          budget_tier: verifyDialogResort.budget_tier,
          pass_affiliation: verifyDialogResort.pass_affiliation,
          instagram_handle: verifyDialogResort.instagram_handle,
        })
        .eq('id', verifyDialogResort.id)
      if (error) throw error
      setVerifyDirty(false)
      setUnverifiedResorts(prev => prev.map(r => r.id === verifyDialogResort.id ? { ...verifyDialogResort } : r))
      await log({
        action: 'update_resort_fields',
        entity_type: 'resort',
        entity_id: verifyDialogResort.id,
      })

      if (thenVerify) {
        setVerifySaving(false)
        await handleSingleVerify(verifyDialogResort.id, thenVerify.verified, thenVerify.notes)
        return
      }
      toast.success('Resort fields saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setVerifySaving(false)
    }
  }, [verifyDialogResort, handleSingleVerify, log])

  const handleBulkDelete = useCallback(async () => {
    if (selectedVerifyIds.size === 0) return
    setDeleteLoading(true)
    setDeleteDialogOpen(false)
    try {
      const res = await callEdgeFunction('admin-bulk-import-resorts', {
        action: 'bulk_delete',
        resort_ids: Array.from(selectedVerifyIds),
      })

      const blocked = res.blocked ?? []
      const deleted = res.deleted ?? 0

      if (blocked.length > 0) {
        setDeleteBlockedResorts(blocked)
        setDeleteResult(deleted > 0 ? { deleted } : null)
        setDeleteBlockedDialogOpen(true)
      }

      if (deleted > 0) {
        toast.success(`Deleted ${deleted} resort${deleted === 1 ? '' : 's'}`)
        await log({
          action: 'bulk_delete_resorts',
          entity_type: 'resort',
          details: { deleted, blocked_count: blocked.length },
        })
      } else if (blocked.length === 0) {
        toast.error('No resorts were deleted')
      }

      setSelectedVerifyIds(new Set())
      await loadUnverified()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete resorts')
    } finally {
      setDeleteLoading(false)
    }
  }, [selectedVerifyIds, loadUnverified, log])

  // =========================================================================
  // PLACEHOLDERS TAB
  // =========================================================================

  const loadPlaceholderCounts = useCallback(async () => {
    setPlaceholdersLoading(true)
    try {
      const [noCover, total] = await Promise.all([
        supabase
          .from('resorts')
          .select('*', { count: 'exact', head: true })
          .or('cover_image_url.is.null,cover_image_url.eq.'),
        supabase
          .from('resorts')
          .select('*', { count: 'exact', head: true }),
      ])
      setNoCoverCount(noCover.count ?? 0)
      setHasCoverCount((total.count ?? 0) - (noCover.count ?? 0))
    } catch {
      toast.error('Failed to load counts')
    } finally {
      setPlaceholdersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (topTab === 'placeholders') {
      loadPlaceholderCounts()
      fetchPlaceholderUrls()
    }
  }, [topTab, loadPlaceholderCounts, fetchPlaceholderUrls])

  const handleAssignPlaceholders = useCallback(async () => {
    if (discoveredPlaceholders.length === 0) {
      toast.error('No placeholder images available')
      return
    }
    setAssigningPlaceholders(true)
    try {
      const res = await callEdgeFunction('admin-bulk-import-resorts', {
        action: 'assign_placeholders',
        placeholder_urls: discoveredPlaceholders,
      })
      toast.success(`Assigned ${res.assigned ?? 0} placeholder images`)
      await loadPlaceholderCounts()
      await log({
        action: 'assign_placeholders',
        entity_type: 'resort',
        details: { assigned: res.assigned ?? 0 },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign placeholders')
    } finally {
      setAssigningPlaceholders(false)
    }
  }, [discoveredPlaceholders, loadPlaceholderCounts, log])

  // =========================================================================
  // COLUMN DEFINITIONS
  // =========================================================================

  const workbenchColumns = useMemo<ColumnDef<WorkbenchRow>[]>(() => [
    {
      id: 'status',
      header: 'St',
      cell: ({ row }) => statusIcon(row.original.status),
      size: 40,
    },
    {
      id: 'name',
      header: 'Name',
      accessorFn: (row) => row.data.name,
      cell: ({ row }) => (
        <span className={cn(
          'font-medium text-sm',
          row.original.errors.some(e => e.field === 'name') && 'text-red-400'
        )}>
          {row.original.data.name || '(empty)'}
        </span>
      ),
    },
    {
      id: 'country',
      header: 'Country',
      accessorFn: (row) => row.data.country,
      cell: ({ row }) => row.original.data.country || '-',
    },
    {
      id: 'region',
      header: 'Region',
      accessorFn: (row) => row.data.region,
      cell: ({ row }) => row.original.data.region ?? '-',
    },
    {
      id: 'match',
      header: 'Match',
      cell: ({ row }) => {
        if (!row.original.checked) return <span className="text-xs text-muted-foreground">--</span>
        if (row.original.matchType === 'new') return <Badge className="bg-green-500/15 text-green-400 text-[10px]">New</Badge>
        if (row.original.matchType === 'exact') return <Badge className="bg-red-500/15 text-red-400 text-[10px]">Exact</Badge>
        if (row.original.matchType === 'similar') return (
          <Badge className="bg-yellow-500/15 text-yellow-400 text-[10px]">
            ~{Math.round((row.original.matchSimilarity ?? 0) * 100)}%
          </Badge>
        )
        return '-'
      },
      size: 80,
    },
    {
      id: 'completeness',
      header: 'Comp.',
      accessorFn: (row) => row.completeness.filled,
      cell: ({ row }) => {
        const { filled, total } = row.original.completeness
        const pct = Math.round((filled / total) * 100)
        return (
          <div className="flex items-center gap-1.5 min-w-[70px]">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full',
                  filled === total ? 'bg-green-400' : filled >= 8 ? 'bg-yellow-400' : 'bg-red-400'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{filled}/{total}</span>
          </div>
        )
      },
      size: 90,
      enableSorting: true,
    },
    {
      id: 'action',
      header: 'Action',
      cell: ({ row }) => {
        if (!row.original.checked || row.original.matchType === 'new') return null
        if (row.original.matchType === 'exact' || row.original.matchType === 'similar') {
          return (
            <Select
              value={row.original.action ?? ''}
              onValueChange={(val) => setRowAction(row.original.index, val as WorkbenchRow['action'])}
            >
              <SelectTrigger className="w-[110px] h-7 text-[10px]">
                <SelectValue placeholder="Choose..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="import">Import New</SelectItem>
                <SelectItem value="merge">Merge</SelectItem>
                <SelectItem value="skip">Skip</SelectItem>
              </SelectContent>
            </Select>
          )
        }
        return null
      },
      size: 130,
    },
  ], [setRowAction])

  const verifyColumns = useMemo<ColumnDef<UnverifiedResort>[]>(() => [
    {
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          checked={selectedVerifyIds.size === unverifiedResorts.length && unverifiedResorts.length > 0}
          onChange={(e) => {
            if (e.target.checked) setSelectedVerifyIds(new Set(unverifiedResorts.map(r => r.id)))
            else setSelectedVerifyIds(new Set())
          }}
          className="rounded"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedVerifyIds.has(row.original.id)}
          onChange={(e) => {
            e.stopPropagation()
            const next = new Set(selectedVerifyIds)
            if (e.target.checked) next.add(row.original.id)
            else next.delete(row.original.id)
            setSelectedVerifyIds(next)
          }}
          className="rounded"
        />
      ),
      size: 40,
    },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'country', header: 'Country' },
    { accessorKey: 'region', header: 'Region', cell: ({ row }) => row.original.region ?? '-' },
    { accessorKey: 'lifts', header: 'Lifts', cell: ({ row }) => row.original.lifts ?? '-' },
    { accessorKey: 'runs', header: 'Runs', cell: ({ row }) => row.original.runs ?? '-' },
    {
      id: 'completeness',
      header: 'Completeness',
      accessorFn: (row) => getVerifyCompleteness(row).filled,
      cell: ({ row }) => {
        const { filled, total, color } = getVerifyCompleteness(row.original)
        const pct = Math.round((filled / total) * 100)
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  filled === total ? 'bg-green-400' : filled >= 10 ? 'bg-yellow-400' : 'bg-red-400'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={cn('text-xs font-medium whitespace-nowrap', color)}>
              {filled}/{total}
            </span>
          </div>
        )
      },
      enableSorting: true,
    },
    {
      accessorKey: 'verification_notes',
      header: 'Notes',
      cell: ({ row }) => row.original.verification_notes
        ? <Badge className="bg-yellow-500/15 text-yellow-400 text-xs truncate max-w-[200px]">{row.original.verification_notes}</Badge>
        : '-',
    },
  ], [selectedVerifyIds, unverifiedResorts])

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="min-h-screen">
      <Header title="Bulk Import" subtitle="Import, verify, and manage resorts at scale" />

      <div className="p-6">
        <Tabs value={topTab} onValueChange={(v) => setTopTab(v as TopTab)}>
          <TabsList className="mb-6">
            <TabsTrigger value="import" className="gap-2">
              <Upload className="w-4 h-4" /> Import Workbench
            </TabsTrigger>
            <TabsTrigger value="verification" className="gap-2">
              <ShieldCheck className="w-4 h-4" /> Verification Queue
              {unverifiedTotal > 0 && (
                <span className="ml-1 text-[11px] font-semibold bg-destructive text-white px-2 py-0.5 rounded-full min-w-[20px] text-center">
                  {unverifiedTotal}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="placeholders" className="gap-2">
              <ImageIcon className="w-4 h-4" /> Placeholder Images
            </TabsTrigger>
          </TabsList>

          {/* ============================================================= */}
          {/* IMPORT WORKBENCH TAB                                          */}
          {/* ============================================================= */}
          <TabsContent value="import">
            {/* No data loaded — show upload zone */}
            {workbenchRows.length === 0 && !pushResults && (
              <div className="space-y-6">
                {/* Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault() }}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors border-border hover:border-primary/50 hover:bg-card/50"
                >
                  <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop JSON or CSV file here</p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Accepts .json, .csv</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.csv"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>

                {/* File info */}
                {fileName && (
                  <div className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3">
                    <FileJson className="w-5 h-5 text-primary shrink-0" />
                    <span className="text-sm font-medium">{fileName}</span>
                    <button onClick={clearWorkbench} className="ml-auto p-1 hover:text-destructive transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Parse errors */}
                {parseErrors.length > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-400" />
                      <span className="text-sm font-medium text-yellow-400">
                        {parseErrors.length} row{parseErrors.length === 1 ? '' : 's'} skipped during parse
                      </span>
                    </div>
                    <ScrollArea className="max-h-40">
                      <ul className="text-xs text-muted-foreground space-y-1">
                        {parseErrors.slice(0, 50).map((err, i) => <li key={i}>{err}</li>)}
                        {parseErrors.length > 50 && <li className="text-yellow-400">... and {parseErrors.length - 50} more</li>}
                      </ul>
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}

            {/* Data loaded — show workbench */}
            {workbenchRows.length > 0 && !pushResults && (
              <div className="space-y-4">
                {/* Status bar */}
                <div className="flex items-center gap-4 bg-card border border-border rounded-xl px-5 py-3">
                  <div className="flex items-center gap-3 flex-1">
                    <button
                      onClick={() => setStatusFilter('all')}
                      className={cn('flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors',
                        statusFilter === 'all' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <CircleDot className="w-3 h-3" /> All ({counts.total})
                    </button>
                    <button
                      onClick={() => setStatusFilter('error')}
                      className={cn('flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors',
                        statusFilter === 'error' ? 'bg-red-400/10 text-red-400' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <XCircle className="w-3 h-3" /> Errors ({counts.errors})
                    </button>
                    <button
                      onClick={() => setStatusFilter('warning')}
                      className={cn('flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors',
                        statusFilter === 'warning' ? 'bg-yellow-400/10 text-yellow-400' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <AlertTriangle className="w-3 h-3" /> Warnings ({counts.warnings})
                    </button>
                    <button
                      onClick={() => setStatusFilter('ready')}
                      className={cn('flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors',
                        statusFilter === 'ready' ? 'bg-green-400/10 text-green-400' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <CheckCircle2 className="w-3 h-3" /> Ready ({counts.ready})
                    </button>
                    <button
                      onClick={() => setStatusFilter('skipped')}
                      className={cn('flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors',
                        statusFilter === 'skipped' ? 'bg-slate-400/10 text-slate-400' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <SkipForward className="w-3 h-3" /> Skipped ({counts.skipped})
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkAgainstDB}
                      disabled={dbCheckLoading || counts.errors > 0}
                      className="gap-1.5"
                    >
                      {dbCheckLoading ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Checking{dbCheckProgress.total > 1 ? ` ${dbCheckProgress.batch}/${dbCheckProgress.total}` : ''}...</>
                      ) : (
                        <><Database className="w-3 h-3" /> Check Against DB</>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearWorkbench}
                      className="gap-1.5"
                    >
                      <X className="w-3 h-3" /> Clear
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setPushConfirmOpen(true)}
                      disabled={!canPush}
                      className="gap-1.5"
                    >
                      {pushLoading ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Pushing{pushProgress.total > 1 ? ` ${pushProgress.batch}/${pushProgress.total}` : ''}...</>
                      ) : (
                        <><Upload className="w-3 h-3" /> Push to DB ({counts.ready})</>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Workbench grid */}
                <DataTable
                  columns={workbenchColumns}
                  data={filteredRows}
                  pageSize={30}
                  onRowClick={(row) => setSelectedRowIndex(row.index)}
                />

                {/* Detail panel — shows when a row is selected */}
                {selectedRow && (
                  <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {statusIcon(selectedRow.status)}
                        <h3 className="text-sm font-semibold">{selectedRow.data.name || '(unnamed)'}</h3>
                        <span className="text-xs text-muted-foreground">Row {selectedRow.index + 1}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedRow.status !== 'skipped' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRowAction(selectedRow.index, 'skip')}
                            className="gap-1"
                          >
                            <SkipForward className="w-3 h-3" /> Skip Row
                          </Button>
                        )}
                        {selectedRow.status === 'skipped' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRowAction(selectedRow.index, null)}
                            className="gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> Unskip
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setSelectedRowIndex(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Left: Issues + Match info */}
                      <div className="space-y-3">
                        {selectedRow.errors.length > 0 && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-1">
                            <span className="text-xs font-medium text-red-400">Errors</span>
                            {selectedRow.errors.map((e, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                                <span><strong>{e.field}:</strong> {e.message}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {selectedRow.warnings.length > 0 && (
                          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 space-y-1">
                            <span className="text-xs font-medium text-yellow-400">Warnings</span>
                            {selectedRow.warnings.map((w, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
                                <span><strong>{w.field}:</strong> {w.message}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {selectedRow.checked && selectedRow.matchType && selectedRow.matchType !== 'new' && (
                          <div className="bg-card border border-border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium">
                                {selectedRow.matchType === 'exact' ? 'Exact Match' : 'Similar Match'}
                                {selectedRow.matchSimilarity && ` (${Math.round(selectedRow.matchSimilarity * 100)}%)`}
                              </span>
                              {selectedRow.matchedData && (
                                <Button variant="ghost" size="sm" onClick={() => setCompareOpen(true)} className="gap-1 h-6">
                                  <Eye className="w-3 h-3" /> Compare
                                </Button>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Matches: <strong>{selectedRow.matchedResortName}</strong>
                            </p>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant={selectedRow.action === 'import' ? 'default' : 'outline'}
                                onClick={() => setRowAction(selectedRow.index, 'import')}
                                className="h-7 text-xs"
                              >
                                Import New
                              </Button>
                              <Button
                                size="sm"
                                variant={selectedRow.action === 'merge' ? 'default' : 'outline'}
                                onClick={() => setRowAction(selectedRow.index, 'merge')}
                                className="h-7 text-xs"
                              >
                                Merge
                              </Button>
                              <Button
                                size="sm"
                                variant={selectedRow.action === 'skip' ? 'default' : 'outline'}
                                onClick={() => setRowAction(selectedRow.index, 'skip')}
                                className="h-7 text-xs"
                              >
                                Skip
                              </Button>
                            </div>
                          </div>
                        )}

                        {selectedRow.checked && selectedRow.matchType === 'new' && (
                          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                            <span className="text-xs font-medium text-green-400">No duplicates found — will be imported as new resort</span>
                          </div>
                        )}

                        {!selectedRow.checked && (
                          <div className="bg-slate-500/10 border border-slate-500/20 rounded-lg p-3">
                            <span className="text-xs text-muted-foreground">Click "Check Against DB" to find duplicates</span>
                          </div>
                        )}

                        {selectedRow.isDirty && selectedRow.checked && (
                          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                            <span className="text-xs text-yellow-400">Row edited after DB check — re-check recommended</span>
                          </div>
                        )}
                      </div>

                      {/* Right: Edit form */}
                      <div className="space-y-3">
                        <span className="text-xs font-medium text-muted-foreground">Edit Fields</span>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-[10px]">Name *</Label>
                            <Input
                              value={selectedRow.data.name ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'name', e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Country *</Label>
                            <Input
                              value={selectedRow.data.country ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'country', e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Country Code *</Label>
                            <Input
                              value={selectedRow.data.country_code ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'country_code', e.target.value.toUpperCase())}
                              className="h-8 text-xs"
                              maxLength={2}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Region</Label>
                            <Input
                              value={selectedRow.data.region ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'region', e.target.value || undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Latitude *</Label>
                            <Input
                              type="number"
                              step="any"
                              value={selectedRow.data.lat ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'lat', Number(e.target.value))}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Longitude *</Label>
                            <Input
                              type="number"
                              step="any"
                              value={selectedRow.data.lng ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'lng', Number(e.target.value))}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Vertical (m)</Label>
                            <Input
                              type="number"
                              value={selectedRow.data.vertical_m ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'vertical_m', e.target.value ? Number(e.target.value) : undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Runs</Label>
                            <Input
                              type="number"
                              value={selectedRow.data.runs ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'runs', e.target.value ? Number(e.target.value) : undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Lifts</Label>
                            <Input
                              type="number"
                              value={selectedRow.data.lifts ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'lifts', e.target.value ? Number(e.target.value) : undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Snowfall (cm/yr)</Label>
                            <Input
                              type="number"
                              value={selectedRow.data.annual_snowfall_cm ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'annual_snowfall_cm', e.target.value ? Number(e.target.value) : undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Beginner %</Label>
                            <Input
                              type="number"
                              value={selectedRow.data.beginner_pct ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'beginner_pct', e.target.value ? Number(e.target.value) : undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Intermediate %</Label>
                            <Input
                              type="number"
                              value={selectedRow.data.intermediate_pct ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'intermediate_pct', e.target.value ? Number(e.target.value) : undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Advanced %</Label>
                            <Input
                              type="number"
                              value={selectedRow.data.advanced_pct ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'advanced_pct', e.target.value ? Number(e.target.value) : undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Season Open</Label>
                            <Input
                              value={selectedRow.data.season_open ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'season_open', e.target.value || undefined)}
                              className="h-8 text-xs"
                              placeholder="e.g. Nov 15"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Season Close</Label>
                            <Input
                              value={selectedRow.data.season_close ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'season_close', e.target.value || undefined)}
                              className="h-8 text-xs"
                              placeholder="e.g. Apr 15"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Night Skiing</Label>
                            <Select
                              value={selectedRow.data.has_night_skiing === true ? 'true' : selectedRow.data.has_night_skiing === false ? 'false' : 'unknown'}
                              onValueChange={(val) => updateRowField(selectedRow.index, 'has_night_skiing', val === 'unknown' ? undefined : val === 'true')}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="--" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unknown">Unknown</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[10px]">Website</Label>
                            <Input
                              value={selectedRow.data.website ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'website', e.target.value || undefined)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Pass Affiliation</Label>
                            <Input
                              value={selectedRow.data.pass_affiliation ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'pass_affiliation', e.target.value || undefined)}
                              className="h-8 text-xs"
                              placeholder="epic, ikon, etc."
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Instagram</Label>
                            <Input
                              value={selectedRow.data.instagram_handle ?? ''}
                              onChange={(e) => updateRowField(selectedRow.index, 'instagram_handle', e.target.value || undefined)}
                              className="h-8 text-xs"
                              placeholder="without @"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px]">Description</Label>
                          <textarea
                            value={selectedRow.data.description ?? ''}
                            onChange={(e) => updateRowField(selectedRow.index, 'description', e.target.value || undefined)}
                            rows={3}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y mt-1"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Push confirm dialog */}
                <ConfirmDialog
                  open={pushConfirmOpen}
                  onOpenChange={setPushConfirmOpen}
                  title="Push to Database"
                  description={`This will import ${counts.ready} resort${counts.ready === 1 ? '' : 's'} as unverified. Placeholder images will be auto-assigned from R2. This action cannot be easily undone.`}
                  confirmLabel="Push to DB"
                  onConfirm={pushToDB}
                />

                {/* Comparison dialog */}
                {selectedRow?.matchedData && (
                  <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Compare Import vs Existing</DialogTitle>
                        <DialogDescription>
                          {selectedRow.data.name} vs {selectedRow.matchedResortName}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid grid-cols-2 gap-6 text-sm">
                        <div>
                          <h4 className="font-semibold text-primary mb-3">Import Data</h4>
                          <dl className="space-y-2">
                            {Object.entries(selectedRow.data).map(([key, value]) => (
                              <div key={key}>
                                <dt className="text-xs text-muted-foreground">{key}</dt>
                                <dd className="text-sm">{value != null ? String(value) : '-'}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                        <div>
                          <h4 className="font-semibold text-green-400 mb-3">Existing Data</h4>
                          <dl className="space-y-2">
                            {Object.entries(selectedRow.matchedData).map(([key, value]) => (
                              <div key={key}>
                                <dt className="text-xs text-muted-foreground">{key}</dt>
                                <dd className="text-sm">{value != null ? String(value) : '-'}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            )}

            {/* Push results */}
            {pushResults && (
              <div className="space-y-6">
                <div className="bg-card border border-border rounded-xl p-8 text-center">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
                  <p className="text-lg font-semibold mb-1">Import Complete</p>
                  <p className="text-sm text-muted-foreground">All operations finished successfully.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatsCard label="Inserted" value={pushResults.inserted} />
                  <StatsCard label="Updated" value={pushResults.updated} />
                  <StatsCard label="Placeholders Assigned" value={pushResults.placeholders} />
                </div>

                <div className="flex justify-center gap-3">
                  <Button variant="outline" onClick={clearWorkbench} className="gap-2">
                    <Upload className="w-4 h-4" /> New Import
                  </Button>
                  <Button onClick={() => { setTopTab('verification'); clearWorkbench() }} className="gap-2">
                    <ShieldCheck className="w-4 h-4" /> Go to Verification
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ============================================================= */}
          {/* VERIFICATION TAB                                              */}
          {/* ============================================================= */}
          <TabsContent value="verification">
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatsCard label="Unverified" value={unverifiedTotal} />
                <StatsCard label="Verified" value={verifiedTotal} />
                <StatsCard label="Total Resorts" value={unverifiedTotal + verifiedTotal} />
              </div>

              {selectedVerifyIds.size > 0 && (
                <div className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3">
                  <span className="text-sm text-muted-foreground">{selectedVerifyIds.size} selected</span>
                  <Button
                    size="sm"
                    onClick={() => handleBulkVerify(true)}
                    disabled={verifyLoading}
                    className="gap-1"
                  >
                    {verifyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    Verify Selected
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkVerify(false)}
                    disabled={verifyLoading}
                    className="gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" /> Flag Selected
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={verifyLoading || deleteLoading}
                    className="gap-1"
                  >
                    {deleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    Delete Selected
                  </Button>
                </div>
              )}

              {unverifiedLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : (
                <DataTable
                  columns={verifyColumns}
                  data={unverifiedResorts}
                  onRowClick={(row) => {
                    setVerifyDialogResort({ ...row })
                    setVerifyNotes(row.verification_notes ?? '')
                    setVerifyDirty(false)
                    setVerifyDialogOpen(true)
                  }}
                  pageSize={PAGE_SIZE}
                  defaultSorting={[{ id: 'completeness', desc: true }]}
                  serverPagination={{
                    totalCount: unverifiedTotal,
                    page: unverifiedPage,
                    onPageChange: setUnverifiedPage,
                  }}
                />
              )}

              {/* Verify Dialog — Editable */}
              <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Edit & Verify Resort</DialogTitle>
                    <DialogDescription>
                      Fill in missing fields to improve completeness, then save or verify.
                    </DialogDescription>
                  </DialogHeader>

                  {verifyDialogResort && (
                    <div className="space-y-5">
                      {/* Completeness indicator */}
                      {(() => {
                        const { filled, total, label, color } = getVerifyCompleteness(verifyDialogResort)
                        const pct = Math.round((filled / total) * 100)
                        return (
                          <div className="flex items-center gap-3 text-sm">
                            <span className="text-muted-foreground">Completeness:</span>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden max-w-[200px]">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  filled === total ? 'bg-green-400' : filled >= 10 ? 'bg-yellow-400' : 'bg-red-400'
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className={cn('font-medium', color)}>{label} ({filled}/{total})</span>
                            {verifyDirty && <Badge className="bg-yellow-500/15 text-yellow-400 text-[10px] ml-auto">Unsaved</Badge>}
                          </div>
                        )
                      })()}

                      {/* Identity */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Identity</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-[10px]">Name *</Label>
                            <Input
                              value={verifyDialogResort.name ?? ''}
                              onChange={(e) => updateVerifyField('name', e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Country *</Label>
                            <Input
                              value={verifyDialogResort.country ?? ''}
                              onChange={(e) => updateVerifyField('country', e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Country Code *</Label>
                            <Input
                              value={verifyDialogResort.country_code ?? ''}
                              onChange={(e) => updateVerifyField('country_code', e.target.value.toUpperCase())}
                              className="h-8 text-xs"
                              maxLength={2}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Region</Label>
                            <Input
                              value={verifyDialogResort.region ?? ''}
                              onChange={(e) => updateVerifyField('region', e.target.value || null)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Location */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Location</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-[10px]">Latitude *</Label>
                            <Input
                              type="number"
                              step="any"
                              value={verifyDialogResort.lat ?? ''}
                              onChange={(e) => updateVerifyField('lat', e.target.value ? Number(e.target.value) : 0)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Longitude *</Label>
                            <Input
                              type="number"
                              step="any"
                              value={verifyDialogResort.lng ?? ''}
                              onChange={(e) => updateVerifyField('lng', e.target.value ? Number(e.target.value) : 0)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Stats */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Stats</h4>
                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <Label className="text-[10px]">Vertical (m)</Label>
                            <Input
                              type="number"
                              value={verifyDialogResort.vertical_m ?? ''}
                              onChange={(e) => updateVerifyField('vertical_m', e.target.value ? Number(e.target.value) : null)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Runs</Label>
                            <Input
                              type="number"
                              value={verifyDialogResort.runs ?? ''}
                              onChange={(e) => updateVerifyField('runs', e.target.value ? Number(e.target.value) : null)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Lifts</Label>
                            <Input
                              type="number"
                              value={verifyDialogResort.lifts ?? ''}
                              onChange={(e) => updateVerifyField('lifts', e.target.value ? Number(e.target.value) : null)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Snowfall (cm/yr)</Label>
                            <Input
                              type="number"
                              value={verifyDialogResort.annual_snowfall_cm ?? ''}
                              onChange={(e) => updateVerifyField('annual_snowfall_cm', e.target.value ? Number(e.target.value) : null)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Terrain Mix */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Terrain Mix</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="text-[10px]">Beginner %</Label>
                            <Input
                              type="number"
                              value={verifyDialogResort.beginner_pct ?? ''}
                              onChange={(e) => updateVerifyField('beginner_pct', e.target.value ? Number(e.target.value) : null)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Intermediate %</Label>
                            <Input
                              type="number"
                              value={verifyDialogResort.intermediate_pct ?? ''}
                              onChange={(e) => updateVerifyField('intermediate_pct', e.target.value ? Number(e.target.value) : null)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Advanced %</Label>
                            <Input
                              type="number"
                              value={verifyDialogResort.advanced_pct ?? ''}
                              onChange={(e) => updateVerifyField('advanced_pct', e.target.value ? Number(e.target.value) : null)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Season & Night Skiing */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Season</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="text-[10px]">Season Open</Label>
                            <Input
                              value={verifyDialogResort.season_open ?? ''}
                              onChange={(e) => updateVerifyField('season_open', e.target.value || null)}
                              className="h-8 text-xs"
                              placeholder="e.g. Nov 15"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Season Close</Label>
                            <Input
                              value={verifyDialogResort.season_close ?? ''}
                              onChange={(e) => updateVerifyField('season_close', e.target.value || null)}
                              className="h-8 text-xs"
                              placeholder="e.g. Apr 15"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Night Skiing</Label>
                            <Select
                              value={verifyDialogResort.has_night_skiing === true ? 'true' : verifyDialogResort.has_night_skiing === false ? 'false' : 'unknown'}
                              onValueChange={(val) => updateVerifyField('has_night_skiing', val === 'unknown' ? null : val === 'true')}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="--" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unknown">Unknown</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Other */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Other</h4>
                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <Label className="text-[10px]">Website</Label>
                            <Input
                              value={verifyDialogResort.website ?? ''}
                              onChange={(e) => updateVerifyField('website', e.target.value || null)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Pass Affiliation</Label>
                            <Input
                              value={verifyDialogResort.pass_affiliation ?? ''}
                              onChange={(e) => updateVerifyField('pass_affiliation', e.target.value || null)}
                              className="h-8 text-xs"
                              placeholder="epic, ikon, etc."
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Budget Tier</Label>
                            <Select
                              value={verifyDialogResort.budget_tier ?? 'none'}
                              onValueChange={(val) => updateVerifyField('budget_tier', val === 'none' ? null : val)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="--" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Not set</SelectItem>
                                <SelectItem value="budget">Budget</SelectItem>
                                <SelectItem value="mid">Mid</SelectItem>
                                <SelectItem value="premium">Premium</SelectItem>
                                <SelectItem value="luxury">Luxury</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[10px]">Instagram</Label>
                            <Input
                              value={verifyDialogResort.instagram_handle ?? ''}
                              onChange={(e) => updateVerifyField('instagram_handle', e.target.value || null)}
                              className="h-8 text-xs"
                              placeholder="without @"
                            />
                          </div>
                        </div>
                        <div className="mt-3">
                          <Label className="text-[10px]">Description</Label>
                          <textarea
                            value={verifyDialogResort.description ?? ''}
                            onChange={(e) => updateVerifyField('description', e.target.value || null)}
                            rows={3}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y mt-1"
                            placeholder="Brief resort description..."
                          />
                        </div>
                      </div>

                      {/* Verification Notes */}
                      <div>
                        <Label className="text-[10px]">Verification Notes</Label>
                        <textarea
                          value={verifyNotes}
                          onChange={(e) => setVerifyNotes(e.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y mt-1"
                          placeholder="Optional notes about data accuracy..."
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSaveResortFields()}
                          disabled={!verifyDirty || verifySaving || verifyLoading}
                          className="gap-1"
                        >
                          {verifySaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                          Save Changes
                        </Button>
                        <div className="flex-1" />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (verifyDirty) {
                              handleSaveResortFields({ verified: false, notes: verifyNotes })
                            } else {
                              handleSingleVerify(verifyDialogResort.id, false, verifyNotes)
                            }
                          }}
                          disabled={verifyLoading || verifySaving}
                          className="gap-1"
                        >
                          {verifyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                          Flag
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (verifyDirty) {
                              handleSaveResortFields({ verified: true, notes: verifyNotes })
                            } else {
                              handleSingleVerify(verifyDialogResort.id, true, verifyNotes)
                            }
                          }}
                          disabled={verifyLoading || verifySaving}
                          className="gap-1"
                        >
                          {(verifyLoading || verifySaving) ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          {verifyDirty ? 'Save & Verify' : 'Verify'}
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              {/* Delete confirmation dialog */}
              <ConfirmDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title="Delete Selected Resorts"
                description={`Delete ${selectedVerifyIds.size} resort${selectedVerifyIds.size === 1 ? '' : 's'}? Resorts with user visits, wishlists, or home resort references cannot be deleted. This action cannot be undone.`}
                confirmLabel="Delete"
                variant="destructive"
                onConfirm={handleBulkDelete}
              />

              {/* Blocked resorts dialog */}
              <Dialog open={deleteBlockedDialogOpen} onOpenChange={setDeleteBlockedDialogOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Some Resorts Could Not Be Deleted</DialogTitle>
                    <DialogDescription>
                      {deleteResult
                        ? `${deleteResult.deleted} resort${deleteResult.deleted === 1 ? ' was' : 's were'} deleted. ${deleteBlockedResorts.length} could not be deleted due to related data.`
                        : `${deleteBlockedResorts.length} resort${deleteBlockedResorts.length === 1 ? '' : 's'} could not be deleted due to related data.`}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    {deleteBlockedResorts.map((r) => (
                      <div key={r.id} className="flex items-start gap-2 text-sm bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <span className="font-medium">{r.name}</span>
                          <span className="text-muted-foreground ml-1">— {r.reason}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </TabsContent>

          {/* ============================================================= */}
          {/* PLACEHOLDERS TAB                                              */}
          {/* ============================================================= */}
          <TabsContent value="placeholders">
            <div className="space-y-6">
              {placeholdersLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <StatsCard label="No Cover Image" value={noCoverCount} />
                  <StatsCard label="Has Cover Image" value={hasCoverCount} />
                </div>
              )}

              <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Available Placeholders</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {placeholdersFetching
                        ? 'Loading from R2...'
                        : `${discoveredPlaceholders.length} placeholder image${discoveredPlaceholders.length === 1 ? '' : 's'} discovered in R2`}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchPlaceholderUrls(true)}
                    disabled={placeholdersFetching}
                    className="gap-1"
                  >
                    {placeholdersFetching && <Loader2 className="w-3 h-3 animate-spin" />}
                    Refresh
                  </Button>
                </div>

                {discoveredPlaceholders.length > 0 && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {discoveredPlaceholders.map((url) => (
                      <div key={url} className="aspect-[3/2] rounded-lg overflow-hidden border border-border bg-muted">
                        <img
                          src={url}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {discoveredPlaceholders.length === 0 && !placeholdersFetching && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No placeholder images found in R2 at <code className="text-xs">resorts/placeholders/</code>
                  </div>
                )}

                <Button
                  onClick={handleAssignPlaceholders}
                  disabled={assigningPlaceholders || noCoverCount === 0 || discoveredPlaceholders.length === 0}
                  className="gap-2"
                >
                  {assigningPlaceholders ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Assigning...</>
                  ) : (
                    <><ImageIcon className="w-4 h-4" /> Assign to {noCoverCount} Resorts</>
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
