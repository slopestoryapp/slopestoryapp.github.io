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
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  FileJson,
  X,
  Eye,
  ShieldCheck,
  ImageIcon,
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

interface PreviewResult {
  input_index: number
  input_name: string
  input_country: string
  match_type: 'new' | 'exact' | 'similar'
  existing_resort_id: string | null
  existing_name: string | null
  existing_country: string | null
  similarity_score: number
  existing_data: Record<string, unknown> | null
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
}

type WizardStep = 'upload' | 'preview' | 'review' | 'importing' | 'done'
type TopTab = 'import' | 'verification' | 'placeholders'

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

function similarityBadge(score: number) {
  if (score >= 0.8) return { label: 'High', className: 'bg-green-500/15 text-green-400' }
  if (score >= 0.5) return { label: 'Medium', className: 'bg-yellow-500/15 text-yellow-400' }
  return { label: 'Low', className: 'bg-slate-500/15 text-slate-400' }
}

function validateRow(row: Record<string, unknown>, index: number): string | null {
  const name = row.name
  const country = row.country
  const countryCode = row.country_code
  const lat = Number(row.lat ?? row.latitude)
  const lng = Number(row.lng ?? row.longitude)

  if (!name || (typeof name === 'string' && !name.trim())) return `Row ${index + 1}: missing name`
  if (!country || (typeof country === 'string' && !country.trim())) return `Row ${index + 1}: missing country`
  if (!countryCode || (typeof countryCode === 'string' && !countryCode.trim())) return `Row ${index + 1}: missing country_code`
  if (isNaN(lat) || lat < -90 || lat > 90) return `Row ${index + 1}: invalid lat (${row.lat ?? row.latitude})`
  if (isNaN(lng) || lng < -180 || lng > 180) return `Row ${index + 1}: invalid lng (${row.lng ?? row.longitude})`
  return null
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

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"(.*)"$/, '$1'))
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    // Basic CSV field splitting that handles quoted commas
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

