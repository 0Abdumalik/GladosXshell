// Builds the app, then the setup program that carries it: node scripts/build-setup.mjs debug|release
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const flavor = process.argv[2] ?? 'release'
if (flavor !== 'debug' && flavor !== 'release') {
  console.error('用法: node scripts/build-setup.mjs debug|release')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const release = join(root, 'target', 'release')
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))

function run(command, args, env = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
}

const tauriCli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const appArgs = [tauriCli, 'build', '--no-bundle']
if (flavor === 'debug') {
  appArgs.push('--config', 'src-tauri/tauri.debug.conf.json', '--features', 'debug-build')
}
run(process.execPath, appArgs)

const payload = join(release, 'gladosxshell.exe')
run('cargo', ['build', '--release', '-p', 'gladosxshell-setup'], {
  GXS_PAYLOAD: payload,
  GXS_FLAVOR: flavor,
})

const outDir = join(release, 'setup')
mkdirSync(outDir, { recursive: true })
const name = `GladosXshell${flavor === 'debug' ? '-Debug' : ''}-Setup-${conf.version}.exe`
const output = join(outDir, name)
copyFileSync(join(release, 'gladosxshell-setup.exe'), output)
const mb = (statSync(output).size / 1024 / 1024).toFixed(1)
console.log(`\n安装程序: ${output} (${mb} MB)`)
