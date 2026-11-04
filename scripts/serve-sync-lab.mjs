import { createServer } from 'node:http'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
/* global fetch */

/** Only called by the verified local fixture harness. Never part of Worker/App deployment. */
export async function serveSyncLab({
  vite,
  workerUrl,
  sessions,
  runId,
  asOf,
  importSession = sessions[1],
}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(workerUrl) || sessions.length !== 2)
    throw new Error('Local fixture configuration required')
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    try {
      if (url.pathname === '/__sync/session') {
        if (
          request.method !== 'GET' ||
          (request.headers['sec-fetch-site'] &&
            !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))
        ) {
          response.writeHead(403).end()
          return
        }
        const device = ['pc', 'phone', 'migration'].includes(url.searchParams.get('device'))
          ? url.searchParams.get('device')
          : 'pc'
        const session = device === 'migration' ? importSession : sessions[0]
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end(
          JSON.stringify({
            userId: session.userId,
            accessToken: session.accessToken,
            runId,
            projectUrl: 'http://127.0.0.1:54321',
            device,
            scenario: device === 'migration' ? 'import' : 'replica',
            asOf,
          }),
        )
        return
      }
      if (url.pathname.startsWith('/sync-api/')) {
        const path = url.pathname.slice('/sync-api'.length)
        if (
          !['/view', '/changes', '/operations'].includes(path) ||
          request.method !== (path === '/view' ? 'GET' : 'POST')
        ) {
          response.writeHead(404).end()
          return
        }
        const chunks = []
        let size = 0
        for await (const chunk of request) {
          size += chunk.length
          if (size > 20 * 1024 * 1024) {
            response.writeHead(413).end()
            return
          }
          chunks.push(chunk)
        }
        const remote = await fetch(workerUrl + path, {
          method: request.method,
          headers: {
            Authorization: request.headers.authorization ?? '',
            'Content-Type': 'application/json',
          },
          body: chunks.length ? Buffer.concat(chunks) : undefined,
          redirect: 'error',
        })
        response.writeHead(remote.status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
        response.end(Buffer.from(await remote.arrayBuffer()))
        return
      }
      if (url.pathname === '/' || url.pathname === '/app') {
        const html = await vite.transformIndexHtml(
          '/',
          `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Money Saver · Homologação</title></head><body><div id="root"></div><script type="module" src="/src/features/settings/${url.pathname === '/app' ? 'ApplicationTestEntry' : 'SyncLabPage'}.tsx"></script></body></html>`,
        )
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        response.end(html)
        return
      }
      vite.middlewares(request, response, () => response.writeHead(404).end())
    } catch {
      response.writeHead(503).end('Laboratório local indisponível; dados preservados.')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
