import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
export async function buildSyncWorker(outDir = join(root, '.local/worker-dist')) {
  if (process.version !== 'v26.7.0')
    throw new Error('Use Node.js 26.7.0 for the synchronization lab.')
  return build({
    root,
    envFile: false,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': join(root, 'src') } },
    build: {
      target: 'es2022',
      outDir,
      emptyOutDir: false,
      lib: {
        entry: join(root, 'src/worker/index.ts'),
        formats: ['es'],
        fileName: () => 'index.js',
      },
    },
  })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildSyncWorker()
