interface StatsCardProps {
  label: string
  value: string | number
  change?: string
  subtitle?: string
}

export function StatsCard({ label, value, change, subtitle }: StatsCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-xs text-muted-foreground mb-2">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
      {change && <div className="text-xs text-success mt-1">{change}</div>}
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  )
}
