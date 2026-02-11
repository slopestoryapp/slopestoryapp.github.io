import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'

interface LoginPageProps {
  onSignIn: (email: string, password: string) => void
  loading: boolean
  error: string | null
}

export function LoginPage({ onSignIn, loading, error }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email && password) onSignIn(email, password)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slope-slate-dark to-slope-slate-darker">
      <img
        src="https://rnudbfdhrenesamdjzdk.supabase.co/storage/v1/object/public/brand-assets/logo-light.png"
        alt="SlopeStory"
        className="h-12 mb-6"
      />
      <h1 className="text-2xl font-semibold mb-2">Admin Dashboard</h1>
      <p className="text-muted-foreground mb-8">Sign in to manage SlopeStory</p>

      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-card border border-border rounded-2xl p-8 space-y-3">
        <Input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" disabled={loading || !email || !password}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Sign In
        </Button>
        {error && (
          <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
      </form>
    </div>
  )
}
