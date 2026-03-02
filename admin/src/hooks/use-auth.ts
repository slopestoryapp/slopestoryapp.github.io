import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { ADMIN_EMAILS, SUPABASE_URL } from '@/lib/constants'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
}

// Helper to call admin login check edge function
async function callAdminLoginCheck(action: string, data: Record<string, string>) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-login-check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...data }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Request failed')
  }

  return response.json()
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
  })
  const [unlocking, setUnlocking] = useState(false)

  const isAdmin = state.user?.email
    ? ADMIN_EMAILS.includes(state.user.email.toLowerCase())
    : false

  // Check for unlock token in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const unlockEmail = params.get('unlock')
    const unlockToken = params.get('token')

    if (unlockEmail && unlockToken) {
      setUnlocking(true)
      callAdminLoginCheck('unlock', { email: unlockEmail, token: unlockToken })
        .then(() => {
          setState(prev => ({
            ...prev,
            error: '✅ Account unlocked successfully! You can now sign in.'
          }))
          // Clean URL
          window.history.replaceState({}, '', window.location.pathname)
        })
        .catch((error) => {
          setState(prev => ({
            ...prev,
            error: `Unlock failed: ${error.message}`
          }))
        })
        .finally(() => {
          setUnlocking(false)
        })
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setState({ user: null, session: null, loading: false, error: error.message })
        return
      }
      if (session && ADMIN_EMAILS.includes(session.user.email?.toLowerCase() ?? '')) {
        // Reset login attempts on successful session restore
        const email = session.user.email!
        callAdminLoginCheck('record_success', { email }).catch(console.error)
        setState({ user: session.user, session, loading: false, error: null })
      } else if (session) {
        supabase.auth.signOut()
        setState({ user: null, session: null, loading: false, error: 'Access denied. Not authorized.' })
      } else {
        setState({ user: null, session: null, loading: false, error: null })
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && ADMIN_EMAILS.includes(session.user.email?.toLowerCase() ?? '')) {
        // Reset login attempts on successful auth change
        const email = session.user.email!
        callAdminLoginCheck('record_success', { email }).catch(console.error)
        setState({ user: session.user, session, loading: false, error: null })
      } else if (session) {
        supabase.auth.signOut()
        setState({ user: null, session: null, loading: false, error: 'Access denied. Not authorized.' })
      } else {
        setState(prev => ({ ...prev, user: null, session: null, loading: false }))
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }))

    if (!ADMIN_EMAILS.includes(email.toLowerCase())) {
      setState(prev => ({ ...prev, loading: false, error: 'Access denied. Not authorized.' }))
      return
    }

    try {
      // Check if account is locked
      const lockCheck = await callAdminLoginCheck('check', { email })

      if (lockCheck.locked) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: '🔒 Account locked due to too many failed attempts. Check your email for an unlock link, or wait 1 hour.'
        }))
        return
      }

      // Attempt login
      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        // Record failed attempt
        const failureResult = await callAdminLoginCheck('record_failure', { email })

        let errorMessage = error.message
        if (failureResult.locked) {
          errorMessage = '🔒 Account locked after 3 failed attempts. Check your email for an unlock link.'
        } else if (failureResult.attempts >= 2) {
          const remaining = 3 - failureResult.attempts
          errorMessage = `${error.message} (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining before lockout)`
        }

        setState(prev => ({ ...prev, loading: false, error: errorMessage }))
      } else {
        // Success - attempts reset via onAuthStateChange
        setState(prev => ({ ...prev, loading: false, error: null }))
      }
    } catch (error) {
      console.error('Login check error:', error)
      // Fail open - allow attempt if edge function unavailable
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setState(prev => ({ ...prev, loading: false, error: authError.message }))
      }
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setState({ user: null, session: null, loading: false, error: null })
  }, [])

  return { ...state, isAdmin, signIn, signOut, unlocking }
}
