/**
 * Validação de upload por assinatura binária ("magic numbers").
 *
 * PROBLEMA: `part.mimetype` do @fastify/multipart é apenas o header Content-Type
 * que o CLIENTE declarou. Um `.exe` renomeado para `.pdf` e enviado com
 * `Content-Type: application/pdf` passava por toda a validação existente. Pior: os
 * uploads são servidos estaticamente em /uploads/ sem autenticação, então o arquivo
 * malicioso ficava acessível por URL direta.
 *
 * SOLUÇÃO: ler os primeiros bytes do buffer — que o cliente não controla sem
 * produzir um arquivo genuinamente daquele formato — e conferir contra uma
 * ALLOWLIST por política de upload.
 *
 * Allowlist e não blocklist: a pergunta que importa não é "isto é um executável
 * conhecido?" (lista infinita, sempre desatualizada) e sim "isto é um dos formatos
 * que este endpoint aceita?". Qualquer coisa fora da lista é recusada por padrão.
 *
 * SEM DEPENDÊNCIA EXTERNA — ver nota sobre `file-type` no final do arquivo.
 */

import { logger } from '@/utils/logger.js'

export class UnsupportedFileTypeError extends Error {
  /** HTTP 415 Unsupported Media Type. */
  readonly statusCode = 415

  constructor(
    public readonly reason: 'assinatura-desconhecida' | 'tipo-nao-permitido' | 'divergencia-mime' | 'arquivo-vazio' | 'conteudo-executavel',
    public readonly detail: string,
  ) {
    super(detail)
    this.name = 'UnsupportedFileTypeError'
  }
}

export interface DetectedFileType {
  /** MIME canônico determinado pelos bytes, não pelo que o cliente declarou. */
  mime: string
  /** Extensões legítimas para este formato. */
  extensions: string[]
}

// ─── Assinaturas ──────────────────────────────────────────────────────────────

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false
  }
  return true
}

/** Procura uma sequência ASCII nos primeiros `limit` bytes. */
function containsAscii(buffer: Buffer, needle: string, limit = 4096): boolean {
  return buffer.subarray(0, limit).includes(Buffer.from(needle, 'ascii'))
}

/**
 * Distingue os formatos baseados em ZIP (OOXML e OpenDocument), que compartilham a
 * mesma assinatura `PK\x03\x04`. O nome da primeira entrada do zip revela o formato:
 * um .docx tem `word/`, um .xlsx tem `xl/`, um .pptx tem `ppt/`.
 */
function detectZipContainer(buffer: Buffer): DetectedFileType | null {
  if (containsAscii(buffer, 'word/')) {
    return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extensions: ['docx'] }
  }
  if (containsAscii(buffer, 'xl/')) {
    return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['xlsx'] }
  }
  if (containsAscii(buffer, 'ppt/')) {
    return { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extensions: ['pptx'] }
  }
  if (containsAscii(buffer, 'opendocument.text')) {
    return { mime: 'application/vnd.oasis.opendocument.text', extensions: ['odt'] }
  }
  if (containsAscii(buffer, 'opendocument.spreadsheet')) {
    return { mime: 'application/vnd.oasis.opendocument.spreadsheet', extensions: ['ods'] }
  }
  return { mime: 'application/zip', extensions: ['zip'] }
}

/**
 * Formatos executáveis / de script. Detectados NÃO para bloquear por blocklist (a
 * allowlist já faz isso), mas para poder logar "tentaram subir um PE executável
 * disfarçado de PDF" em vez de um genérico "assinatura desconhecida".
 */
