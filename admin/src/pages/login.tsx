import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'

interface LoginPageProps {
  onSignIn: (email: string, password: string) => void
  loading: boolean
  error: string | null
  unlocking?: boolean
}

export function LoginPage({ onSignIn, loading, error, unlocking }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email && password) onSignIn(email, password)
  }

  // Detect if error is actually a success message (starts with ✅)
  const isSuccess = error?.startsWith('✅')
  const isLocked = error?.startsWith('🔒')

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slope-slate-dark to-slope-slate-darker">
      <img
        src="https://photos.slopestory.com/brand-assets/logo-light.png"
        alt="SlopeStory"
        className="h-12 mb-6"
      />
      <h1 className="text-2xl font-semibold mb-2">Admin Dashboard</h1>
      <p className="text-muted-foreground mb-8">
        {unlocking ? 'Unlocking your account...' : 'Sign in to manage SlopeStory'}
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-card border border-border rounded-2xl p-8 space-y-3">
        <Input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          disabled={unlocking}
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={unlocking}
        />
        <Button type="submit" className="w-full" disabled={loading || unlocking || !email || !password}>
          {(loading || unlocking) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {unlocking ? 'Unlocking...' : 'Sign In'}
        </Button>
        {error && (
          <div
            className={`px-4 py-3 rounded-lg text-sm ${
              isSuccess
                ? 'bg-green-500/10 text-green-400'
                : isLocked
                ? 'bg-amber-500/10 text-amber-400'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {error}
          </div>
        )}
      </form>
    </div>
  )
}
