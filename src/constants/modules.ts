export const MODULES = {
  TASKS: 'tasks',
  FINANCE: 'finance',
  COMMUNICATION: 'communication',
  VIRTUAL_PROCESSES: 'virtual_processes',
  CALENDAR: 'calendar',
  NOTES: 'notes',
  DEPARTMENTS: 'departments',
  LIBRARY: 'library',
} as const

export type ModuleKey = typeof MODULES[keyof typeof MODULES]

export const ALL_MODULES: ModuleKey[] = Object.values(MODULES)

// Módulos habilitados por padrão ao criar uma nova organização.
// virtual_processes fica fora — habilitado manualmente pelo super admin após validação.
export const DEFAULT_MODULES: ModuleKey[] = [
  MODULES.TASKS,
  MODULES.FINANCE,
  MODULES.COMMUNICATION,
  MODULES.CALENDAR,
  MODULES.NOTES,
  MODULES.DEPARTMENTS,
  MODULES.LIBRARY,
]
