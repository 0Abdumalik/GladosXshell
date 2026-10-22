import type { ThemeDef } from './api'

const TOKEN_NAME = /^--gx-[a-z0-9-]+$/
const TOKEN_ID = /^[a-z0-9.-]+$/
/** Values stay plain colours and lengths: no escapes, comments, or anything that loads a URL. */
const UNSAFE_VALUE = /[{};<>\\]|\/\*|url\s*\(|image-set|@import|expression/i

const safeValue = (value: string) => value.length <= 200 && !UNSAFE_VALUE.test(value)

/** One rule per theme's CSS tokens: `:root[data-theme="id"] { --gx-…: … }`. */
export function themeTokensCss(defs: readonly ThemeDef[]): string {
  const rules: string[] = []
  for (const def of defs) {
    if (!def.tokens || !TOKEN_ID.test(def.id)) continue
    const lines = Object.entries(def.tokens)
      .filter(([name, value]) => TOKEN_NAME.test(name) && safeValue(value))
      .map(([name, value]) => `  ${name}: ${value};`)
    if (lines.length > 0) rules.push(`:root[data-theme="${def.id}"] {\n${lines.join('\n')}\n}`)
  }
  return rules.join('\n')
}
