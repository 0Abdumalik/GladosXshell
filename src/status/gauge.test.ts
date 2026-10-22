import { describe, expect, it } from 'vitest'
import { clamp01, meterLevel, ringDash } from './gauge'

describe('ringDash', () => {
  it('leaves the unused share of the circle as offset', () => {
    const { length, offset } = ringDash(0.25, 50)
    expect(length).toBeCloseTo(314.159, 2)
    expect(offset).toBeCloseTo(235.619, 2)
  })

  it('clamps out-of-range and missing values', () => {
    expect(ringDash(1.4, 10).offset).toBe(0)
    expect(ringDash(-0.2, 10).offset).toBeCloseTo(62.832, 2)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})

describe('meterLevel', () => {
  it('turns amber at 70% and red at 90%', () => {
    expect(meterLevel(0.69)).toBe('ok')
    expect(meterLevel(0.7)).toBe('high')
    expect(meterLevel(0.9)).toBe('full')
  })
})
