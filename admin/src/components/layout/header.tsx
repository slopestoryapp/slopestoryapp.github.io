import { RefreshCw, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HeaderProps {
  title: string
  subtitle: string
  onRefresh?: () => void
  refreshing?: boolean
  onSearchOpen?: () => void
}

export function Header({ title, subtitle, onRefresh, refreshing, onSearchOpen }: HeaderProps) {
  return (
    <header className="bg-slope-slate-dark border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 z-30">
      <div className="pl-12 lg:pl-0">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {onSearchOpen && (
          <button
            onClick={onSearchOpen}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:text-foreground hover:border-primary/50 transition-colors"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline text-[10px] bg-background px-1.5 py-0.5 rounded border border-border font-mono">
              ⌘K
            </kbd>
          </button>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:text-primary hover:border-primary/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            Refresh
          </button>
        )}
      </div>
    </header>
  )
}
