import { describe, expect, it } from 'vitest'
import {
  dockerActions,
  dockerShellCommand,
  explainError,
  formatAge,
  kubeFollowCommand,
  kubeShellCommand,
  parseDockerList,
  parseNamespaces,
  parsePods,
  parseProbe,
} from './containers-model'

describe('parseProbe', () => {
  it('reads each tool line', () => {
    expect(parseProbe('docker=yes\nkubectl=no\n')).toEqual({ docker: true, kubectl: false })
    expect(parseProbe('')).toEqual({ docker: false, kubectl: false })
  })
})

describe('parseDockerList', () => {
  it('reads one JSON object per line and skips noise', () => {
    const text = [
      '{"ID":"9ca2","Names":"gx-loop","Image":"gx/busybox:1","Command":"\\"sh -c \'while\'\\"","State":"running","Status":"Up 3 minutes","Ports":"","RunningFor":"3 minutes ago"}',
      'WARNING: something',
      '{"ID":"e2ae","Names":"gx-stopped,alias","Image":"gx/busybox:1","Command":"\\"true\\"","Status":"Exited (0) 2 hours ago","Ports":"","CreatedAt":"2026-10-07"}',
      '',
    ].join('\n')
    const rows = parseDockerList(text)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: '9ca2',
      name: 'gx-loop',
      state: 'running',
      command: "sh -c 'while'",
    })
    expect(rows[1]).toMatchObject({ name: 'gx-stopped', state: 'exited', created: '2026-10-07' })
  })

  it('works out paused from an old Status sentence', () => {
    const rows = parseDockerList('{"ID":"a","Status":"Up 1 second (Paused)"}')
    expect(rows[0]?.state).toBe('paused')
  })
})

describe('dockerActions', () => {
  it('offers what the state allows', () => {
    expect(dockerActions('running')).toEqual(['restart', 'pause', 'stop'])
    expect(dockerActions('paused')).toEqual(['unpause', 'stop'])
    expect(dockerActions('exited')).toEqual(['start', 'rm'])
  })
})

describe('parsePods', () => {
  const pod = (name: string, extra: Record<string, unknown>) => ({
    metadata: { namespace: 'default', name, creationTimestamp: '2026-10-07T00:00:00Z' },
    spec: { nodeName: 'malik', containers: [{ name: 'app' }, { name: 'side' }] },
    ...extra,
  })

  it('computes ready, restarts and the kubectl status', () => {
    const json = JSON.stringify({
      items: [
        pod('ok', {
          status: {
            phase: 'Running',
            containerStatuses: [
              { ready: true, restartCount: 1, state: { running: {} } },
              { ready: true, restartCount: 2, state: { running: {} } },
            ],
          },
        }),
        pod('crash', {
          status: {
            phase: 'Running',
            containerStatuses: [
              { ready: false, restartCount: 5, state: { waiting: { reason: 'CrashLoopBackOff' } } },
            ],
          },
        }),
        pod('done', {
          status: {
            phase: 'Succeeded',
            containerStatuses: [{ state: { terminated: { exitCode: 3 } } }],
          },
        }),
        pod('init', {
          status: {
            phase: 'Pending',
            initContainerStatuses: [{ state: { waiting: { reason: 'ImagePullBackOff' } } }],
          },
        }),
        {
          ...pod('gone', { status: { phase: 'Running' } }),
          metadata: { name: 'gone', deletionTimestamp: 'x' },
        },
      ],
    })
    const pods = parsePods(json)
    expect(pods.map((p) => p.status)).toEqual([
      'Running',
      'CrashLoopBackOff',
      'Exit:3',
      'Init:ImagePullBackOff',
      'Terminating',
    ])
    expect(pods[0]).toMatchObject({
      ready: '2/2',
      restarts: 3,
      node: 'malik',
      containers: ['app', 'side'],
    })
    expect(pods[0]?.created).toBe(Date.parse('2026-10-07T00:00:00Z'))
    expect(pods[4]?.created).toBeNull()
  })

  it('throws on output that is not JSON', () => {
    expect(() => parsePods('error: no config')).toThrow()
  })
})

describe('parseNamespaces', () => {
  it('drops blank lines', () => {
    expect(parseNamespaces('default\nkube-system\n\n')).toEqual(['default', 'kube-system'])
  })
})

describe('formatAge', () => {
  it('matches the kubectl AGE column', () => {
    const now = 1_000_000_000
    expect(formatAge(now - 30_000, now)).toBe('30s')
    expect(formatAge(now - 600_000, now)).toBe('10m')
    expect(formatAge(now - 5 * 3600_000, now)).toBe('5h')
    expect(formatAge(now - 3 * 86400_000, now)).toBe('3d')
    expect(formatAge(null, now)).toBe('')
  })
})

describe('explainError', () => {
  it('adds a fix for docker socket and kubeconfig problems', () => {
    const sock =
      'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock'
    expect(explainError(sock)).toContain('usermod -aG docker')
    const kube =
      'The connection to the server localhost:8080 was refused - did you specify the right host or port?'
    expect(explainError(kube)).toContain('KUBECONFIG')
    expect(explainError('No such container: x')).toBe('No such container: x')
  })
})

describe('terminal commands', () => {
  it('quotes checked names', () => {
    expect(dockerShellCommand('gx-web')).toBe(
      `docker exec -it 'gx-web' sh -c "command -v bash >/dev/null && exec bash || exec sh"`,
    )
    expect(kubeShellCommand('default', 'web-1', 'app')).toContain(
      "kubectl exec -it -n 'default' 'web-1' -c 'app' -- ",
    )
    expect(kubeFollowCommand('default', 'web-1', null, 200)).toBe(
      "kubectl logs -f -n 'default' 'web-1' --all-containers=true --prefix=true --tail=200",
    )
  })

  it('refuses names that could break out of the quotes', () => {
    expect(() => dockerShellCommand("a';id;'")).toThrow()
    expect(() => kubeShellCommand('default', 'Web', null)).toThrow()
    expect(() => kubeShellCommand('default', 'web', 'a b')).toThrow()
  })
})
