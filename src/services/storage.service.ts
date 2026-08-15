/**
 * Storage local — substitui o Cloudflare R2 (Constituição, Princípio I: Local-First,
 * zero credenciais de nuvem para desenvolvimento).
 *
 * Mantém deliberadamente o mesmo formato de `fileKey` que era usado como chave de
 * objeto no R2 (`organizations/<orgId>/<scope>/<nome-gerado>`), porque esse valor já
 * está persistido em várias tabelas (library_documents.file_key, task_attachments.file_url,
 * etc.). Assim a migração não exige nenhuma alteração de dado existente.
 *
 * ATENÇÃO (dívida técnica registrada em docs/TechStack.md §11): os arquivos são servidos
 * estaticamente em /uploads/ SEM autenticação. O nome em disco é aleatório, o que torna a
 * URL impraticável de adivinhar, mas isso é obscuridade — não controle de acesso. Antes de
 * uso com dado real de prefeitura, documentos sigilosos (LibraryDocument.accessLevel) devem
 * voltar a ser servidos por um endpoint autenticado.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { config } from '@/config/config.js'

/** Raiz dos uploads — `uploads/` na raiz do backend (ignorada pelo git). */
export const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads')

/** Prefixo público sob o qual @fastify/static serve UPLOADS_ROOT. */
const PUBLIC_PREFIX = '/uploads'

export interface SaveFileOptions {
  /** Organização dona do arquivo — mantém o isolamento multi-tenant no disco. */
  organizationId: string | null
  /** Módulo de origem: 'library', 'communication', 'tasks', etc. */
  scope: string
  /** Nome original enviado pelo cliente — usado APENAS para extrair a extensão. */
  originalName: string
}

/**
 * Resolve um fileKey para caminho absoluto em disco, rejeitando qualquer tentativa
 * de escapar de UPLOADS_ROOT (path traversal via `../` num fileKey adulterado).
 */
function resolveSafePath(fileKey: string): string {
  const absolute = path.resolve(UPLOADS_ROOT, fileKey)
  if (absolute !== UPLOADS_ROOT && !absolute.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new Error('Caminho de arquivo inválido.')
  }
  return absolute
}

/**
 * Grava o buffer em disco e devolve o fileKey (caminho relativo a UPLOADS_ROOT).
 * O nome em disco é SEMPRE gerado pelo sistema — o nome do cliente nunca toca o
 * filesystem, eliminando path traversal na escrita.
 */
export async function saveFile(buffer: Buffer, options: SaveFileOptions): Promise<string> {
  const { organizationId, scope, originalName } = options

  const ext = path.extname(originalName)
  const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`
  const fileKey = `organizations/${organizationId ?? 'global'}/${scope}/${uniqueName}`

  const absolutePath = resolveSafePath(fileKey)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, buffer)

  return fileKey
}

/**
 * URL absoluta do arquivo. Precisa ser absoluta porque o frontend roda em outra
 * origem (5173) — uma URL relativa seria resolvida contra o frontend, não o backend.
 */
export function getFileUrl(fileKey: string): string {
  const base = config.urls.app.replace(/\/$/, '')
  return `${base}${PUBLIC_PREFIX}/${fileKey}`
}

/** Caminho absoluto em disco — para streaming (ex: montagem de ZIP). */
export function getFilePath(fileKey: string): string {
  return resolveSafePath(fileKey)
}

/** Remove o arquivo do disco. Ausente = sucesso (idempotente). */
export async function deleteFile(fileKey: string): Promise<void> {
  try {
    await fs.unlink(resolveSafePath(fileKey))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/** Cria a raiz de uploads no boot. */
export async function ensureUploadsRoot(): Promise<void> {
  await fs.mkdir(UPLOADS_ROOT, { recursive: true })
}
