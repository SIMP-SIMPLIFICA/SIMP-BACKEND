/**
 * Leitor de ZIP mínimo, só para os testes.
 *
 * Deliberadamente sem biblioteca: os pacotes que o sistema gera são gravados
 * SEM compressão (`store`), e ler um ZIP assim é percorrer o diretório central
 * e recortar os bytes — não justifica uma dependência nova só para o teste.
 *
 * Lê os tamanhos do DIRETÓRIO CENTRAL, nunca do cabeçalho local: quando o
 * arquivo é escrito em fluxo, o cabeçalho local pode trazer zeros e deixar o
 * tamanho real para o descritor que vem depois dos dados. O diretório central
 * é a única parte sempre correta.
 *
 * NÃO serve para ZIP comprimido: um `deflate` aqui devolveria bytes crus em vez
 * do conteúdo, então o método é conferido e o erro é explícito.
 */

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const CENTRAL_HEADER_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const METHOD_STORE = 0

export interface ZipEntry {
  name: string
  content: Buffer
}

/** Posição do End of Central Directory, procurado do fim para o começo. */
function findEndOfCentralDirectory(zip: Buffer): number {
  // O EOCD tem 22 bytes fixos mais um comentário de até 64 KiB.
  const earliest = Math.max(0, zip.length - 22 - 0xffff)

  for (let offset = zip.length - 22; offset >= earliest; offset -= 1) {
    if (zip.readUInt32LE(offset) === SIG_EOCD) return offset
  }

  throw new Error('ZIP inválido: fim do diretório central não encontrado.')
}

/** Todas as entradas do pacote, com o conteúdo já recortado. */
export function readZipEntries(zip: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(zip)
  const entryCount = zip.readUInt16LE(eocd + 10)

  const entries: ZipEntry[] = []
  let cursor = zip.readUInt32LE(eocd + 16)

  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new Error(`ZIP inválido: entrada ${index} sem assinatura de diretório central.`)
    }

    const method = zip.readUInt16LE(cursor + 10)
    const size = zip.readUInt32LE(cursor + 24)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)

    const name = zip.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLength)
      .toString('utf8')

    if (method !== METHOD_STORE) {
      throw new Error(
        `"${name}" está comprimido (método ${method}). Este leitor só entende ZIP sem compressão.`
      )
    }

    // O cabeçalho local tem tamanhos próprios de nome e extra, que podem
    // diferir dos do diretório central — por isso são lidos de novo aqui.
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength

    entries.push({ name, content: zip.subarray(dataStart, dataStart + size) })
    cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength
  }

  return entries
}

/** Conteúdo de um arquivo do pacote. Lança quando não existe. */
export function readZipFile(zip: Buffer, name: string): Buffer {
  const entry = readZipEntries(zip).find(item => item.name === name)
  if (!entry) {
    throw new Error(`"${name}" não está no pacote.`)
  }
  return entry.content
}
