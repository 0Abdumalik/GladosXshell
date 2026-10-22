import { h } from '../dom'

export type Level = 'ok' | 'high' | 'full'

/** The meter colour for a used share between 0 and 1. */
export function meterLevel(fraction: number): Level {
  return fraction >= 0.9 ? 'full' : fraction >= 0.7 ? 'high' : 'ok'
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

/** Stroke dash values that draw `fraction` of a circle of `radius`. */
export function ringDash(fraction: number, radius: number): { length: number; offset: number } {
  const length = 2 * Math.PI * radius
  return { length, offset: length * (1 - clamp01(fraction)) }
}

const SIZE = 120
const STROKE = 10
const RADIUS = (SIZE - STROKE) / 2

const SVG = 'http://www.w3.org/2000/svg'

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag)
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
  return element
}

export interface RingGauge {
  element: HTMLElement
  /** `fraction` null draws an empty ring; `label` is the figure in the middle. */
  set(fraction: number | null, label: string, description: string): void
}

/** A round meter; the arc animates through stroke-dashoffset only. */
export function ringGauge(name: string): RingGauge {
  const { length } = ringDash(0, RADIUS)
  const arc = svg('circle', {
    class: 'ring-arc',
    cx: SIZE / 2,
    cy: SIZE / 2,
    r: RADIUS,
    'stroke-width': STROKE,
    'stroke-dasharray': length,
    'stroke-dashoffset': length,
    transform: `rotate(-90 ${SIZE / 2} ${SIZE / 2})`,
  })
  const picture = svg('svg', { class: 'ring-svg', viewBox: `0 0 ${SIZE} ${SIZE}` })
  picture.setAttribute('aria-hidden', 'true')
  picture.append(
    svg('circle', {
      class: 'ring-track',
      cx: SIZE / 2,
      cy: SIZE / 2,
      r: RADIUS,
      'stroke-width': STROKE,
    }),
    arc,
  )
  const value = h('span', { class: 'ring-value num' })
  const element = h(
    'div',
    {
      class: 'ring',
      role: 'meter',
      'aria-label': name,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    },
    picture,
    value,
  )
  return {
    element,
    set(fraction, label, description) {
      const f = fraction === null ? 0 : clamp01(fraction)
      arc.style.strokeDashoffset = String(ringDash(f, RADIUS).offset)
      element.dataset.level = meterLevel(f)
      element.setAttribute('aria-valuenow', String(Math.round(f * 100)))
      element.setAttribute('aria-valuetext', description)
      value.textContent = label
    },
  }
}
