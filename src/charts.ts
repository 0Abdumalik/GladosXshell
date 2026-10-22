import { h } from './dom'

export const HISTORY = 120

export type Sample = number | null

export interface Series {
  values: readonly Sample[]
  /** A CSS custom property name such as `--gx-chart-rx`, resolved at paint time. */
  color: string
  fill?: boolean
}

/** Appends to a fixed-length window, dropping the oldest samples. */
export function pushSample(list: Sample[], value: Sample): void {
  list.push(value)
  if (list.length > HISTORY) list.splice(0, list.length - HISTORY)
}

/** Axis maximum rounded up to 1, 2 or 5 × 10ⁿ (or × 1024ᵏ for byte values). */
export function niceMax(value: number, bytes = false): number {
  if (!(value > 0)) return 1
  let scale = 1
  if (bytes) {
    while (value / scale >= 1024) scale *= 1024
  }
  const v = value / scale
  const power = 10 ** Math.floor(Math.log10(v))
  const step = [1, 2, 5, 10].find((s) => s * power >= v) ?? 10
  return step * power * scale
}

export function seriesMax(series: readonly Series[]): number {
  let max = 0
  for (const s of series) for (const v of s.values) if (v !== null && v > max) max = v
  return max
}

/** A canvas line chart that keeps its data and repaints itself on resize. */
export class Chart {
  readonly element: HTMLCanvasElement
  private series: readonly Series[] = []
  private max = 1
  private maxLabel = ''

  constructor(name: string) {
    this.element = h('canvas', { class: 'gx-chart', role: 'img', 'aria-label': name })
    new ResizeObserver(() => this.paint()).observe(this.element)
  }

  update(series: readonly Series[], max: number, maxLabel: string, description: string): void {
    this.series = series
    this.max = max
    this.maxLabel = maxLabel
    this.element.setAttribute('aria-label', description)
    this.paint()
  }

  paint(): void {
    const canvas = this.element
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    const ratio = window.devicePixelRatio || 1
    const pw = Math.round(width * ratio)
    const ph = Math.round(height * ratio)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const style = getComputedStyle(canvas)
    const color = (name: string) => style.getPropertyValue(name).trim() || style.color

    ctx.strokeStyle = color('--gx-chart-grid')
    ctx.lineWidth = 1
    for (const f of [0.25, 0.5, 0.75]) {
      const y = Math.round(height * f) + 0.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    const top = 2
    const usable = height - top - 1
    const step = width / (HISTORY - 1)
    const yOf = (v: number) => top + usable * (1 - Math.min(v, this.max) / this.max)
    for (const s of this.series) {
      const n = s.values.length
      const xOf = (i: number) => width - (n - 1 - i) * step
      const stroke = color(s.color)
      ctx.strokeStyle = stroke
      ctx.fillStyle = stroke
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      // Each unbroken run (between null gaps) is drawn and filled on its own.
      let run: number[] = []
      const flush = () => {
        if (run.length === 0) return
        ctx.beginPath()
        run.forEach((i, k) => {
          const v = s.values[i] as number
          if (k === 0) ctx.moveTo(xOf(i), yOf(v))
          else ctx.lineTo(xOf(i), yOf(v))
        })
        ctx.stroke()
        if (s.fill && run.length > 1) {
          ctx.lineTo(xOf(run[run.length - 1]), height)
          ctx.lineTo(xOf(run[0]), height)
          ctx.closePath()
          ctx.globalAlpha = 0.18
          ctx.fill()
          ctx.globalAlpha = 1
        }
        run = []
      }
      for (let i = 0; i < n; i++) {
        if (s.values[i] === null) flush()
        else run.push(i)
      }
      flush()
    }

    if (this.maxLabel) {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      ctx.font = `${rem * 0.6875}px ${style.fontFamily}`
      ctx.textBaseline = 'top'
      // The label sits in the chart's top-left corner; a right-to-left page would draw it leftwards
      // from there, off the canvas.
      ctx.direction = 'ltr'
      ctx.fillStyle = color('--gx-text-subtle')
      ctx.fillText(this.maxLabel, 4, 3)
    }
  }
}
