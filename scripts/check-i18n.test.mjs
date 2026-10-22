// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the sources under test are TypeScript with templates
import { describe, expect, it } from 'vitest'
import { findHtml, findRs, findTs, isChecked } from './check-i18n.mjs'

describe('check-i18n files', () => {
  it('reads TypeScript, plain JavaScript, HTML and Rust, but not tests or data', () => {
    const read = [
      'src/i18n.ts',
      'installer/ui/main.js',
      'installer/ui/index.html',
      'installer/src/ops.rs',
    ]
    for (const path of read) expect(isChecked(path)).toBe(true)
    const skipped = [
      'src/i18n.test.ts',
      'scripts/check.test.js',
      'src/env.d.ts',
      'src/completion.zh.ts',
      'installer/ui/style.css',
      'installer/ui/icon.png',
    ]
    for (const path of skipped) expect(isChecked(path)).toBe(false)
  })

  it('checks plain JavaScript dictionaries like TypeScript ones', () => {
    const src = [
      'const MESSAGES = {',
      "  done: { zh: '完成', en: 'Done', ug: 'تامام' },",
      '  installing: {',
      "    zh: '正在安装 {product}',",
      "    en: 'Installing {product}',",
      '  },',
      '}',
      'const t = (key, params = {}) => MESSAGES[key][lang].replace(/\\{(\\w+)\\}/g, (m) => m)',
      "$('finish').textContent = launch ? t('done') : '关闭'", // 9
    ].join('\n')
    expect(findTs(src)).toEqual([9])
  })
})

describe('check-i18n', () => {
  it('flags Chinese in plain strings, templates and patterns', () => {
    const src = [
      "setStatus('已保存')", // 1
      'const a = `共 ${n} 个`', // 2
      'const b = /失败/', // 3
      "const c = x ? '是' : 'no'", // 4
    ].join('\n')
    expect(findTs(src)).toEqual([1, 2, 3, 4])
  })

  it('allows comments, zh values and marked lines', () => {
    const src = [
      '// 注释',
      '/* 多行',
      '   注释 */',
      'const t = messages({',
      "  saved: { zh: '已保存 {name}', en: 'Saved {name}', ug: 'ساقلاندى' },",
      '  count: {',
      '    zh: (p) => `共 ${p.n ? `${p.n} 个` : "没有"}`,',
      '    en: (p) => `${p.n} items`,',
      "    ug: '{n}',",
      '  },',
      '  long: {',
      '    zh:',
      "      '很长的一句话',",
      "    en: 'A long sentence',",
      "    ug: 'ئۇزۇن',",
      '  },',
      '})',
      "const gbk = '简体中文' // i18n-ignore",
      '// i18n-ignore: matches the Chinese prompt sudo prints',
      'const prompt = /密码：/',
    ].join('\n')
    expect(findTs(src)).toEqual([])
  })

  it('closes a zh value at the next property', () => {
    const src = "const m = { zh: '中', en: '英' }\nh('p', { zh: 1, text: '文' })"
    expect(findTs(src)).toEqual([1, 2])
  })

  it('keeps going after nested templates and division', () => {
    const src = ['const r = a / b / c', 'const s = `x${`y${z}`}`', "f('坏')"].join('\n')
    expect(findTs(src)).toEqual([3])
  })

  it('flags HTML text outside comments', () => {
    expect(findHtml('<!-- 注释 -->\n<p>文字</p>\n<p>ok</p>')).toEqual([2])
  })
})

describe('check-i18n for Rust', () => {
  it('flags Chinese in strings, raw strings, characters and attributes', () => {
    const src = [
      'let a = "已保存";', // 1
      'let b = format!("共 {n} 个");', // 2
      'let c = r"C:\\临时";', // 3
      'let d = r#"说 "你好""#;', // 4
      "let e = '、';", // 5
      '#[error("连接失败：{0}")]', // 6
      'Connect(String),',
      'let f = "多行\\', // 8
      '  续行";', // 9
    ].join('\n')
    expect(findRs(src)).toEqual([1, 2, 3, 4, 5, 6, 8, 9])
  })

  it('allows the zh text of tr!, also with @in and a path prefix', () => {
    const src = [
      'let a = tr!("已连接 {name}", "Connected to {name}", "{name} غا ئۇلاندى");',
      'let b = crate::tr!(',
      '    "超时",',
      '    "Timed out",',
      '    "ۋاقىت ئېشىپ كەتتى",',
      ');',
      'let c = gxs_core::tr!(@in Lang::En, "就绪", "Ready", "تەييار");',
      'let d = tr!("{}", "{}", "{}", "不行");', // 8: only the first text is allowed
      'let e = str!("坏");', // 9: not tr!
      'let f = tr!(@in pick(), "好", "Good", "ياخشى", n = "坏");', // 10
    ].join('\n')
    expect(findRs(src)).toEqual([8, 9, 10])
  })

  it('allows comments, doc comments and nested block comments', () => {
    const src = [
      '// 注释',
      '/// 文档注释',
      '//! 模块文档',
      '/* 外层 /* 内层 */ 还是注释 */',
      '/** 块文档',
      '    多行 */',
      'let x = "ok"; // 行尾注释',
      'let y = "坏";', // 8
    ].join('\n')
    expect(findRs(src)).toEqual([8])
  })

  it('skips cfg(test) items and marked lines', () => {
    const src = [
      '#[cfg(test)]',
      'mod tests {',
      '    fn s() -> &\'static str { "测试 } 里的括号" }',
      '    #[test]',
      '    fn t() { assert_eq!(f(), "中文"); }',
      '}',
      'let a = "外面";', // 7
      '#[cfg(all(test, windows))]',
      'fn helper() { let _ = "测试"; }',
      '#[cfg(not(test))]',
      'fn real() { let _ = "正式"; }', // 11
      '// i18n-ignore: parses the Chinese key in Xshell sessions',
      'let key = "主机";',
      'let sep = "：" ; // i18n-ignore: data',
      '#[cfg(test)]',
      'use std::fmt;',
      'let b = "后面";', // 17
    ].join('\n')
    expect(findRs(src)).toEqual([7, 11, 17])
  })

  it('tells lifetimes and labels from characters', () => {
    const src = [
      "fn f<'a>(x: &'a str) -> &'static str { x }",
      "'outer: loop { break 'outer; }",
      "let q = '\\''; let b = b'\"'; let u = '\\u{4e2d}';",
      'let s = "坏";', // 4
      'let c = \'"\'; let t = "仍然坏";', // 5
      'let r#type = 1; let z = "坏";', // 6
    ].join('\n')
    expect(findRs(src)).toEqual([4, 5, 6])
  })

  it('skips test files by name', () => {
    expect(findRs('let a = "中文";', 'crates/gxs-core/tests/ssh.rs')).toEqual([])
    expect(findRs('let a = "中文";', 'crates/gxs-core/src/ssh.rs')).toEqual([1])
  })
})
