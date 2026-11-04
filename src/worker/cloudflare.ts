import financialWorker, { type WorkerEnv } from './index'

interface Environment extends WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
}
/** API and SPA share an origin. Static Assets handles login/recovery routes. */
export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/sync-api/')) return env.ASSETS.fetch(request)
    const origin = request.headers.get('Origin')
    const allowed = (env.APP_ORIGINS ?? '').split(',').filter(Boolean)
    if (
      (origin && !allowed.includes(origin)) ||
      (!origin && request.headers.get('Sec-Fetch-Site') === 'cross-site')
    )
      return new Response('Origin forbidden', { status: 403 })
    const cors: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store' }
    if (origin) cors['Access-Control-Allow-Origin'] = origin
    if (request.method === 'OPTIONS') {
      if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403 })
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      })
    }
    url.pathname = url.pathname.slice('/sync-api'.length)
    const response = await financialWorker.fetch(new Request(url, request), env)
    const headers = new Headers(response.headers)
    Object.entries(cors).forEach(([key, value]) => headers.set(key, value))
    return new Response(response.body, { status: response.status, headers })
  },
}
