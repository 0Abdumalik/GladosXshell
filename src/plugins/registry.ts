import type { MenuItem } from '../menu'
import { type BuiltinPanel, PANEL_NAMES } from '../settings-model'
import type {
  CommandDef,
  MenuContexts,
  MenuProvider,
  MenuWhere,
  PanelDef,
  Services,
  SettingsSectionDef,
  SnippetDef,
  StatusItem,
  TerminalAddon,
  ThemeDef,
} from './api'
import { Bag } from './bag'
import { formatKey, type KeyChord, type KeyEventLike, matchesKey, parseKey } from './keys'

/** Everything active plugins contribute. Later contributions win over earlier ones. */
export const commands = new Bag<CommandDef>()
export const keybindings = new Bag<{ chord: KeyChord; command: string }>()
export const menus = new Bag<{ where: MenuWhere; provider: MenuProvider<MenuWhere> }>()
export const panels = new Bag<PanelDef>()
export const statusItems = new Bag<StatusItem>()
export const settingsSections = new Bag<SettingsSectionDef>()
export const themes = new Bag<ThemeDef>()
export const snippets = new Bag<SnippetDef>()
export const terminalAddons = new Bag<TerminalAddon>()
const services = new Bag<{ name: keyof Services; service: unknown }>()

let errorSink: (error: unknown) => void = () => {}

/** Where failures inside contributed callbacks go (the app log). */
export function setErrorSink(sink: (error: unknown) => void): void {
  errorSink = sink
}

export function reportContributionError(error: unknown): void {
  errorSink(error)
}

function last<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return items[i]
  return undefined
}

export function command(id: string): CommandDef | undefined {
  return last(commands.list(), (c) => c.id === id)
}

export function commandAvailable(def: CommandDef): boolean {
  try {
    return def.enabled?.() ?? true
  } catch (error) {
    errorSink(error)
    return false
  }
}

/** Runs a command; false when it is missing or unavailable right now. */
export async function runCommand(id: string): Promise<boolean> {
  const def = command(id)
  if (!def || !commandAvailable(def)) return false
  await def.run()
  return true
}

export function addKeybinding(key: string, commandId: string): (() => void) | null {
  const chord = parseKey(key)
  return chord ? keybindings.add({ chord, command: commandId }) : null
}

/** The shortcut shown next to a command. */
export function keyFor(commandId: string): string | null {
  const binding = last(keybindings.list(), (b) => b.command === commandId)
  return binding ? formatKey(binding.chord) : null
}

/** Command the key press triggers, if any available command is bound to it. */
export function commandForKey(event: KeyEventLike): string | null {
  const bindings = keybindings.list()
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i]
    if (!matchesKey(binding.chord, event)) continue
    const def = command(binding.command)
    if (def && commandAvailable(def)) return def.id
  }
  return null
}

/** Contributed items for a menu, after a separator; empty when nobody contributes. */
export function menuItems<W extends MenuWhere>(where: W, context: MenuContexts[W]): MenuItem[] {
  const items: MenuItem[] = []
  for (const entry of menus.list()) {
    if (entry.where !== where) continue
    try {
      items.push(...(entry.provider as MenuProvider<W>)(context))
    } catch (error) {
      errorSink(error)
    }
  }
  while (items[0] === 'separator') items.shift()
  while (items.at(-1) === 'separator') items.pop()
  return items.length > 0 ? ['separator', ...items] : []
}

export function provideService<K extends keyof Services>(name: K, service: Services[K]) {
  return services.add({ name, service })
}

export function service<K extends keyof Services>(name: K): Services[K] | undefined {
  return last(services.list(), (s) => s.name === name)?.service as Services[K] | undefined
}

export function theme(id: string): ThemeDef | undefined {
  return last(themes.list(), (t) => t.id === id)
}

export function panelDef(id: string): PanelDef | undefined {
  return last(panels.list(), (p) => p.id === id)
}

export function panelTitle(id: string): string {
  return panelDef(id)?.title ?? PANEL_NAMES[id as BuiltinPanel] ?? id
}
