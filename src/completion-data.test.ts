import { describe, expect, it } from 'vitest'
import type { CommandSpec } from './completion-data'
import { SPECS as en } from './completion-data.en'
import { SPECS as ug } from './completion-data.ug'
import { SPECS as zh } from './completion-data.zh'
import { parseOptions, parseValues, pathValue } from './spec-completion'

type Spec = CommandSpec | string

const values = (list: string | undefined) => parseValues(list).map((v) => v.text)
const each = <T>(record: Record<string, T> | undefined, f: (item: T) => unknown) =>
  record && Object.fromEntries(Object.entries(record).map(([key, item]) => [key, f(item)]))

/** Everything about a spec that completion acts on, leaving out the descriptions. */
function shape(spec: Spec): unknown {
  if (typeof spec === 'string') return 'leaf'
  return {
    p: spec.p,
    c: spec.c,
    o: parseOptions(spec.o).map((o) => [o.flags, o.value === null ? null : pathValue(o.value)]),
    v: values(spec.v),
    a: each(spec.a, values),
    s: each(spec.s, shape),
  }
}

/** Every description and value name, to check that none was left out or left in Chinese. */
function texts(spec: Spec): string[] {
  if (typeof spec === 'string') return [spec]
  return [
    spec.d,
    ...parseOptions(spec.o).flatMap((o) => [o.d, o.value ?? 'none']),
    ...parseValues(spec.v).map((v) => v.d || 'none'),
    ...Object.values(spec.a ?? {}).flatMap((list) => parseValues(list).map((v) => v.d || 'none')),
    ...Object.values(spec.s ?? {}).flatMap(texts),
  ]
}

describe.each([
  ['en', en],
  ['ug', ug],
])('%s completion data', (_, specs) => {
  it('has the same commands, flags and values as the Chinese data', () => {
    expect(each(specs, shape)).toEqual(each(zh, shape))
  })

  it('describes everything the Chinese data describes, with no Chinese left', () => {
    const own = Object.values(specs).flatMap(texts)
    const source = Object.values(zh).flatMap(texts)
    expect(own.map((text) => text === '')).toEqual(source.map((text) => text === ''))
    expect(own.filter((text) => /[一-鿿（），]/.test(text))).toEqual([])
  })
})