function detectExecutable(buffer: Buffer): string | null {
  if (startsWith(buffer, [0x4d, 0x5a])) return 'PE/DOS executable (MZ)'
  if (startsWith(buffer, [0x7f, 0x45, 0x4c, 0x46])) return 'ELF executable'
  if (startsWith(buffer, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(buffer, [0xfe, 0xed, 0xfa, 0xcf])) return 'Mach-O executable'
  if (startsWith(buffer, [0xcf, 0xfa, 0xed, 0xfe])) return 'Mach-O executable'
  if (startsWith(buffer, [0xca, 0xfe, 0xba, 0xbe])) return 'Java class / Mach-O fat binary'
  if (startsWith(buffer, [0x23, 0x21])) return 'script com shebang (#!)'

  const head = buffer.subarray(0, 512).toString('latin1').toLowerCase()
  if (head.includes('<?php')) return 'script PHP'
  if (head.includes('<script')) return 'HTML/JS com <script>'
  if (head.includes('<!doctype html') || head.includes('<html')) return 'documento HTML'
  if (head.includes('<svg')) return 'SVG (permite script embutido)'

  return null
}

/**
 * Identifica o formato real pelos bytes. `null` quando nenhuma assinatura conhecida
 * bate — o chamador decide se isso é texto puro aceitável ou uma recusa.
 */
export function detectFileType(buffer: Buffer): DetectedFileType | null {
  if (buffer.length === 0) return null

  // PDF — "%PDF-"
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { mime: 'application/pdf', extensions: ['pdf'] }
  }

  // PNG
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', extensions: ['png'] }
  }

  // JPEG — todas as variantes começam com FF D8 FF
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] }
  }

  // GIF87a / GIF89a
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) {
    return { mime: 'image/gif', extensions: ['gif'] }
  }

  // WEBP — "RIFF" + 4 bytes de tamanho + "WEBP"
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: 'image/webp', extensions: ['webp'] }
  }

  // ZIP e derivados (docx/xlsx/pptx/odt/ods)
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])
    || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06])
    || startsWith(buffer, [0x50, 0x4b, 0x07, 0x08])) {
    return detectZipContainer(buffer)
  }

  // OLE2 Compound File — .doc/.xls/.ppt legados
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { mime: 'application/x-ole-storage', extensions: ['doc', 'xls', 'ppt'] }
  }

  return null
}

/**
 * `true` quando o buffer é texto simples plausível (para .txt/.csv, que não têm
 * assinatura). Rejeita bytes nulos e caracteres de controle, que denunciam binário
 * tentando passar por texto.
 */
export function looksLikePlainText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192)
  if (sample.includes(0x00)) return false

  for (const byte of sample) {
    const isPrintable = byte >= 0x20 && byte !== 0x7f
    const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d // tab, LF, CR
    if (!isPrintable && !isAllowedControl && byte < 0x80) return false
  }
  return true
}

// ─── Políticas de upload ──────────────────────────────────────────────────────

export interface UploadPolicy {
  /** Nome para log/erro. */
  name: string
  /** MIMEs canônicos aceitos, determinados pelos BYTES. */
  allowedMimes: string[]
  /** Se `true`, aceita arquivos sem assinatura desde que sejam texto puro. */
  allowPlainText?: boolean
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const OFFICE_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/x-ole-storage',
]

export const UPLOAD_POLICIES = {
  /** GED/Biblioteca e documentos de conselho: PDF com valor legal, nada além disso. */
  PDF_ONLY: {
    name: 'PDF_ONLY',
    allowedMimes: ['application/pdf'],
  },

  /** Logos e avatares. Sem SVG de propósito: XML com script embutido, e os uploads
   *  são servidos estaticamente sem autenticação. */
  IMAGES_ONLY: {
    name: 'IMAGES_ONLY',
    allowedMimes: IMAGE_MIMES,
  },

  /** Anexos gerais: imagens, PDF, Office e texto. Sem ZIP solto (empacota qualquer
   *  coisa) e sem executáveis. */
  GENERAL_ATTACHMENT: {
    name: 'GENERAL_ATTACHMENT',
    allowedMimes: ['application/pdf', ...IMAGE_MIMES, ...OFFICE_MIMES],
    allowPlainText: true,
  },
} as const satisfies Record<string, UploadPolicy>

// ─── Ponto de entrada ─────────────────────────────────────────────────────────

/**
 * Valida o buffer contra a política. Lança `UnsupportedFileTypeError` (HTTP 415)
 * quando o conteúdo real não é aceitável.
 *
 * Devolve o MIME REAL, que o chamador deve persistir em vez do declarado — assim o
 * banco guarda o que o arquivo é, não o que o cliente disse que era.
 */
