import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { ADMIN_EMAILS } from '@/lib/constants'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
  })

  const isAdmin = state.user?.email
    ? ADMIN_EMAILS.includes(state.user.email.toLowerCase())
    : false

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setState({ user: null, session: null, loading: false, error: error.message })
        return
      }
      if (session && ADMIN_EMAILS.includes(session.user.email?.toLowerCase() ?? '')) {
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

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setState(prev => ({ ...prev, loading: false, error: error.message }))
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setState({ user: null, session: null, loading: false, error: null })
  }, [])

  return { ...state, isAdmin, signIn, signOut }
}
