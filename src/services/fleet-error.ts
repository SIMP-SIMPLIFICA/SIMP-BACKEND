/**
 * Erro de regra de negócio do Simplifica Frotas (decisão D4).
 *
 * Mesmo padrão de `DailyAllowanceError`: o service lança com um código estável e
 * uma mensagem escrita para o usuário final (o que aconteceu, o dado concreto e o
 * que fazer); o controller traduz o código para o status HTTP em
 * `STATUS_BY_CODE`. `details` nunca carrega dado de outra organização.
 */
export type FleetErrorCode =
  | 'NO_ORGANIZATION'
  | 'NOT_FOUND'
  | 'INVALID_PLATE'
  | 'INVALID_RENAVAM'
  | 'INVALID_CHASSIS'
  | 'INVALID_VEHICLE_YEARS'
  | 'INVALID_CPF'
  | 'INVALID_CNH'
  | 'INVALID_DEPARTMENT'
  | 'INVALID_OWNER_ENTITY'
  | 'INVALID_USER'
  | 'VEHICLE_IN_USE'
  | 'DRIVER_IN_USE'
  | 'DEPARTMENT_OUT_OF_SCOPE'
  | 'PLATE_ALREADY_REGISTERED'
  | 'RENAVAM_ALREADY_REGISTERED'
  | 'CPF_ALREADY_REGISTERED'
  | 'ASSET_TAG_REQUIRED'
  | 'ASSET_TAG_ALREADY_REGISTERED'
  | 'REGISTRATION_REQUIRED'
  | 'REGISTRATION_ALREADY_REGISTERED'
  | 'EXPORT_TOO_LARGE'
  | 'PII_KEYS_MISSING'

export class FleetError extends Error {
  constructor(
    readonly code: FleetErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'FleetError'
  }
}
