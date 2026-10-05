export function Metric({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
  title?: string
}) {
  return (
    <div className="metric" title={title}>
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
    </div>
  )
}
