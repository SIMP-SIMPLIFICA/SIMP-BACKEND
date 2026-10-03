// PreToolUse (Edit|Write|MultiEdit|NotebookEdit) — bloqueia edições perigosas.
//
// 1. Arquivos .env* (exceto .env.example, que documenta as variáveis sem valor).
// 2. Migrations JÁ EXISTENTES em prisma/migrations: migration aplicada é
//    histórico; mudar o SQL dela dessincroniza todos os bancos que já a rodaram.
//    Criar migration nova (pasta nova) continua permitido.
//
// Exit 2 = bloqueia a ferramenta e devolve o stderr ao Claude como motivo.
import { existsSync } from 'node:fs'
import path from 'node:path'

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { raw += chunk })
process.stdin.on('end', () => {
  let input
  try { input = JSON.parse(raw) } catch { process.exit(0) }

  const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path
  if (!target) process.exit(0)

  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
  const absolute = path.resolve(projectDir, target)
  const relative = path.relative(projectDir, absolute).split(path.sep).join('/')
  const base = path.basename(absolute)

  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
    block(`Edição de "${relative}" bloqueada: arquivos .env guardam segredos e não são editados pelo Claude. ` +
      'Documente a variável nova em .env.example (sem valor) e peça ao usuário para preencher o .env.')
  }

  const migrationMatch = relative.match(/^prisma\/migrations\/([^/]+)(\/.*)?$/)
  if (migrationMatch) {
    const [, entry, rest] = migrationMatch
    const entryPath = path.join(projectDir, 'prisma', 'migrations', entry)
    // migration_lock.toml e qualquer arquivo dentro de uma pasta de migration que já existe.
    const touchesExisting = rest ? existsSync(path.join(entryPath, 'migration.sql')) : existsSync(entryPath)
    if (touchesExisting) {
      block(`Edição de "${relative}" bloqueada: migrations existentes são imutáveis. ` +
        'Crie uma migration nova (npx prisma migrate dev --create-only --name <nome>) com a correção.')
    }
  }

  process.exit(0)
})

function block(message) {
  process.stderr.write(message + '\n')
  process.exit(2)
}
