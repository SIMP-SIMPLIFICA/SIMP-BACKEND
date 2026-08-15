export const AVAILABLE_PERMISSIONS = {
  users: {
    displayName: 'Gestão de Usuários',
    permissions: [
      { key: 'users:read', description: 'Visualizar listagem de usuários', level: 'read' },
      { key: 'users:write', description: 'Criar e editar usuários', level: 'write' },
      { key: 'users:delete', description: 'Excluir usuários', level: 'delete' },
      { key: 'users:manage', description: 'Controle total de usuários (inclui reset de senha)', level: 'admin' }
    ]
  },
  roles: {
    displayName: 'Gestão de Perfis (Roles)',
    permissions: [
      { key: 'roles:read', description: 'Visualizar perfis de acesso', level: 'read' },
      { key: 'roles:write', description: 'Criar e editar perfis', level: 'write' },
      { key: 'roles:delete', description: 'Excluir perfis', level: 'delete' },
      { key: 'roles:manage', description: 'Gerenciar permissões avançadas', level: 'admin' }
    ]
  },
  finance: {
    displayName: 'Módulo Financeiro',
    permissions: [
      { key: 'finance:read', description: 'Visualizar relatórios financeiros', level: 'read' },
      { key: 'finance:write', description: 'Lançar despesas e receitas', level: 'write' },
      { key: 'finance:approve', description: 'Aprovar transações', level: 'admin' },
      { key: 'finance:export', description: 'Exportar dados financeiros', level: 'read' }
    ]
  },
  settings: {
    displayName: 'Configurações do Sistema',
    permissions: [
      { key: 'settings:read', description: 'Ver configurações globais', level: 'read' },
      { key: 'settings:write', description: 'Alterar configurações globais', level: 'write' },
      { key: 'system:admin', description: 'Acesso de Super Administrador', level: 'admin' },
      { key: 'audit:read', description: 'Acessar logs de auditoria', level: 'read' },
      { key: 'audit:export', description: 'Baixar logs de auditoria', level: 'read' }
    ]
  },
  communication: {
    displayName: 'Comunicação e Protocolo',
    permissions: [
      { key: 'documents:read', description: 'Visualizar documentos e processos', level: 'read' },
      { key: 'documents:create', description: 'Criar novos documentos (Memorandos, Ofícios)', level: 'write' },
      { key: 'documents:manage', description: 'Gerenciar todos os documentos (Editar/Excluir)', level: 'admin' },
      { key: 'documents:sign', description: 'Assinar documentos digitalmente', level: 'write' },
      { key: 'documents:send', description: 'Enviar documentos (Protocolar)', level: 'write' }
    ]
  },
  security: {
    displayName: 'Segurança & Sessões',
    permissions: [
      { key: 'sessions:view', description: 'Ver sessões ativas', level: 'read' },
      { key: 'sessions:manage', description: 'Derrubar sessões de usuários', level: 'admin' },
      { key: 'backup:create', description: 'Gerar backup manual', level: 'admin' },
      { key: 'backup:restore', description: 'Restaurar sistema', level: 'admin' }
    ]
  },
  processes: {
    displayName: 'Processos Virtuais',
    permissions: [
      { key: 'processes:read', description: 'Visualizar processos virtuais', level: 'read' },
      { key: 'processes:write', description: 'Criar e editar processos', level: 'write' },
      { key: 'processes:download', description: 'Baixar documentos de processos', level: 'read' },
      { key: 'processes:manage', description: 'Gerenciar todos os processos', level: 'admin' }
    ]
  },
  library: {
    displayName: 'Biblioteca Digital (GED)',
    permissions: [
      { key: 'library:read',   description: 'Visualizar e baixar documentos da biblioteca', level: 'read' },
      { key: 'library:write',  description: 'Fazer upload de documentos',                   level: 'write' },
      { key: 'library:delete', description: 'Excluir documentos da biblioteca',              level: 'delete' },
      { key: 'library:logs',   description: 'Visualizar histórico de auditoria da biblioteca', level: 'read' }
    ]
  },
  covenants: {
    displayName: 'Convênios, Emendas e Transferências',
    permissions: [
      { key: 'covenants:read',   description: 'Visualizar convênios e transferências', level: 'read' },
      { key: 'covenants:write',  description: 'Criar e editar convênios',              level: 'write' },
      { key: 'covenants:delete', description: 'Excluir convênios',                     level: 'delete' },
    ]
  },
  protocols: {
    displayName: 'Protocolos e Ofícios',
    permissions: [
      { key: 'protocols:read',        description: 'Visualizar documentos oficiais emitidos',                        level: 'read' },
      { key: 'protocols:write',       description: 'Gerar números de protocolo (Ato Normativo e Comunicação)',       level: 'write' },
      { key: 'protocols:admin',       description: 'Ver todos os setores, cancelar e gerenciar números',             level: 'admin' },
      { key: 'protocols:normativo',   description: 'Gerar números de Ato Normativo (fila única, setor central)',     level: 'write' },
      { key: 'protocols:comunicacao', description: 'Gerar números de Comunicação (por setor/departamento)',          level: 'write' },
    ]
  },
  departments: {
    displayName: 'Departamentos e Setores',
    permissions: [
      { key: 'departments:read',   description: 'Visualizar departamentos e secretarias', level: 'read' },
      { key: 'departments:write',  description: 'Criar e editar departamentos',           level: 'write' },
      { key: 'departments:delete', description: 'Excluir departamentos',                  level: 'delete' },
    ]
  },
  councils: {
    displayName: 'Conselhos Municipais',
    permissions: [
      { key: 'councils:read',  description: 'Visualizar conselhos, reuniões e documentos',                      level: 'read' },
      { key: 'councils:write', description: 'Criar e editar conselhos, membros, reuniões e fazer upload de atas', level: 'write' },
      { key: 'councils:admin', description: 'Gerenciar todos os conselhos (excluir, alterar qualquer status)',    level: 'admin' },
      { key: 'councils:sign',  description: 'Assinar documentos de conselhos via Gov.br',                        level: 'write' },
    ]
  },
  workspaces: {
    displayName: 'Workspaces (Quadros de Tarefas)',
    permissions: [
      { key: 'workspaces:read',   description: 'Visualizar workspaces e seus quadros',                 level: 'read' },
      { key: 'workspaces:write',  description: 'Criar novos workspaces',                                level: 'write' },
      { key: 'workspaces:manage', description: 'Gerenciar membros e excluir workspaces',                level: 'admin' },
    ]
  },
  tasks: {
    displayName: 'Tarefas',
    permissions: [
      { key: 'tasks:read', description: 'Visualizar e ser atribuído a tarefas em workspaces', level: 'read' },
    ]
  },
  notifications: {
    displayName: 'Notificações',
    permissions: [
      { key: 'notifications:read',   description: 'Visualizar as próprias notificações',            level: 'read' },
      { key: 'notifications:write',  description: 'Marcar notificações como lidas e ajustar preferências', level: 'write' },
      { key: 'notifications:manage', description: 'Excluir notificações',                            level: 'admin' },
    ]
  }
}

// Todas as permissões, exceto system:admin — reservada para super admins da plataforma,
// nunca para o admin de uma organização (ver docs/ProjectGoals.md / Constituição Princípio IV).
export const DEFAULT_ADMIN_PERMISSIONS: string[] = Object.values(AVAILABLE_PERMISSIONS)
  .flatMap(category => category.permissions.map(p => p.key))
  .filter(key => key !== 'system:admin')
