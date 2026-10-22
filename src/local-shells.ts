import { invoke } from '@tauri-apps/api/core'

export interface LocalShell {
  /** `cmd`, `powershell`, `pwsh`, `git-bash`, `wsl:<distro>`, or a path on Unix. */
  id: string
  name: string
  program: string
}

let known: LocalShell[] = []
let loading: Promise<LocalShell[]> | null = null

/** The shells found by the last detection; empty until `loadShells` resolves. */
export function localShells(): readonly LocalShell[] {
  return known
}

/** Looks for installed shells again; concurrent calls share one detection. */
export function loadShells(): Promise<LocalShell[]> {
  loading ??= invoke<LocalShell[]>('local_shells')
    .then((list) => {
      known = list
      return list
    })
    .catch(() => known)
    .finally(() => {
      loading = null
    })
  return loading
}
