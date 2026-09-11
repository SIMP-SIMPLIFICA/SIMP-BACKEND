export const MODULES = {
  TASKS: 'tasks',
  FINANCE: 'finance',
  COMMUNICATION: 'communication',
  VIRTUAL_PROCESSES: 'virtual_processes',
  CALENDAR: 'calendar',
  NOTES: 'notes',
  DEPARTMENTS: 'departments',
  LIBRARY: 'library',
  COVENANTS: 'covenants',
  PROTOCOLS: 'protocols',
  COUNCILS: 'councils',
  SUPPORT: 'support',
  DAILY_ALLOWANCES: 'dailyAllowances',
  FLEET_FUELINGS: 'fleetFuelings',
} as const

export type ModuleKey = typeof MODULES[keyof typeof MODULES]

export const ALL_MODULES: ModuleKey[] = Object.values(MODULES)

// Módulos habilitados por padrão ao criar uma nova organização.
// virtual_processes, protocols, councils e support ficam fora — habilitados
// manualmente pelo super admin após validação/contratação.
export const DEFAULT_MODULES: ModuleKey[] = [
  MODULES.TASKS,
  MODULES.FINANCE,
  MODULES.COMMUNICATION,
  MODULES.CALENDAR,
  MODULES.NOTES,
  MODULES.DEPARTMENTS,
  MODULES.LIBRARY,
  MODULES.COVENANTS,
  MODULES.DAILY_ALLOWANCES,
  MODULES.FLEET_FUELINGS,
]
