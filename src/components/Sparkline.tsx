import { useMemo } from 'react'
import type { SparklinePoint } from '../types/market'

export function Sparkline({ data, width = 72, height = 28 }: { data: SparklinePoint[]; width?: number; height?: number }) {
  const path = useMemo(() => {
    if (data.length < 2) return null

    const values = data.map((p) => p.c)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const pad = 1

    const points = data.map((p, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2)
      const y = height - pad - ((p.c - min) / range) * (height - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })

    return points.join(' ')
  }, [data, width, height])

  if (!path) return <svg width={width} height={height} />

  const isUp = data[data.length - 1].c >= data[0].c

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke={isUp ? '#107c41' : '#b42318'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
