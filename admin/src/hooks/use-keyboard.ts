import { useEffect } from 'react'
import type { PageId } from '@/lib/constants'

const PAGE_KEYS: Record<string, PageId> = {
  '1': 'overview',
  '2': 'submissions',
  '3': 'feature-photos',
  '4': 'resorts',
  '5': 'users',
  '6': 'support',
  '7': 'roadmap',
  '8': 'visits',
  '9': 'analytics',
}

interface UseKeyboardOptions {
  onNavigate: (page: PageId) => void
  onSearch: () => void
}

export function useKeyboard({ onNavigate, onSearch }: UseKeyboardOptions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable

      // Cmd/Ctrl+K for search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onSearch()
        return
      }

      // Don't handle other shortcuts when in input
      if (isInput) return

      // Number keys for tab navigation
      if (PAGE_KEYS[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onNavigate(PAGE_KEYS[e.key])
        return
      }

      // / to focus search
      if (e.key === '/') {
        e.preventDefault()
        onSearch()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNavigate, onSearch])
}