const BATCH_SIZE = 500

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BulkImportPage() {
  const { log } = useAuditLog()

  // Top-level tab
  const [topTab, setTopTab] = useState<TopTab>('import')

  // -- Import Wizard State --
  const [step, setStep] = useState<WizardStep>('upload')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [parsedRows, setParsedRows] = useState<ImportResortRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)

  // Preview state
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewProgress, setPreviewProgress] = useState({ batch: 0, total: 0 })
  const [previewNew, setPreviewNew] = useState<PreviewResult[]>([])
  const [previewExact, setPreviewExact] = useState<PreviewResult[]>([])
  const [previewSimilar, setPreviewSimilar] = useState<PreviewResult[]>([])
  const [previewTab, setPreviewTab] = useState('new')
  const [selectedNew, setSelectedNew] = useState<Set<number>>(new Set())
  const [selectedExact, setSelectedExact] = useState<Set<number>>(new Set())
  const [similarActions, setSimilarActions] = useState<Map<number, string>>(new Map())
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareItem, setCompareItem] = useState<PreviewResult | null>(null)

  // Review & import state
  const [placeholderUrlsText, setPlaceholderUrlsText] = useState('')
  const [assignPlaceholders, setAssignPlaceholders] = useState(true)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ batch: 0, total: 0 })
  const [importResults, setImportResults] = useState<{ inserted: number; updated: number; placeholders: number } | null>(null)

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

  // -- Placeholders Tab State --
  const [noCoverCount, setNoCoverCount] = useState(0)
  const [hasCoverCount, setHasCoverCount] = useState(0)
  const [placeholderInput, setPlaceholderInput] = useState('')
  const [assigningPlaceholders, setAssigningPlaceholders] = useState(false)
  const [placeholdersLoading, setPlaceholdersLoading] = useState(false)

  // =========================================================================
  // IMPORT WIZARD
  // =========================================================================

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
        const valid: ImportResortRow[] = []
        for (let i = 0; i < rawRows.length; i++) {
          const err = validateRow(rawRows[i], i)
          if (err) { errors.push(err); continue }
          valid.push(normalizeRow(rawRows[i]))
        }

        setParsedRows(valid)
        setParseErrors(errors)
        if (valid.length > 0) toast.success(`Parsed ${valid.length} valid resorts`)
        else toast.error('No valid resort rows found')
      } catch {
        toast.error('Failed to parse file')
        setParsedRows([])
        setParseErrors(['Failed to parse file. Ensure it is valid JSON or CSV.'])
      }
    }
    reader.readAsText(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const clearFile = useCallback(() => {
    setFileName('')
    setParsedRows([])
    setParseErrors([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // -- Preview --
  const runPreview = useCallback(async () => {
    if (!parsedRows.length) return
    setPreviewLoading(true)
    setPreviewNew([])
    setPreviewExact([])
    setPreviewSimilar([])

    try {
      const batches: ImportResortRow[][] = []
      for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
        batches.push(parsedRows.slice(i, i + BATCH_SIZE))
      }
      setPreviewProgress({ batch: 0, total: batches.length })

      const allNew: PreviewResult[] = []
      const allExact: PreviewResult[] = []
      const allSimilar: PreviewResult[] = []

      for (let i = 0; i < batches.length; i++) {
        setPreviewProgress({ batch: i + 1, total: batches.length })
        const res = await callEdgeFunction('admin-bulk-import-resorts', {
          action: 'preview',
          resorts: batches[i],
        })

        const offset = i * BATCH_SIZE
        for (const r of res.results?.new ?? []) {
          allNew.push({ ...r, input_index: r.input_index + offset })
        }
        for (const r of res.results?.exact_matches ?? []) {
          allExact.push({ ...r, input_index: r.input_index + offset })
        }
        for (const r of res.results?.similar_matches ?? []) {
          allSimilar.push({ ...r, input_index: r.input_index + offset })
        }
      }

      setPreviewNew(allNew)
      setPreviewExact(allExact)
      setPreviewSimilar(allSimilar)

      // Select all new by default
      setSelectedNew(new Set(allNew.map(r => r.input_index)))
      setSelectedExact(new Set())
      setSimilarActions(new Map())

      setStep('preview')
      toast.success(`Preview complete: ${allNew.length} new, ${allExact.length} exact, ${allSimilar.length} similar`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }, [parsedRows])

  // -- Import execution --
  const executeImport = useCallback(async () => {
    setConfirmDialogOpen(false)
    setStep('importing')
    setImporting(true)

    try {
      // Build new resorts from selected new + similar "import as new"
      const newResorts: ImportResortRow[] = []
      for (const idx of selectedNew) {
        if (parsedRows[idx]) newResorts.push(parsedRows[idx])
      }
      for (const [idx, action] of similarActions) {
        if (action === 'import' && parsedRows[idx]) newResorts.push(parsedRows[idx])
      }

      // Build updates from selected exact + similar "merge"
      const updates: { resort_id: string; fields: Partial<ImportResortRow> }[] = []
      for (const idx of selectedExact) {
        const match = previewExact.find(r => r.input_index === idx)
        if (match?.existing_resort_id && parsedRows[idx]) {
          updates.push({ resort_id: match.existing_resort_id, fields: parsedRows[idx] })
        }
      }
      for (const [idx, action] of similarActions) {
        if (action === 'merge') {
          const match = previewSimilar.find(r => r.input_index === idx)
          if (match?.existing_resort_id && parsedRows[idx]) {
            updates.push({ resort_id: match.existing_resort_id, fields: parsedRows[idx] })
          }
        }
      }

      const placeholderUrls = assignPlaceholders
        ? placeholderUrlsText.split('\n').map(u => u.trim()).filter(Boolean)
        : undefined

      // Batch new resorts
      const newBatches: ImportResortRow[][] = []
      for (let i = 0; i < newResorts.length; i += BATCH_SIZE) {
        newBatches.push(newResorts.slice(i, i + BATCH_SIZE))
      }

      const totalBatches = Math.max(newBatches.length, 1)
      setImportProgress({ batch: 0, total: totalBatches })

      let totalInserted = 0
      let totalUpdated = 0
      let totalPlaceholders = 0

      if (newBatches.length === 0 && updates.length > 0) {
        // Only updates, no new resorts
        setImportProgress({ batch: 1, total: 1 })
        const res = await callEdgeFunction('admin-bulk-import-resorts', {
          action: 'import',
          new_resorts: [],
          updates,
        })
        totalUpdated = res.updated ?? 0
      } else {
        for (let i = 0; i < newBatches.length; i++) {
          setImportProgress({ batch: i + 1, total: totalBatches })
          const payload: Record<string, unknown> = {
            action: 'import',
            new_resorts: newBatches[i],
          }
          // Send updates and placeholder URLs only with the first batch
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

      setImportResults({ inserted: totalInserted, updated: totalUpdated, placeholders: totalPlaceholders })
      setStep('done')
      toast.success(`Import complete! ${totalInserted} inserted, ${totalUpdated} updated`)

      await log({
        action: 'bulk_import_resorts',
        entity_type: 'resort',
        details: { inserted: totalInserted, updated: totalUpdated, placeholders_assigned: totalPlaceholders },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
      setStep('review')
    } finally {
      setImporting(false)
    }
  }, [parsedRows, selectedNew, selectedExact, similarActions, previewExact, previewSimilar, assignPlaceholders, placeholderUrlsText, log])

  const resetWizard = useCallback(() => {
    setStep('upload')
    clearFile()
    setPreviewNew([])
    setPreviewExact([])
    setPreviewSimilar([])
    setSelectedNew(new Set())
    setSelectedExact(new Set())
    setSimilarActions(new Map())
    setConfirmChecked(false)
    setImportResults(null)
  }, [clearFile])

  // Computed counts for review
  const reviewCounts = useMemo(() => {
    let newCount = selectedNew.size
    let updateCount = selectedExact.size
    let skipCount = previewNew.length + previewExact.length + previewSimilar.length - newCount - updateCount

    for (const [, action] of similarActions) {
      if (action === 'import') newCount++
      else if (action === 'merge') updateCount++
    }
    // Recompute skip
    skipCount = previewNew.length + previewExact.length + previewSimilar.length - newCount - updateCount

    return { newCount, updateCount, skipCount }
  }, [selectedNew, selectedExact, similarActions, previewNew, previewExact, previewSimilar])

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
          .select('id, name, country, country_code, region, lat, lng, website, vertical_m, runs, lifts, verified, verification_notes, pass_affiliation')
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
    if (topTab === 'placeholders') loadPlaceholderCounts()
  }, [topTab, loadPlaceholderCounts])

  const handleAssignPlaceholders = useCallback(async () => {
    const urls = placeholderInput.split('\n').map(u => u.trim()).filter(Boolean)
    if (urls.length === 0) { toast.error('Enter at least one placeholder URL'); return }
    setAssigningPlaceholders(true)
    try {
      const res = await callEdgeFunction('admin-bulk-import-resorts', {
        action: 'assign_placeholders',
        placeholder_urls: urls,
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
  }, [placeholderInput, loadPlaceholderCounts, log])

  // =========================================================================
  // COLUMN DEFINITIONS
  // =========================================================================

  const newColumns = useMemo<ColumnDef<PreviewResult>[]>(() => [
    {
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          checked={selectedNew.size === previewNew.length && previewNew.length > 0}
          onChange={(e) => {
            if (e.target.checked) setSelectedNew(new Set(previewNew.map(r => r.input_index)))
            else setSelectedNew(new Set())
          }}
          className="rounded"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedNew.has(row.original.input_index)}
          onChange={(e) => {
            const next = new Set(selectedNew)
            if (e.target.checked) next.add(row.original.input_index)
            else next.delete(row.original.input_index)
            setSelectedNew(next)
          }}
          className="rounded"
        />
      ),
      size: 40,
    },
    { accessorKey: 'input_name', header: 'Name' },
    { accessorKey: 'input_country', header: 'Country' },
    {
      id: 'region',
      header: 'Region',
      cell: ({ row }) => parsedRows[row.original.input_index]?.region ?? '-',
    },
    {
      id: 'vertical',
      header: 'Vertical (m)',
      cell: ({ row }) => parsedRows[row.original.input_index]?.vertical_m ?? '-',
    },
    {
      id: 'lifts',
      header: 'Lifts',
      cell: ({ row }) => parsedRows[row.original.input_index]?.lifts ?? '-',
    },
    {
      id: 'runs',
      header: 'Runs',
      cell: ({ row }) => parsedRows[row.original.input_index]?.runs ?? '-',
    },
  ], [selectedNew, previewNew, parsedRows])

  const exactColumns = useMemo<ColumnDef<PreviewResult>[]>(() => [
    {
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          checked={selectedExact.size === previewExact.length && previewExact.length > 0}
          onChange={(e) => {
            if (e.target.checked) setSelectedExact(new Set(previewExact.map(r => r.input_index)))
            else setSelectedExact(new Set())
          }}
          className="rounded"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedExact.has(row.original.input_index)}
          onChange={(e) => {
            const next = new Set(selectedExact)
            if (e.target.checked) next.add(row.original.input_index)
            else next.delete(row.original.input_index)
            setSelectedExact(next)
          }}
          className="rounded"
        />
      ),
      size: 40,
    },
    { accessorKey: 'input_name', header: 'Import Name' },
    { accessorKey: 'existing_name', header: 'Existing Name' },
    { accessorKey: 'input_country', header: 'Country' },
    {
      id: 'similarity',
      header: 'Similarity',
      cell: ({ row }) => {
        const badge = similarityBadge(row.original.similarity_score)
        return <Badge className={badge.className}>{badge.label} ({Math.round(row.original.similarity_score * 100)}%)</Badge>
      },
    },
    {
      id: 'compare',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); setCompareItem(row.original); setCompareOpen(true) }}
        >
          <Eye className="w-4 h-4" />
        </Button>
      ),
      size: 50,
    },
  ], [selectedExact, previewExact])

  const similarColumns = useMemo<ColumnDef<PreviewResult>[]>(() => [
    {
      id: 'action',
      header: 'Action',
      cell: ({ row }) => (
        <Select
          value={similarActions.get(row.original.input_index) ?? 'skip'}
          onValueChange={(val) => {
            const next = new Map(similarActions)
            next.set(row.original.input_index, val)
            setSimilarActions(next)
          }}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">Skip</SelectItem>
            <SelectItem value="import">Import as New</SelectItem>
            <SelectItem value="merge">Merge</SelectItem>
          </SelectContent>
        </Select>
      ),
      size: 160,
    },
    { accessorKey: 'input_name', header: 'Import Name' },
    { accessorKey: 'existing_name', header: 'Existing Name' },
    { accessorKey: 'input_country', header: 'Country' },
    {
      id: 'score',
      header: 'Score',
      cell: ({ row }) => {
        const badge = similarityBadge(row.original.similarity_score)
        return <Badge className={badge.className}>{Math.round(row.original.similarity_score * 100)}%</Badge>
      },
    },
    {
      id: 'compare',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); setCompareItem(row.original); setCompareOpen(true) }}
        >
          <Eye className="w-4 h-4" />
        </Button>
      ),
      size: 50,
    },
  ], [similarActions])

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
              <Upload className="w-4 h-4" /> Import Wizard
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
          {/* IMPORT WIZARD TAB                                             */}
          {/* ============================================================= */}
          <TabsContent value="import">
            {/* STEP: UPLOAD */}
            {step === 'upload' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatsCard label="Total Rows" value={parsedRows.length + parseErrors.length} />
                  <StatsCard label="Valid Rows" value={parsedRows.length} />
                  <StatsCard label="Missing Fields" value={parseErrors.length} />
                </div>

                {/* Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors',
                    dragOver
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-card/50'
                  )}
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
                    <span className="text-xs text-muted-foreground">{parsedRows.length} valid rows</span>
                    <button onClick={clearFile} className="ml-auto p-1 hover:text-destructive transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Validation errors */}
                {parseErrors.length > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-400" />
                      <span className="text-sm font-medium text-yellow-400">
                        {parseErrors.length} row{parseErrors.length === 1 ? '' : 's'} with issues (will be skipped)
                      </span>
                    </div>
                    <ScrollArea className="max-h-40">
                      <ul className="text-xs text-muted-foreground space-y-1">
                        {parseErrors.slice(0, 50).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                        {parseErrors.length > 50 && (
                          <li className="text-yellow-400">... and {parseErrors.length - 50} more</li>
                        )}
                      </ul>
                    </ScrollArea>
                  </div>
                )}

                {/* Proceed button */}
                <div className="flex justify-end">
                  <Button
                    onClick={runPreview}
                    disabled={parsedRows.length === 0 || previewLoading}
                    className="gap-2"
                  >
                    {previewLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Previewing{previewProgress.total > 1 ? ` (batch ${previewProgress.batch}/${previewProgress.total})` : ''}...
                      </>
                    ) : (
                      <>
                        Proceed to Preview
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* STEP: PREVIEW */}
            {step === 'preview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatsCard label="New Resorts" value={previewNew.length} change="Ready to import" />
                  <StatsCard label="Exact Matches" value={previewExact.length} change="Already in database" />
                  <StatsCard label="Similar Matches" value={previewSimilar.length} change="Needs review" />
                </div>

                <div className="flex items-center justify-between">
                  <Button variant="outline" onClick={() => setStep('upload')} className="gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back to Upload
                  </Button>
                </div>

                <Tabs value={previewTab} onValueChange={setPreviewTab}>
                  <TabsList>
                    <TabsTrigger value="new" className="gap-1">
                      New <Badge className="bg-green-500/15 text-green-400 ml-1">{previewNew.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="exact" className="gap-1">
                      Exact <Badge className="bg-yellow-500/15 text-yellow-400 ml-1">{previewExact.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="similar" className="gap-1">
                      Similar <Badge className="bg-orange-500/15 text-orange-400 ml-1">{previewSimilar.length}</Badge>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="new">
                    <div className="text-xs text-muted-foreground mb-2">
                      {selectedNew.size} of {previewNew.length} selected for import
                    </div>
                    <DataTable columns={newColumns} data={previewNew} pageSize={20} />
                  </TabsContent>

                  <TabsContent value="exact">
                    <div className="text-xs text-muted-foreground mb-2">
                      {selectedExact.size} of {previewExact.length} selected for update
                    </div>
                    <DataTable columns={exactColumns} data={previewExact} pageSize={20} />
                  </TabsContent>

                  <TabsContent value="similar">
                    <div className="text-xs text-muted-foreground mb-2">
                      Review each match and choose an action
                    </div>
                    <DataTable columns={similarColumns} data={previewSimilar} pageSize={20} />
                  </TabsContent>
                </Tabs>

                <div className="flex justify-end">
                  <Button onClick={() => setStep('review')} className="gap-2">
                    Proceed to Review <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP: REVIEW */}
            {step === 'review' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatsCard label="Importing New" value={reviewCounts.newCount} />
                  <StatsCard label="Updating Existing" value={reviewCounts.updateCount} />
                  <StatsCard label="Skipping" value={reviewCounts.skipCount} />
                </div>

                <div className="flex items-center justify-between">
                  <Button variant="outline" onClick={() => setStep('preview')} className="gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back to Preview
                  </Button>
                </div>

                <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                  <h3 className="text-sm font-semibold">Import Summary</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>{reviewCounts.newCount} new resorts will be inserted (verified: false)</li>
                    <li>{reviewCounts.updateCount} existing resorts will have fields updated</li>
                    <li>{reviewCounts.skipCount} rows skipped</li>
                  </ul>
                </div>

                <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                  <h3 className="text-sm font-semibold">Placeholder Images</h3>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={assignPlaceholders}
                      onChange={(e) => setAssignPlaceholders(e.target.checked)}
                      className="rounded"
                    />
                    Assign random placeholder images to new resorts
                  </label>
                  {assignPlaceholders && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Placeholder URLs (one per line)</Label>
                      <textarea
                        value={placeholderUrlsText}
                        onChange={(e) => setPlaceholderUrlsText(e.target.value)}
                        rows={5}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                        placeholder="https://rnudbfdhrenesamdjzdk.supabase.co/storage/v1/object/public/resort-placeholders/mountain-01.jpg"
                      />
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    className="rounded"
                  />
                  I understand this will import {reviewCounts.newCount} resorts as unverified
                </label>

                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={resetWizard}>Cancel</Button>
                  <Button
                    onClick={() => setConfirmDialogOpen(true)}
                    disabled={!confirmChecked || (reviewCounts.newCount === 0 && reviewCounts.updateCount === 0)}
                    className="gap-2"
                  >
                    Start Import <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>

                <ConfirmDialog
                  open={confirmDialogOpen}
                  onOpenChange={setConfirmDialogOpen}
                  title="Start Bulk Import"
                  description={`This will insert ${reviewCounts.newCount} new resorts and update ${reviewCounts.updateCount} existing resorts. All new resorts will be imported as unverified. This action cannot be easily undone.`}
                  confirmLabel="Start Import"
                  onConfirm={executeImport}
                />
              </div>
            )}

            {/* STEP: IMPORTING */}
            {step === 'importing' && (
              <div className="space-y-6">
                <div className="bg-card border border-border rounded-xl p-8 text-center">
                  <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
                  <p className="text-sm font-medium mb-2">Importing resorts...</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Batch {importProgress.batch} of {importProgress.total}
                  </p>
                  <div className="w-full max-w-md mx-auto bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-300"
                      style={{ width: `${importProgress.total ? (importProgress.batch / importProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP: DONE */}
            {step === 'done' && importResults && (
              <div className="space-y-6">
                <div className="bg-card border border-border rounded-xl p-8 text-center">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
                  <p className="text-lg font-semibold mb-1">Import Complete</p>
                  <p className="text-sm text-muted-foreground">All operations finished successfully.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatsCard label="Inserted" value={importResults.inserted} />
                  <StatsCard label="Updated" value={importResults.updated} />
                  <StatsCard label="Placeholders Assigned" value={importResults.placeholders} />
                </div>

                <div className="flex justify-center gap-3">
                  <Button variant="outline" onClick={resetWizard} className="gap-2">
                    <Upload className="w-4 h-4" /> Start New Import
                  </Button>
                  <Button onClick={() => { setTopTab('verification'); resetWizard() }} className="gap-2">
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
                    setVerifyDialogResort(row)
                    setVerifyNotes(row.verification_notes ?? '')
                    setVerifyDialogOpen(true)
                  }}
                  pageSize={PAGE_SIZE}
                  serverPagination={{
                    totalCount: unverifiedTotal,
                    page: unverifiedPage,
                    onPageChange: setUnverifiedPage,
                  }}
                />
              )}

              {/* Verify Dialog */}
              <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{verifyDialogResort?.name ?? 'Resort'}</DialogTitle>
                    <DialogDescription>{verifyDialogResort?.country} - {verifyDialogResort?.region ?? 'N/A'}</DialogDescription>
                  </DialogHeader>

                  {verifyDialogResort && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Country Code:</span> {verifyDialogResort.country_code}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Coordinates:</span> {verifyDialogResort.lat}, {verifyDialogResort.lng}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Lifts:</span> {verifyDialogResort.lifts ?? '-'}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Runs:</span> {verifyDialogResort.runs ?? '-'}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Vertical:</span> {verifyDialogResort.vertical_m ?? '-'}m
                        </div>
                        <div>
                          <span className="text-muted-foreground">Pass:</span> {verifyDialogResort.pass_affiliation ?? '-'}
                        </div>
                        {verifyDialogResort.website && (
                          <div className="col-span-2">
                            <span className="text-muted-foreground">Website:</span>{' '}
                            <a href={verifyDialogResort.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              {verifyDialogResort.website}
                            </a>
                          </div>
                        )}
                      </div>

                      <div>
                        <Label className="text-xs">Verification Notes</Label>
                        <textarea
                          value={verifyNotes}
                          onChange={(e) => setVerifyNotes(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y mt-1"
                          placeholder="Optional notes about data accuracy..."
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => handleSingleVerify(verifyDialogResort.id, false, verifyNotes)}
                          disabled={verifyLoading}
                          className="gap-1"
                        >
                          {verifyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                          Flag with Notes
                        </Button>
                        <Button
                          onClick={() => handleSingleVerify(verifyDialogResort.id, true, verifyNotes)}
                          disabled={verifyLoading}
                          className="gap-1"
                        >
                          {verifyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          Verify
                        </Button>
                      </div>
                    </div>
                  )}
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
                <h3 className="text-sm font-semibold">Assign Placeholder Images</h3>
                <p className="text-xs text-muted-foreground">
                  Enter placeholder image URLs below (one per line). These will be randomly assigned to resorts without cover images.
                </p>
                <textarea
                  value={placeholderInput}
                  onChange={(e) => setPlaceholderInput(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                  placeholder={`https://rnudbfdhrenesamdjzdk.supabase.co/storage/v1/object/public/resort-placeholders/mountain-01.jpg\nhttps://rnudbfdhrenesamdjzdk.supabase.co/storage/v1/object/public/resort-placeholders/mountain-02.jpg`}
                />
                <Button
                  onClick={handleAssignPlaceholders}
                  disabled={assigningPlaceholders || noCoverCount === 0}
                  className="gap-2"
                >
                  {assigningPlaceholders ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Assigning...</>
                  ) : (
                    <><ImageIcon className="w-4 h-4" /> Assign Placeholders to {noCoverCount} Resorts</>
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Comparison Dialog */}
        <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Compare Import vs Existing</DialogTitle>
              <DialogDescription>Side-by-side comparison of import data and existing database record</DialogDescription>
            </DialogHeader>
            {compareItem && (
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <h4 className="font-semibold text-primary mb-3">Import Data</h4>
                  {parsedRows[compareItem.input_index] && (
                    <dl className="space-y-2">
                      {Object.entries(parsedRows[compareItem.input_index]).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-xs text-muted-foreground">{key}</dt>
                          <dd className="text-sm">{value != null ? String(value) : '-'}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                <div>
                  <h4 className="font-semibold text-green-400 mb-3">Existing Data</h4>
                  {compareItem.existing_data ? (
                    <dl className="space-y-2">
                      {Object.entries(compareItem.existing_data).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-xs text-muted-foreground">{key}</dt>
                          <dd className="text-sm">{value != null ? String(value) : '-'}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">
                      {compareItem.existing_name} ({compareItem.existing_country})
                    </p>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
