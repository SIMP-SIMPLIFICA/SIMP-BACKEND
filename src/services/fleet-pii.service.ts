import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { config } from '@/config/config.js'
import { FleetError } from '@/services/fleet-error.js'

/**
 * Cifragem de dados pessoais do Frotas (CPF e nº da CNH do motorista).
 *
 * - AES-256-GCM no campo, com chave de dados POR ORGANIZAÇÃO derivada da chave
 *   mestra por HKDF-SHA-256 (info = organizationId). Um vazamento de chave de
 *   dados de uma prefeitura não abre as outras. Trocar o env por um KMS depois
 *   muda só `masterKey()`.
 * - O organizationId também entra como AAD: um texto cifrado copiado para outra
 *   organização não decifra, mesmo com a chave certa.
 * - Busca e unicidade de CPF pelo blind index: HMAC-SHA-256 com chave separada
 *   sobre (organizationId, dígitos). Determinístico dentro da organização,
 *   diferente entre organizações.
 *
 * Formato gravado: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */

const VERSION = 'v1'
const HKDF_SALT = Buffer.from('simp-fleet-pii-v1')

function keyFromConfig(value: string | undefined): Buffer {
  const key = value ? Buffer.from(value, 'base64') : Buffer.alloc(0)
  if (key.length !== 32) {
    throw new FleetError(
      'PII_KEYS_MISSING',
      'O cadastro de motoristas está indisponível: as chaves de proteção de CPF e CNH não foram configuradas no servidor. Avise o administrador do sistema (FLEET_PII_MASTER_KEY e FLEET_PII_BLIND_INDEX_KEY).'
    )
  }
  return key
}

function dataKey(organizationId: string): Buffer {
  const master = keyFromConfig(config.fleet.piiMasterKey)
  return Buffer.from(hkdfSync('sha256', master, HKDF_SALT, Buffer.from(organizationId), 32))
}

export const fleetPiiService = {
  /** Lança PII_KEYS_MISSING (503) se as chaves não estiverem configuradas. */
  assertConfigured(): void {
    keyFromConfig(config.fleet.piiMasterKey)
    keyFromConfig(config.fleet.piiBlindIndexKey)
  },

  encrypt(organizationId: string, plain: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', dataKey(organizationId), iv)
    cipher.setAAD(Buffer.from(organizationId))
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv, tag, ciphertext].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
  },

  decrypt(organizationId: string, payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split('.')
    if (version !== VERSION || !iv || !tag || !ciphertext) {
      throw new Error('Formato de dado cifrado desconhecido')
    }
    const decipher = createDecipheriv('aes-256-gcm', dataKey(organizationId), Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(organizationId))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
  },

  blindIndex(organizationId: string, digits: string): string {
    const key = keyFromConfig(config.fleet.piiBlindIndexKey)
    return createHmac('sha256', key).update(`${organizationId}:${digits}`).digest('hex')
  },
}
