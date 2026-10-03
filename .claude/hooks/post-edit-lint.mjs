// PostToolUse (Edit|Write|MultiEdit) — ESLint só no arquivo alterado (rápido)
// e marca que há type-check pendente; o type-check do projeto inteiro (~10 s)
// roda uma vez por turno no hook Stop (stop-typecheck.mjs), não a cada edição.
//
// Exit 2 = devolve o stderr ao Claude, que corrige antes de seguir.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Mesmo escopo do script "lint" deste repo: `eslint src`.
const LINT_ROOTS = ['src/']
const LINT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { raw += chunk })
process.stdin.on('end', () => {
  let input
  try { input = JSON.parse(raw) } catch { process.exit(0) }

  const target = input?.tool_input?.file_path
  if (!target) process.exit(0)

  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
  const absolute = path.resolve(projectDir, target)
  const relative = path.relative(projectDir, absolute).split(path.sep).join('/')

  if (!LINT_EXTENSIONS.has(path.extname(absolute))) process.exit(0)
  if (!existsSync(absolute)) process.exit(0)

  // Marca type-check pendente para o hook Stop (vale também fora de src/, ex.: prisma/seeds).
  writeFileSync(markerPath(projectDir), new Date().toISOString())

  if (!LINT_ROOTS.some(root => relative.startsWith(root))) process.exit(0)

  const eslint = path.join(projectDir, 'node_modules', 'eslint', 'bin', 'eslint.js')
  if (!existsSync(eslint)) process.exit(0)

  const result = spawnSync(process.execPath, [eslint, '--no-warn-ignored', relative], {
    cwd: projectDir,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(0, 40).join('\n')
    process.stderr.write(`ESLint encontrou erros em ${relative}:\n${output}\n`)
    process.exit(2)
  }
  process.exit(0)
})

function markerPath(projectDir) {
  const id = createHash('sha1').update(projectDir.toLowerCase()).digest('hex').slice(0, 12)
  return path.join(os.tmpdir(), `claude-typecheck-pending-${id}`)
}
