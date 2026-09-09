import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { expect, it, onTestFinished } from 'vitest'
import { WebSocket } from 'ws'
// `@vitest/mocker` is not a dependency of this test package, so the built
// `node` entry (what `@vitest/mocker/node` resolves to) is imported directly
import { interceptorPlugin } from '../../../packages/mocker/dist/node.js'

const root = fileURLToPath(
  new URL('../fixtures/mocker/redirect-security/root', import.meta.url),
)

async function createMockerServer(options: { registerWebSocketEvents?: boolean } = {}) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: {
      fs: { allow: [root] },
    },
    plugins: [
      {
        name: 'test:virtual-mock',
        enforce: 'pre',
        resolveId(id) {
          if (id === '/mock') {
            return id
          }
        },
      },
      interceptorPlugin(options),
    ],
  })
  await server.listen()
  onTestFinished(() => server.close())
  const port = new URL(server.resolvedUrls!.local[0]).port
  return { server, port }
}

/**
 * Sends the unauthenticated `vitest:interceptor:register` event that any client
 * can send to a dev server running the mocker plugin. Resolves with `true` when
 * the server answers with the register result, `false` when it stays silent
 * until the timeout.
 */
function registerRedirect(port: string, redirect: string, timeout = 5000) {
  return new Promise<boolean>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, 'vite-hmr')
    const timer = setTimeout(() => {
      ws.close()
      resolve(false)
    }, timeout)
    ws.on('message', (raw) => {
      let message: { type?: string; event?: string }
      try {
        message = JSON.parse(raw.toString())
      }
      catch {
        return
      }
      if (message.type === 'custom' && message.event === 'vitest:interceptor:register:result') {
        clearTimeout(timer)
        ws.close()
        resolve(true)
      }
    })
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'custom',
        event: 'vitest:interceptor:register',
        data: { type: 'redirect', raw: '', id: '/mock', url: '/mock', redirect },
      }))
    })
    ws.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

it('rejects a redirect mock whose target escapes the project root', async () => {
  const { server, port } = await createMockerServer()
  // an opaque URL scheme keeps the `..` segments, so join(root, pathname)
  // resolves outside the root; the mock must not be registered
  expect(await registerRedirect(port, 'traversal:../secret.txt')).toBe(true)
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result).toBe(null)
})

it('rejects a redirect mock that escapes the project root with backslashes', async () => {
  const { server, port } = await createMockerServer()
  // `node:path/posix` keeps `..\` as a single segment, but Windows resolves it
  // as a parent directory when the file is read
  expect(await registerRedirect(port, 'traversal:..\\secret.txt')).toBe(true)
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result).toBe(null)
})

it('rejects a redirect mock whose target is denied by "server.fs.deny"', async () => {
  const { server, port } = await createMockerServer()
  // inside the root, but matched by the default deny list, just like `.env`
  expect(await registerRedirect(port, 'traversal:private.pem')).toBe(true)
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result).toBe(null)
})

it('ignores websocket registration when the events are disabled', async () => {
  const { server, port } = await createMockerServer({ registerWebSocketEvents: false })
  // how the browser server runs the plugin: mocks are registered through the
  // authenticated RPC, so the raw dev-server socket must not answer at all
  expect(await registerRedirect(port, 'traversal:inroot.js', 1000)).toBe(false)
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result).toBe(null)
})

it('serves a redirect mock whose target stays inside the project root', async () => {
  const { server, port } = await createMockerServer()
  expect(await registerRedirect(port, 'traversal:inroot.js')).toBe(true)
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result?.code).toContain('in-root-redirect-ok')
})
