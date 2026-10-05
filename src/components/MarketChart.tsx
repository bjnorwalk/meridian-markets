import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Bar } from '../types/market'

interface MarketChartProps {
  bars: Bar[]
  averageCost?: number | null
}

type ChartTheme = {
  surface: string
  text: string
  textMuted: string
  border: string
  borderSubtle: string
  accent: string
  positive: string
  negative: string
}

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback
}

function colorWithAlpha(color: string, alpha: number) {
  const trimmed = color.trim()
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (!hex) return trimmed

  const expanded = hex.length === 3
    ? hex.split('').map((char) => char + char).join('')
    : hex
  const value = Number.parseInt(expanded, 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function readChartTheme(): ChartTheme {
  const styles = getComputedStyle(document.documentElement)
  return {
    surface: cssVar(styles, '--surface', '#ffffff'),
    text: cssVar(styles, '--text', '#111827'),
    textMuted: cssVar(styles, '--text-muted', '#5f6673'),
    border: cssVar(styles, '--border', '#d9dde3'),
    borderSubtle: cssVar(styles, '--border-subtle', '#eef1f4'),
    accent: cssVar(styles, '--accent', '#2457d6'),
    positive: cssVar(styles, '--positive', '#107c41'),
    negative: cssVar(styles, '--negative', '#b42318'),
  }
}

function chartOptions(theme: ChartTheme) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: theme.surface },
      textColor: theme.textMuted,
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    },
    grid: {
      vertLines: { color: theme.borderSubtle },
      horzLines: { color: theme.borderSubtle },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: theme.border, labelBackgroundColor: theme.text },
      horzLine: { color: theme.border, labelBackgroundColor: theme.text },
    },
    rightPriceScale: {
      borderColor: theme.border,
      scaleMargins: { top: 0.08, bottom: 0.24 },
    },
    timeScale: {
      borderColor: theme.border,
      timeVisible: true,
      secondsVisible: false,
    },
  }
}

function candleOptions(theme: ChartTheme) {
  return {
    upColor: theme.positive,
    downColor: theme.negative,
    borderUpColor: theme.positive,
    borderDownColor: theme.negative,
    wickUpColor: theme.positive,
    wickDownColor: theme.negative,
    priceLineColor: theme.text,
  }
}

function volumeData(bars: Bar[], theme: ChartTheme) {
  return bars.map((bar) => ({
    time: bar.time as UTCTimestamp,
    value: bar.volume,
    color: bar.close >= bar.open
      ? colorWithAlpha(theme.positive, 0.22)
      : colorWithAlpha(theme.negative, 0.22),
  }))
}

export function MarketChart({ bars, averageCost }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const averageCostLineRef = useRef<IPriceLine | null>(null)
  const barsRef = useRef<Bar[]>(bars)
  const themeRef = useRef<ChartTheme | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const initialTheme = readChartTheme()
    themeRef.current = initialTheme
    const chart = createChart(containerRef.current, {
      autoSize: true,
      ...chartOptions(initialTheme),
    })

    const candleSeries = chart.addSeries(CandlestickSeries, candleOptions(initialTheme))

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    const syncTheme = () => {
      const nextTheme = readChartTheme()
      themeRef.current = nextTheme
      chart.applyOptions(chartOptions(nextTheme))
      candleSeries.applyOptions(candleOptions(nextTheme))
      volumeSeries.setData(volumeData(barsRef.current, nextTheme))
      averageCostLineRef.current?.applyOptions({ color: nextTheme.accent })
    }

    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      averageCostLineRef.current = null
    }
  }, [])

  useEffect(() => {
    barsRef.current = bars
    const theme = themeRef.current ?? readChartTheme()
    candleSeriesRef.current?.setData(
      bars.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    )

    volumeSeriesRef.current?.setData(volumeData(bars, theme))

    if (bars.length > 0) {
      chartRef.current?.timeScale().fitContent()
    }
  }, [bars])

  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (!candleSeries) return

    if (averageCostLineRef.current) {
      candleSeries.removePriceLine(averageCostLineRef.current)
      averageCostLineRef.current = null
    }

    if (!averageCost || averageCost <= 0) return

    averageCostLineRef.current = candleSeries.createPriceLine({
      price: averageCost,
      color: '#2457d6',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Avg cost',
    })
  }, [averageCost])

  return <div className="market-chart" ref={containerRef} aria-label="Price chart" />
}