export function assertAllowedFile(
  buffer: Buffer,
  options: {
    policy: UploadPolicy
    /** Content-Type declarado pelo cliente. Usado só para detectar divergência. */
    declaredMime?: string
    /** Nome original, apenas para mensagem de erro e log. */
    fileName?: string
  },
): DetectedFileType {
  const { policy, declaredMime, fileName = 'arquivo' } = options

  if (buffer.length === 0) {
    throw new UnsupportedFileTypeError('arquivo-vazio', 'Arquivo vazio.')
  }

  // Checado antes da allowlist para produzir um log específico e acionável.
  const executable = detectExecutable(buffer)
  if (executable) {
    logger.warn(
      { fileName, declaredMime, detected: executable, policy: policy.name },
      'Upload recusado: conteúdo executável ou ativo disfarçado',
    )
    throw new UnsupportedFileTypeError(
      'conteudo-executavel',
      `O conteúdo de "${fileName}" é um ${executable}, não o tipo declarado.`,
    )
  }

  const detected = detectFileType(buffer)

  if (!detected) {
    if (policy.allowPlainText && looksLikePlainText(buffer)) {
      return { mime: 'text/plain', extensions: ['txt', 'csv'] }
    }
    logger.warn(
      { fileName, declaredMime, policy: policy.name },
      'Upload recusado: assinatura binária não reconhecida',
    )
    throw new UnsupportedFileTypeError(
      'assinatura-desconhecida',
      `Não foi possível identificar o formato de "${fileName}" pelo seu conteúdo.`,
    )
  }

  if (!(policy.allowedMimes as readonly string[]).includes(detected.mime)) {
    logger.warn(
      { fileName, declaredMime, realMime: detected.mime, policy: policy.name },
      'Upload recusado: formato real fora da allowlist',
    )
    throw new UnsupportedFileTypeError(
      'tipo-nao-permitido',
      `Arquivos do tipo "${detected.mime}" não são aceitos aqui.`,
    )
  }

  // Divergência declarado vs. real. Chega aqui só quando o tipo real JÁ é permitido,
  // então não é um bloqueio de segurança — mas é exatamente o sinal de ".exe
  // renomeado" quando o real não fosse permitido, e vale registrar.
  if (declaredMime && !mimeMatches(declaredMime, detected)) {
    logger.warn(
      { fileName, declaredMime, realMime: detected.mime },
      'Content-Type declarado diverge da assinatura binária',
    )
    throw new UnsupportedFileTypeError(
      'divergencia-mime',
      `"${fileName}" foi enviado como "${declaredMime}", mas seu conteúdo é "${detected.mime}".`,
    )
  }

  return detected
}

/**
 * Compara o MIME declarado com o detectado, tolerando apelidos legítimos que
 * navegadores e sistemas operacionais emitem para o mesmo formato.
 */
function mimeMatches(declared: string, detected: DetectedFileType): boolean {
  const normalized = declared.split(';')[0].trim().toLowerCase()
  if (normalized === detected.mime) return true

  const ALIASES: Record<string, string[]> = {
    'image/jpeg': ['image/jpg', 'image/pjpeg'],
    'image/png': ['image/x-png'],
    'application/x-ole-storage': [
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
    ],
    'application/zip': ['application/x-zip-compressed', 'application/octet-stream'],
  }

  if (ALIASES[detected.mime]?.includes(normalized)) return true

  // Navegadores mandam application/octet-stream quando não reconhecem a extensão.
  // Não é sinal de fraude — o tipo real já passou pela allowlist acima.
  if (normalized === 'application/octet-stream') return true

  return false
}

/*
 * NOTA SOBRE `file-type`
 * ----------------------
 * A biblioteca `file-type` foi avaliada e NÃO adotada. Da v17 em diante ela é ESM
 * puro ("type": "module") e este projeto é CommonJS — CLAUDE.md proíbe a migração.
 * A última versão CJS é a 16.5.4, de 2021.
 *
 * Além disso, `file-type` responde "que formato é este?" sobre ~440 formatos, mas o
 * controle de segurança que precisamos é "este arquivo é um dos poucos formatos que
 * este endpoint aceita?" — uma allowlist curta e auditável, que é o que está acima.
 */
