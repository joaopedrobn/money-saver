import { realpathSync } from 'node:fs'
import process from 'node:process'
import console from 'node:console'

if (Number(process.versions.node.split('.')[0]) !== 25) {
  console.error(
    `Money Saver requer Node.js 25.x. Detectado ${process.version}. Ative o Node 25 existente e tente novamente.`,
  )
  process.exitCode = 1
} else if (!process.argv.includes('--check')) {
  console.log(
    JSON.stringify(
      {
        node: process.version,
        executable: realpathSync(process.execPath),
        npm: process.env.npm_config_user_agent?.match(/^npm\/([^ ]+)/)?.[1] ?? null,
        npmNodeExecutable: process.env.npm_node_execpath
          ? realpathSync(process.env.npm_node_execpath)
          : null,
        npmCli: process.env.npm_execpath ? realpathSync(process.env.npm_execpath) : null,
      },
      null,
      2,
    ),
  )
}
