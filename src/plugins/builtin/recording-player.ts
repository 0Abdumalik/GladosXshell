import { invoke } from '@tauri-apps/api/core'
import { Terminal } from '@xterm/xterm'
import { modal } from '../../dialogs'
import { h } from '../../dom'
import { ltr, messages, pl } from '../../i18n'
import { icon } from '../../icons'
import { viewerOptions } from '../../terminal'
import {
  type Cast,
  type CastEvent,
  capIdle,
  formatClock,
  indexAfter,
  parseCast,
  parseSize,
} from './recording-model'

const t = messages({
  title: { zh: '录像：{name}', en: 'Recording: {name}', ug: 'سىن: {name}' },
  play: { zh: '播放', en: 'Play', ug: 'قوي' },
  pause: { zh: '暂停', en: 'Pause', ug: 'ۋاقتىنچە توختات' },
  position: { zh: '播放位置', en: 'Playback position', ug: 'قويۇش ئورنى' },
  speed: { zh: '播放速度', en: 'Playback speed', ug: 'قويۇش تېزلىكى' },
  idleTitle: {
    zh: '超过 {n} 秒的停顿按 {n} 秒播放',
    en: (p) => `Plays pauses longer than ${pl('second')(p)} as ${pl('second')(p)}`,
    ug: '{n} سېكۇنتتىن ئۇزۇن توختاشلار {n} سېكۇنت قىلىپ قويۇلىدۇ',
  },
  skipIdle: { zh: '跳过空闲', en: 'Skip idle time', ug: 'بىكار ۋاقىتنى ئاتلا' },
})

const IDLE_CAP = 2
const SPEEDS = [0.5, 1, 2, 4, 8]

/** Opens a recording from the recordings folder in a player dialog. */
export async function playRecording(name: string): Promise<void> {
  const cast = parseCast(await invoke<string>('recording_read', { name }))
  if (cast instanceof Error) throw cast
  showPlayer(cast, name)
}

function showPlayer(cast: Cast, name: string): void {
  const parts = modal('recording-player', t('title', { name: ltr(cast.title || name) }), 'xl')
  const screen = h('div', { class: 'cast-screen' })
  const toggle = h('button', {
    type: 'button',
    class: 'icon-button cast-toggle',
    'aria-label': t('play'),
  })
  const slider = h('input', {
    type: 'range',
    class: 'cast-slider',
    min: '0',
    step: '0.1',
    value: '0',
    'aria-label': t('position'),
  })
  const clock = h('span', { class: 'cast-clock', 'aria-live': 'off' })
  const speed = h(
    'select',
    { 'aria-label': t('speed') },
    ...SPEEDS.map((s) => h('option', { value: String(s), text: `${s}×` })),
  )
  speed.value = '1'
  const idle = h('input', { type: 'checkbox', checked: true })
  const controls = h(
    'div',
    { class: 'cast-controls' },
    toggle,
    slider,
    clock,
    speed,
    h(
      'label',
      { class: 'check', title: t('idleTitle', { n: IDLE_CAP }) },
      idle,
      ' ',
      t('skipIdle'),
    ),
  )
  parts.body.classList.add('cast-body')
  parts.body.append(screen, controls)

  const options = viewerOptions()
  screen.style.setProperty('--cast-bg', options.theme.background)
  const term = new Terminal({ ...options, cols: cast.width, rows: cast.height })
  term.open(screen)

  let events: CastEvent[] = capIdle(cast.events, IDLE_CAP)
  let duration = events.at(-1)?.[0] ?? 0
  let next = 0
  let position = 0
  let playing = false
  let startedAt = 0
  let startedFrom = 0
  let frame = 0

  /** Writes every event up to `time`, joining output so a long seek is one write. */
  const advance = (time: number) => {
    const end = indexAfter(events, time)
    let text = ''
    for (; next < end; next++) {
      const [, code, data] = events[next] as CastEvent
      if (code === 'o') {
        text += data
        continue
      }
      const size = parseSize(data)
      if (!size) continue
      if (text) term.write(text)
      text = ''
      term.resize(size.cols, size.rows)
    }
    if (text) term.write(text)
    position = Math.min(time, duration)
  }

  const show = () => {
    slider.max = String(duration)
    slider.value = String(position)
    clock.textContent = `${formatClock(position)} / ${formatClock(duration)}`
    toggle.replaceChildren(icon(playing ? 'pause' : 'play'))
    toggle.setAttribute('aria-label', playing ? t('pause') : t('play'))
  }

  const tick = () => {
    advance(startedFrom + ((performance.now() - startedAt) / 1000) * Number(speed.value))
    if (next >= events.length) playing = false
    show()
    if (playing) frame = requestAnimationFrame(tick)
  }

  const pause = () => {
    playing = false
    cancelAnimationFrame(frame)
    show()
  }

  const play = () => {
    if (next >= events.length) seek(0)
    playing = true
    startedAt = performance.now()
    startedFrom = position
    frame = requestAnimationFrame(tick)
    show()
  }

  /** Replays from the start; xterm can't step backwards. */
  const seek = (time: number) => {
    const target = Math.max(0, Math.min(time, duration))
    if (target < position || next === 0) {
      term.reset()
      term.resize(cast.width, cast.height)
      next = 0
    }
    advance(target)
    startedAt = performance.now()
    startedFrom = position
    show()
  }

  toggle.onclick = () => (playing ? pause() : play())
  slider.oninput = () => seek(Number(slider.value))
  speed.onchange = () => {
    startedAt = performance.now()
    startedFrom = position
  }
  idle.onchange = () => {
    // Keep the same place in the recording on the new timeline.
    const done = next
    events = idle.checked ? capIdle(cast.events, IDLE_CAP) : cast.events
    duration = events.at(-1)?.[0] ?? 0
    const at = done > 0 ? (events[done - 1]?.[0] ?? 0) : 0
    position = Infinity
    seek(at)
  }
  parts.dialog.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement
    if (target.matches('input, select') && target !== idle) return
    if (event.key === ' ') {
      event.preventDefault()
      if (playing) pause()
      else play()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      seek(position + (event.key === 'ArrowLeft' ? -5 : 5))
    }
  })
  parts.dialog.addEventListener('close', () => {
    cancelAnimationFrame(frame)
    term.dispose()
    parts.dialog.remove()
  })

  show()
  parts.dialog.showModal()
  toggle.focus()
  play()
}
