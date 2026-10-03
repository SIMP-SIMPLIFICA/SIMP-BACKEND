// Stop — type-check do projeto inteiro, uma vez por turno, só se algum arquivo
// de código foi editado (marcador gravado por post-edit-lint.mjs).
//
// Backend: `tsc --noEmit` (sem project references; `tsc -b` aqui escreveria em dist/).
// Exit 2 = impede o Claude de encerrar e devolve os erros para ele corrigir.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TSC_ARGS = ['--noEmit']

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { raw += chunk })
process.stdin.on('end', () => {
  let input = {}
  try { input = JSON.parse(raw) } catch { /* segue com defaults */ }

  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
  const marker = markerPath(projectDir)
  if (!existsSync(marker)) process.exit(0)

  const tsc = path.join(projectDir, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tsc)) process.exit(0)

  const result = spawnSync(process.execPath, [tsc, ...TSC_ARGS], { cwd: projectDir, encoding: 'utf8' })

  if (result.status === 0) {
    rmSync(marker, { force: true })
    process.exit(0)
  }

  // Já estamos num ciclo de correção disparado por este hook: não prender o
  // Claude num laço infinito. O marcador fica, e o próximo turno checa de novo.
  if (input.stop_hook_active) process.exit(0)

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(0, 40).join('\n')
  process.stderr.write(`Type-check falhou (tsc ${TSC_ARGS.join(' ')}). Corrija antes de encerrar:\n${output}\n`)
  process.exit(2)
})

function markerPath(projectDir) {
  const id = createHash('sha1').update(projectDir.toLowerCase()).digest('hex').slice(0, 12)
  return path.join(os.tmpdir(), `claude-typecheck-pending-${id}`)
}
