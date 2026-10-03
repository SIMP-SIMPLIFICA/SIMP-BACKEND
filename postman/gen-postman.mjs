// Gerador da Postman Collection v2.1 do SIMP-BACKEND.
// Roda uma vez, escreve os dois arquivos finais e sai.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

// ─── DSL mínima ────────────────────────────────────────────────────────────

function J(obj) {
  return { mode: 'raw', raw: JSON.stringify(obj, null, 2), options: { raw: { language: 'json' } } }
}

function FD(fields) {
  return { mode: 'formdata', formdata: fields }
}

function Q(params) {
  // params: { key: value } — value `null` gera um param opcional desabilitado (documentação)
  return Object.entries(params).map(([key, value]) => ({
    key,
    value: value === null ? '' : String(value),
    disabled: value === null,
  }))
}

function buildUrl(path, query) {
  const clean = path.replace(/^\//, '')
  const segments = clean.split('/').filter(Boolean)
  const activeQuery = (query || []).filter(q => !q.disabled)
  const qs = activeQuery.length ? '?' + activeQuery.map(q => `${q.key}=${encodeURIComponent(q.value)}`).join('&') : ''
  return {
    raw: `{{baseUrl}}/${clean}${qs}`,
    host: ['{{baseUrl}}'],
    path: segments,
    query: query && query.length ? query : undefined,
  }
}

function req(name, method, path, opts = {}) {
  const { query, body, auth, description } = opts
  const request = {
    method,
    header: [],
    url: buildUrl(path, query),
  }
  if (description) request.description = description
  if (body) request.body = body
  if (auth === 'noauth') request.auth = { type: 'noauth' }
  return { name, request, response: [] }
}

function folder(name, items, description) {
  const f = { name, item: items }
  if (description) f.description = description
  return f
}

// ─── Payloads de exemplo reutilizados ───────────────────────────────────────

const EX = {
  orgId: '{{organizationId}}',
  deptId: '{{departmentId}}',
  userId: '{{userId}}',
  roleId: '{{roleId}}',
  councilId: '{{councilId}}',
  meetingId: '{{meetingId}}',
  membershipId: '{{membershipId}}',
  itemId: '{{agendaItemId}}',
  docId: '{{documentId}}',
  covenantId: '{{covenantId}}',
  processId: '{{virtualProcessId}}',
  processDocId: '{{virtualProcessDocumentId}}',
  qddItemId: '{{qddItemId}}',
  budgetLawId: '{{budgetLawId}}',
  dailyAllowanceId: '{{dailyAllowanceId}}',
  beneficiaryId: '{{beneficiaryId}}',
  fleetFuelingId: '{{fleetFuelingId}}',
  protocolId: '{{protocolId}}',
  workspaceId: '{{workspaceId}}',
  taskId: '{{taskId}}',
  checklistItemId: '{{checklistItemId}}',
  noteId: '{{noteId}}',
  attachmentId: '{{attachmentId}}',
  entryId: '{{financeEntryId}}',
  accountId: '{{bankAccountId}}',
  categoryId: '{{financeCategoryId}}',
  libraryDocId: '{{libraryDocumentId}}',
  libraryCategoryId: '{{libraryCategoryId}}',
  messageId: '{{messageId}}',
  calendarEventId: '{{calendarEventId}}',
  notificationId: '{{notificationId}}',
  supportRequestId: '{{supportRequestId}}',
  sessionId: '{{sessionId}}',
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. AUTENTICAÇÃO & SESSÃO
// ═══════════════════════════════════════════════════════════════════════════

const authFolder = folder('1. Autenticação & Sessão', [
  req('Registrar novo usuário', 'POST', '/api/v1/auth/register', {
    auth: 'noauth',
    description: 'Rota pública. Sujeita a rate limit por IP e a verificação Turnstile.',
    body: J({
      email: 'novo.usuario@prefeitura.gov.br',
      password: 'SenhaForte@123',
      firstName: 'Maria',
      lastName: 'Souza',
      username: 'maria.souza',
    }),
  }),
  req('Login', 'POST', '/api/v1/auth/login', {
    auth: 'noauth',
    description:
      'Rota pública. Sujeita a rate limit por IP e por CONTA (e-mail), e a verificação Turnstile. ' +
      'O script em Tests salva o token retornado na variável de ambiente `token`, usada como Bearer ' +
      'por todas as demais requisições da coleção.',
    body: J({
      email: '{{loginEmail}}',
      password: '{{loginPassword}}',
      rememberMe: true,
    }),
  }),
  req('Refresh token', 'POST', '/api/v1/auth/refresh-token', {
    auth: 'noauth',
    body: J({ refreshToken: '{{refreshToken}}' }),
  }),
  req('Logout', 'POST', '/api/v1/auth/logout', {}),
  req('Esqueci minha senha', 'POST', '/api/v1/auth/forgot-password', {
    auth: 'noauth',
    body: J({ email: '{{loginEmail}}' }),
  }),
  req('Redefinir senha', 'POST', '/api/v1/auth/reset-password', {
    auth: 'noauth',
    body: J({
      token: '{{resetToken}}',
      password: 'NovaSenhaForte@123',
      confirmPassword: 'NovaSenhaForte@123',
    }),
  }),
  req('Verificar e-mail', 'POST', '/api/v1/auth/verify-email', {
    auth: 'noauth',
    body: J({ token: '{{verifyEmailToken}}' }),
  }),
  req('Meu perfil (me)', 'GET', '/api/v1/auth/me', {}),
  req('Atualizar meu perfil', 'PUT', '/api/v1/auth/profile', {
    body: J({
      firstName: 'Maria',
      lastName: 'Souza',
      username: 'maria.souza',
      jobTitle: 'Assistente Administrativo',
    }),
  }),
  req('Trocar minha senha', 'POST', '/api/v1/auth/change-password', {
    body: J({
      currentPassword: 'SenhaAtual@123',
      newPassword: 'SenhaNova@123',
      confirmPassword: 'SenhaNova@123',
    }),
  }),
  req('Listar minhas sessões', 'GET', '/api/v1/auth/sessions', {
    query: Q({ includeInactive: 'false' }),
  }),
  req('Encerrar uma sessão específica', 'DELETE', `/api/v1/auth/sessions/${EX.sessionId}`, {}),
  req('Encerrar todas as minhas sessões', 'DELETE', '/api/v1/auth/sessions', {}),
])

// ═══════════════════════════════════════════════════════════════════════════
// 2. ORGANIZAÇÕES & MULTI-TENANT
// ═══════════════════════════════════════════════════════════════════════════

const orgFolder = folder('2. Organizações & Multi-Tenant', [
  req('Listar organizações (super admin)', 'GET', '/api/v1/organizations', {
    description: 'Lista simples (id, nome, slug). Restrito a super admin.',
  }),
  req('Onboarding de nova organização (público)', 'POST', '/api/v1/organizations', {
    auth: 'noauth',
    description:
      'Cria a organização E o usuário admin dela em uma única chamada pública. ' +
      'Rate limit: 5/min por IP. Já devolve tokens de acesso do admin recém-criado.',
    body: J({
      orgName: 'Prefeitura Municipal de Exemplo',
      orgSlug: 'prefeitura-exemplo',
      orgCnpj: '12345678000199',
      adminEmail: 'admin@prefeitura-exemplo.gov.br',
      adminPassword: 'SenhaForte@123',
      adminFirstName: 'João',
      adminLastName: 'Silva',
    }),
  }),
  folder('Painel Admin (Super Admin)', [
    req('Listar organizações (painel admin)', 'GET', '/api/v1/admin/organizations', {
      description: 'Versão rica da listagem: inclui contagem de usuários e módulos habilitados.',
    }),
    req('Criar organização (painel admin)', 'POST', '/api/v1/admin/organizations', {
      description:
        'Cria organização + admin com SENHA TEMPORÁRIA gerada e enviada por e-mail ' +
        '(diferente do onboarding público, que recebe a senha escolhida).',
      body: J({
        orgName: 'Prefeitura Municipal de Exemplo',
        orgSlug: 'prefeitura-exemplo',
        orgCnpj: '12345678000199',
        plan: 'basic',
        enabledModules: ['dailyAllowances', 'fleetFuelings', 'finance'],
        adminEmail: 'admin@prefeitura-exemplo.gov.br',
        adminFirstName: 'João',
        adminLastName: 'Silva',
      }),
    }),
    req('Detalhar organização', 'GET', `/api/v1/admin/organizations/${EX.orgId}`, {}),
    req('Atualizar organização', 'PATCH', `/api/v1/admin/organizations/${EX.orgId}`, {
      description: 'city/state alimentam o texto do Recibo de Diária ("Pequizeiro - TO").',
      body: J({
        name: 'Prefeitura Municipal de Exemplo',
        isActive: true,
        city: 'Pequizeiro',
        state: 'TO',
      }),
    }),
    req('Listar módulos da organização', 'GET', `/api/v1/admin/organizations/${EX.orgId}/modules`, {}),
    req('Habilitar/desabilitar módulo', 'PATCH', `/api/v1/admin/organizations/${EX.orgId}/modules/dailyAllowances`, {
      description: 'O segmento final do path é a chave do módulo (ex: dailyAllowances, fleetFuelings, finance).',
      body: J({ isEnabled: true, notes: 'Habilitado a pedido do cliente.' }),
    }),
    req('Upload de logo da organização (white-label)', 'POST', `/api/v1/admin/organizations/${EX.orgId}/logo`, {
      body: FD([{ key: 'file', type: 'file', src: '' }]),
    }),
    req('Remover logo da organização', 'DELETE', `/api/v1/admin/organizations/${EX.orgId}/logo`, {}),
    req('Impersonar admin da organização', 'POST', `/api/v1/admin/organizations/${EX.orgId}/impersonate`, {
      description: 'Devolve um accessToken válido em nome do admin da organização-alvo.',
    }),
  ]),
  folder('Configurações', [
    req('Configurações públicas', 'GET', '/api/v1/settings/public', {
      auth: 'noauth',
      description: 'Sem autenticação — alimenta o cabeçalho público (nome do prefeito, brasão etc).',
    }),
    req('Atualizar configurações', 'PUT', '/api/v1/settings', {
      body: J({
        MayorName: 'Fulano de Tal',
        CityAddress: 'Praça Central, 1 - Centro',
        CoatOfArmsUrl: 'https://exemplo.com/brasao.png',
      }),
    }),
  ]),
])

// ═══════════════════════════════════════════════════════════════════════════
// 3. USUÁRIOS & PERFIS (RBAC)
// ═══════════════════════════════════════════════════════════════════════════

const usersFolder = folder('3. Usuários & Perfis (RBAC)', [
  folder('Usuários', [
    req('Listar usuários', 'GET', '/api/v1/users', {
      query: Q({
        page: 1,
        limit: 20,
        search: null,
        isActive: null,
        isVerified: null,
        role: null,
        organizationId: null,
        sortBy: null,
        sortOrder: 'desc',
      }),
    }),
    req('Gerar certificado digital (PFX)', 'POST', '/api/v1/users/me/certificate', { body: J({}) }),
    req('Upload de logo institucional (usuário)', 'POST', '/api/v1/users/me/logo', {
      body: FD([{ key: 'file', type: 'file', src: '' }]),
    }),
    req('Remover minha logo institucional', 'DELETE', '/api/v1/users/me/logo', {}),
    req('Detalhar usuário', 'GET', `/api/v1/users/${EX.userId}`, {}),
    req('Criar usuário', 'POST', '/api/v1/users', {
      body: J({
        email: 'novo.usuario@prefeitura.gov.br',
        password: 'SenhaForte@123',
        firstName: 'Maria',
        lastName: 'Souza',
        username: 'maria.souza',
        isActive: true,
        isVerified: false,
        roles: [EX.roleId],
      }),
    }),
    req('Atualizar usuário', 'PUT', `/api/v1/users/${EX.userId}`, {
      body: J({ firstName: 'Maria', lastName: 'Souza Lima', isActive: true }),
    }),
    req('Excluir usuário', 'DELETE', `/api/v1/users/${EX.userId}`, {}),
    req('Atribuir papéis ao usuário', 'POST', `/api/v1/users/${EX.userId}/roles`, {
      body: J({ roleIds: [EX.roleId] }),
    }),
    req('Remover papéis do usuário', 'DELETE', `/api/v1/users/${EX.userId}/roles`, {
      body: J({ roleIds: [EX.roleId] }),
    }),
    req('Sessões ativas do usuário', 'GET', `/api/v1/users/${EX.userId}/sessions`, {}),
    req('Encerrar todas as sessões do usuário', 'DELETE', `/api/v1/users/${EX.userId}/sessions`, {}),
    req('Encerrar sessão específica do usuário', 'DELETE', `/api/v1/users/${EX.userId}/sessions/${EX.sessionId}`, {}),
    req('Ativar/Desativar usuário', 'PATCH', `/api/v1/users/${EX.userId}/status`, {
      body: J({ isActive: false, reason: 'Desligamento do servidor.' }),
    }),
    req('Forçar redefinição de senha', 'POST', `/api/v1/users/${EX.userId}/force-password-reset`, {}),
  ]),
  folder('Papéis (Roles)', [
    req('Listar papéis', 'GET', '/api/v1/roles', {
      query: Q({ page: 1, limit: 20, search: null, isActive: null, isSystem: null, sortBy: null, sortOrder: 'asc' }),
    }),
    req('Detalhar papel', 'GET', `/api/v1/roles/${EX.roleId}`, {}),
    req('Criar papel', 'POST', '/api/v1/roles', {
      body: J({
        name: 'financeiro-operador',
        displayName: 'Operador Financeiro',
        description: 'Lança e edita registros financeiros do setor.',
        color: '#2563EB',
        permissions: ['finance:read', 'finance:write'],
        parentId: null,
      }),
    }),
    req('Atualizar papel', 'PUT', `/api/v1/roles/${EX.roleId}`, {
      body: J({ displayName: 'Operador Financeiro Sênior', permissions: ['finance:read', 'finance:write', 'finance:manage'] }),
    }),
    req('Excluir papel', 'DELETE', `/api/v1/roles/${EX.roleId}`, {}),
    req('Usuários com este papel', 'GET', `/api/v1/roles/${EX.roleId}/users`, {
      query: Q({ page: 1, limit: 20, isActive: null }),
    }),
    req('Permissões disponíveis no catálogo', 'GET', '/api/v1/roles/permissions/available', {}),
    req('Duplicar papel', 'POST', `/api/v1/roles/${EX.roleId}/duplicate`, {
      body: J({ name: 'financeiro-operador-copia', displayName: 'Operador Financeiro (cópia)' }),
    }),
    req('Hierarquia de papéis', 'GET', '/api/v1/roles/hierarchy', {}),
  ]),
])

// ═══════════════════════════════════════════════════════════════════════════
// 4. DEPARTAMENTOS & VÍNCULOS
// ═══════════════════════════════════════════════════════════════════════════

const deptFolder = folder('4. Departamentos & Vínculos', [
  req('Listar departamentos', 'GET', '/departments', {
    query: Q({ page: 1, limit: 20, search: null }),
  }),
  req('Detalhar departamento', 'GET', `/departments/${EX.deptId}`, {}),
  req('Criar departamento', 'POST', '/departments', {
    body: J({
      name: 'Secretaria Municipal de Assistência Social',
      code: 'SMAS',
      description: 'Setor responsável pelos programas de assistência social.',
      cnpj: '12345678000199',
      managerId: EX.userId,
    }),
  }),
  req('Atualizar departamento', 'PATCH', `/departments/${EX.deptId}`, {
    body: J({ name: 'Secretaria Municipal de Assistência Social e Habitação', managerId: EX.userId }),
  }),
  req('Excluir departamento', 'DELETE', `/departments/${EX.deptId}`, {}),
  req('Upload de logo do setor', 'POST', `/departments/${EX.deptId}/logo`, {
    body: FD([{ key: 'file', type: 'file', src: '' }]),
  }),
  req('Remover logo do setor', 'DELETE', `/departments/${EX.deptId}/logo`, {}),
  req('Listar membros do setor', 'GET', `/departments/${EX.deptId}/members`, {}),
  req('Adicionar membros ao setor', 'POST', `/departments/${EX.deptId}/members`, {
    body: J({ userIds: [EX.userId] }),
  }),
  req('Remover membro do setor', 'DELETE', `/departments/${EX.deptId}/members/${EX.userId}`, {}),
  folder('Vínculos (somente leitura)', [
    req('Conselhos vinculados ao setor', 'GET', `/departments/${EX.deptId}/councils`, {}),
    req('Convênios do setor', 'GET', `/departments/${EX.deptId}/covenants`, {}),
    req('Processos virtuais do setor', 'GET', `/departments/${EX.deptId}/virtual-processes`, {}),
  ]),
  req('Dossiê do setor (PDF)', 'GET', `/departments/${EX.deptId}/dossier`, {
    description:
      'Seções em lista separada por vírgula. Nome de seção desconhecido é descartado em silêncio, ' +
      'não recusado. Omitir o parâmetro traz o dossiê completo.',
    query: Q({ sections: 'members,councils,covenants,virtualProcesses,qddItems' }),
  }),
])

// ═══════════════════════════════════════════════════════════════════════════
// 5. PLANEJAMENTO ORÇAMENTÁRIO
// ═══════════════════════════════════════════════════════════════════════════

const budgetFolder = folder('5. Planejamento Orçamentário', [
  folder('Leis Orçamentárias (LOA / PPA / LDO)', [
    req('Listar leis orçamentárias', 'GET', '/budget-laws', {
      query: Q({ departmentId: null, year: null }),
    }),
    req('Criar/atualizar lei orçamentária (upsert)', 'POST', '/budget-laws', {
      description: 'Um card por tipo (LOA/PPA/LDO) por ano — reenviar faz upsert, sem distinção de criar/editar.',
      body: J({
        departmentId: EX.deptId,
        type: 'LOA',
        year: 2026,
        lawNumber: 'Lei nº 1.234/2025',
        publishedAt: '2025-12-20T00:00:00.000Z',
        details: 'Lei Orçamentária Anual referente ao exercício de 2026.',
      }),
    }),
    req('Excluir lei orçamentária', 'DELETE', `/budget-laws/${EX.budgetLawId}`, {}),
  ]),
  folder('QDD — Quadro de Detalhamento da Despesa', [
    req('Listar fichas do QDD', 'GET', '/qdd-items', {
      query: Q({ departmentId: null, year: null }),
    }),
    req('Detalhar ficha do QDD', 'GET', `/qdd-items/${EX.qddItemId}`, {}),
    req('Criar ficha do QDD', 'POST', '/qdd-items', {
      body: J({
        departmentId: EX.deptId,
        year: 2026,
        ficha: '403',
        fonte: '1.660.000',
        projetoAtividade: 'Bolsa Família',
        naturezaDespesa: '3.3.90.14',
        valorOrcado: 100000,
      }),
    }),
    req('Atualizar ficha do QDD', 'PATCH', `/qdd-items/${EX.qddItemId}`, {
      body: J({ valorOrcado: 120000 }),
    }),
    req('Excluir ficha do QDD', 'DELETE', `/qdd-items/${EX.qddItemId}`, {}),
  ]),
])

// ═══════════════════════════════════════════════════════════════════════════
// 6. DIÁRIAS (DAILY ALLOWANCES)
// ═══════════════════════════════════════════════════════════════════════════

const dailyFolder = folder('6. Diárias (Daily Allowances)', [
  req('Listar diárias', 'GET', '/api/v1/daily-allowances', {
    query: Q({
      page: 1,
      limit: 20,
      beneficiaryName: null,
      cpf: null,
      destination: null,
      status: null,
      departmentId: null,
      issued: null,
      startDate: null,
      endDate: null,
    }),
  }),
  req('Criar diária (rascunho)', 'POST', '/api/v1/daily-allowances', {
    description:
      'Todos os campos do Anexo I (20 campos numerados do formulário físico). ' +
      'Só departmentId, beneficiaryName, destination, purpose, as datas, dailyRate e dayCount ' +
      'são obrigatórios — o restante pode ser completado antes da emissão.',
    body: J({
      departmentId: EX.deptId,
      qddItemId: EX.qddItemId,
      beneficiaryName: 'Renia Maria da Silva Noleto Candido',
      destination: 'Belém - PA',
      purpose: 'Viagem a Belém - PA para os Encontros Regionais da Estratégia Alimenta Cidades.',
      departureDate: '2026-06-27',
      returnDate: '2026-07-01',
      dailyRate: 150,
      dayCount: 5,
      beneficiaryCpf: '80299229149',
      beneficiaryRegistrationNumber: '5240',
      beneficiaryRg: '32000002 SSP/GO',
      beneficiaryJobTitle: 'Coordenadora do Bolsa Família',
      beneficiaryLotacao: 'Fundo Municipal de Assistência Social',
      beneficiaryBankName: 'Bradesco',
      beneficiaryBankAgency: '1725-6',
      beneficiaryBankAccount: '24309-4',
      departureTime: '08:00',
      arrivalTime: '18:00',
      transportMeans: 'VEICULO_OFICIAL',
      fundingSource: 'PROPRIO',
    }),
  }),
  req('Relatório de diárias (PDF)', 'GET', '/api/v1/daily-allowances/report/pdf', {
    query: Q({ beneficiaryName: null, cpf: null, destination: null, status: null, departmentId: null, issued: null, startDate: null, endDate: null }),
  }),
  req('Relatório de diárias (Excel + Manifesto, ZIP)', 'GET', '/api/v1/daily-allowances/report/excel', {
    query: Q({ beneficiaryName: null, cpf: null, destination: null, status: null, departmentId: null, issued: null, startDate: null, endDate: null }),
  }),
  req('Emitir documento oficial (Anexo I)', 'POST', `/api/v1/daily-allowances/${EX.dailyAllowanceId}/issue`, {
    description: 'Gera o PDF oficial e CONGELA o registro — a partir daqui, edição devolve 409.',
  }),
  req('Baixar PDF da diária emitida (Anexo I)', 'GET', `/api/v1/daily-allowances/${EX.dailyAllowanceId}/pdf`, {}),
  req('Prestar contas da diária', 'POST', `/api/v1/daily-allowances/${EX.dailyAllowanceId}/account-for`, {
    description: 'Gera o Anexo II (documento oficial de prestação de contas), também com hash público.',
    body: J({
      accountabilityDate: '2026-07-02',
      activityReport: 'Participação confirmada nos Encontros Regionais da Estratégia Alimenta Cidades, conforme lista de presença anexa.',
    }),
  }),
  req('Baixar PDF da prestação de contas (Anexo II)', 'GET', `/api/v1/daily-allowances/${EX.dailyAllowanceId}/accountability/pdf`, {}),
  req('Detalhar diária', 'GET', `/api/v1/daily-allowances/${EX.dailyAllowanceId}`, {}),
  req('Atualizar diária (somente rascunho)', 'PATCH', `/api/v1/daily-allowances/${EX.dailyAllowanceId}`, {
    body: J({ dailyRate: 180, dayCount: 4 }),
  }),
  req('Excluir diária (somente rascunho)', 'DELETE', `/api/v1/daily-allowances/${EX.dailyAllowanceId}`, {}),
  folder('Beneficiários', [
    req('Listar beneficiários', 'GET', '/api/v1/beneficiaries', {
      query: Q({ search: null, cpf: null }),
    }),
    req('Criar/completar beneficiário (idempotente)', 'POST', '/api/v1/beneficiaries', {
      description:
        'Idempotente: reenviar um nome já cadastrado devolve o registro existente (200) em vez de erro. ' +
        'Nome novo cria (201). CPF sempre volta MASCARADO nas listagens.',
      body: J({
        name: 'Renia Maria da Silva Noleto Candido',
        cpf: '80299229149',
        departmentId: EX.deptId,
        registrationNumber: '5240',
        rg: '32000002 SSP/GO',
        jobTitle: 'Coordenadora do Bolsa Família',
        lotacao: 'Fundo Municipal de Assistência Social',
        bankName: 'Bradesco',
        bankAgency: '1725-6',
        bankAccount: '24309-4',
      }),
    }),
    req('Remover beneficiário da lista', 'DELETE', `/api/v1/beneficiaries/${EX.beneficiaryId}`, {}),
  ]),
])

// ═══════════════════════════════════════════════════════════════════════════
// 7. PROCESSOS VIRTUAIS & CONVÊNIOS
// ═══════════════════════════════════════════════════════════════════════════

const processFolder = folder('7. Processos Virtuais & Convênios', [
  folder('Processos Virtuais', [
    req('Listar processos virtuais', 'GET', '/virtual-processes', {
      query: Q({
        page: 1, limit: 20, search: null, status: null, secretaria: null, bankAccount: null,
        source: null, category: null, companyCnpj: null, companyName: null,
        startDate: null, endDate: null, expiringIn: null,
      }),
    }),
    req('Autuar novo processo virtual', 'POST', '/virtual-processes', {
      body: J({
        departmentId: EX.deptId,
        processNumber: '001/2026',
        secretaria: 'Secretaria de Obras',
        source: 'Recursos Próprios',
        sourceDetail: 'Tesouro Municipal',
        subject: 'Contratação de empresa para pavimentação asfáltica',
        category: 'Licitação',
        totalValue: 250000.5,
        validityDate: '2026-12-31T00:00:00.000Z',
      }),
    }),
    req('Detalhar processo virtual', 'GET', `/virtual-processes/${EX.processId}`, {}),
    req('Alterar status do processo', 'PATCH', `/virtual-processes/${EX.processId}/status`, {
      body: J({ status: 'Concluído' }),
    }),
    req('Atualizar dados da empresa contratada', 'PATCH', `/virtual-processes/${EX.processId}/company`, {
      body: J({ companyName: 'Construtora Exemplo Ltda', companyCnpj: '98765432000188' }),
    }),
    req('Atualizar vigência/valor do processo', 'PATCH', `/virtual-processes/${EX.processId}/validity`, {
      body: J({ validityDate: '2027-06-30T00:00:00.000Z', totalValue: 275000 }),
    }),
    req('Excluir processo (até 24h após criação)', 'DELETE', `/virtual-processes/${EX.processId}`, {}),
    req('Anexar documento ao processo', 'POST', `/virtual-processes/${EX.processId}/documents`, {
      body: FD([
        { key: 'file', type: 'file', src: '' },
        { key: 'tag', type: 'text', value: 'Edital' },
        { key: 'description', type: 'text', value: 'Edital de licitação assinado.' },
      ]),
    }),
    req('Baixar documento do processo', 'GET', `/virtual-processes/${EX.processId}/documents/${EX.processDocId}/download`, {}),
    req('Excluir documento do processo (até 24h)', 'DELETE', `/virtual-processes/${EX.processId}/documents/${EX.processDocId}`, {}),
    folder('Cadastros auxiliares', [
      req('Listar categorias', 'GET', '/virtual-processes/categories', {}),
      req('Criar categoria', 'POST', '/virtual-processes/categories', { body: J({ name: 'Licitação' }) }),
      req('Atualizar categoria', 'PUT', '/virtual-processes/categories/{{virtualProcessCategoryId}}', { body: J({ name: 'Licitação e Contratos' }) }),
      req('Excluir categoria', 'DELETE', '/virtual-processes/categories/{{virtualProcessCategoryId}}', {}),
      req('Listar origens do recurso', 'GET', '/virtual-processes/sources', {}),
      req('Criar origem do recurso', 'POST', '/virtual-processes/sources', { body: J({ name: 'Recursos Próprios' }) }),
      req('Atualizar origem do recurso', 'PUT', '/virtual-processes/sources/{{virtualProcessSourceId}}', { body: J({ name: 'Recursos Próprios (Tesouro)' }) }),
      req('Excluir origem do recurso', 'DELETE', '/virtual-processes/sources/{{virtualProcessSourceId}}', {}),
      req('Listar empresas contratadas', 'GET', '/virtual-processes/companies', {}),
      req('Criar empresa contratada', 'POST', '/virtual-processes/companies', { body: J({ name: 'Construtora Exemplo Ltda', cnpj: '98765432000188' }) }),
      req('Atualizar empresa contratada', 'PUT', '/virtual-processes/companies/{{virtualProcessCompanyId}}', { body: J({ name: 'Construtora Exemplo S.A.', cnpj: '98765432000188' }) }),
      req('Excluir empresa contratada', 'DELETE', '/virtual-processes/companies/{{virtualProcessCompanyId}}', {}),
    ]),
  ]),
  folder('Convênios', [
    req('Listar convênios', 'GET', '/covenants', {
      query: Q({ page: 1, limit: 50, search: null, typeId: null, status: null }),
    }),
    req('Detalhar convênio', 'GET', `/covenants/${EX.covenantId}`, {}),
    req('Criar convênio', 'POST', '/covenants', {
      body: J({
        departmentId: EX.deptId,
        number: 'CV-001/2026',
        processObject: 'Construção de posto de saúde',
        status: 'EM_ANALISE',
        budgetaryAction: 'Ação 1234',
        validityStartDate: '2026-01-01T00:00:00.000Z',
        validityEndDate: '2027-12-31T00:00:00.000Z',
        transferValue: 500000,
        counterpartValue: 50000,
        bankName: 'Banco do Brasil',
        bankAgency: '1234-5',
        bankAccount: '67890-1',
      }),
    }),
    req('Atualizar convênio', 'PUT', `/covenants/${EX.covenantId}`, {
      body: J({ status: 'VIGENTE' }),
    }),
    req('Excluir convênio', 'DELETE', `/covenants/${EX.covenantId}`, {}),
    req('Vincular processo virtual ao convênio', 'POST', `/covenants/${EX.covenantId}/processes`, {
      body: J({ processId: EX.processId }),
    }),
    req('Desvincular processo virtual do convênio', 'DELETE', `/covenants/${EX.covenantId}/processes/${EX.processId}`, {}),
    folder('Cadastros auxiliares', [
      req('Listar tipos de convênio', 'GET', '/covenants/types', {}),
      req('Criar tipo de convênio', 'POST', '/covenants/types', { body: J({ name: 'Convênio Federal' }) }),
      req('Excluir tipo de convênio', 'DELETE', '/covenants/types/{{covenantTypeId}}', {}),
      req('Listar convenentes', 'GET', '/covenants/convenentes', {}),
      req('Criar convenente', 'POST', '/covenants/convenentes', { body: J({ name: 'Prefeitura Municipal', cnpj: '12345678000199' }) }),
      req('Excluir convenente', 'DELETE', '/covenants/convenentes/{{convenenteId}}', {}),
      req('Listar concedentes', 'GET', '/covenants/concedentes', {}),
      req('Criar concedente', 'POST', '/covenants/concedentes', { body: J({ name: 'Ministério da Saúde', cnpj: '00000000000191' }) }),
      req('Excluir concedente', 'DELETE', '/covenants/concedentes/{{concedenteId}}', {}),
    ]),
  ]),
])

// ═══════════════════════════════════════════════════════════════════════════
// 8. CONSELHOS MUNICIPAIS
// ═══════════════════════════════════════════════════════════════════════════

const councilFolder = folder('8. Conselhos Municipais', [
  req('Listar conselhos', 'GET', '/councils', {
    query: Q({ page: 1, limit: 20, search: null, isActive: null }),
  }),
  req('Criar conselho', 'POST', '/councils', {
    body: J({
      name: 'Conselho Municipal de Assistência Social',
      acronym: 'CMAS',
      description: 'Órgão de deliberação e controle da política de assistência social.',
      legalBasis: 'Lei Municipal nº 123/2000',
    }),
  }),
  req('Calendário anual de reuniões (PDF)', 'GET', `/councils/${EX.councilId}/calendar/2026/pdf`, {}),
  req('Detalhar conselho', 'GET', `/councils/${EX.councilId}`, {}),
  req('Atualizar conselho', 'PUT', `/councils/${EX.councilId}`, {
    body: J({ description: 'Órgão de deliberação, controle e financiamento da política de assistência social.' }),
  }),
  req('Excluir conselho (soft delete)', 'DELETE', `/councils/${EX.councilId}`, {}),
  folder('Membros', [
    req('Listar membros', 'GET', `/councils/${EX.councilId}/members`, {}),
    req('Adicionar membro', 'POST', `/councils/${EX.councilId}/members`, {
      body: J({ userId: EX.userId, role: 'MEMBRO_TITULAR', startDate: '2026-01-01T00:00:00.000Z' }),
    }),
    req('Atualizar membro', 'PUT', `/councils/${EX.councilId}/members/${EX.membershipId}`, {
      body: J({ role: 'PRESIDENTE' }),
    }),
    req('Remover membro', 'DELETE', `/councils/${EX.councilId}/members/${EX.membershipId}`, {}),
  ]),
  folder('Departamentos vinculados', [
    req('Listar setores vinculados', 'GET', `/councils/${EX.councilId}/departments`, {}),
    req('Vincular setor', 'POST', `/councils/${EX.councilId}/departments`, { body: J({ departmentId: EX.deptId }) }),
    req('Desvincular setor', 'DELETE', `/councils/${EX.councilId}/departments/${EX.deptId}`, {}),
  ]),
  folder('Reuniões', [
    req('Listar reuniões', 'GET', `/councils/${EX.councilId}/meetings`, {}),
    req('Criar reunião', 'POST', `/councils/${EX.councilId}/meetings`, {
      body: J({
        title: 'Reunião Ordinária de Junho',
        description: 'Pauta: aprovação do plano de ação 2026.',
        location: 'Sala de Reuniões da Prefeitura',
        scheduledAt: '2026-06-15T14:00:00.000Z',
      }),
    }),
    req('Detalhar reunião', 'GET', `/councils/${EX.councilId}/meetings/${EX.meetingId}`, {}),
    req('Atualizar reunião', 'PUT', `/councils/${EX.councilId}/meetings/${EX.meetingId}`, {
      description: 'Bloqueado (403) se a reunião estiver CONGELADA (>72h do horário agendado).',
      body: J({ location: 'Auditório Municipal' }),
    }),
    req('Excluir reunião', 'DELETE', `/councils/${EX.councilId}/meetings/${EX.meetingId}`, {}),
    req('Atualizar status da reunião', 'PATCH', `/councils/${EX.councilId}/meetings/${EX.meetingId}/status`, {
      body: J({ status: 'CONCLUIDA' }),
    }),
    folder('Pauta', [
      req('Adicionar item de pauta', 'POST', `/councils/${EX.councilId}/meetings/${EX.meetingId}/agenda`, {
        body: J({ order: 1, title: 'Aprovação da ata anterior', description: 'Leitura e votação.' }),
      }),
      req('Atualizar item de pauta', 'PUT', `/councils/${EX.councilId}/meetings/${EX.meetingId}/agenda/${EX.itemId}`, {
        body: J({ status: 'APROVADO', votingRemarks: 'Aprovado por unanimidade.' }),
      }),
      req('Remover item de pauta', 'DELETE', `/councils/${EX.councilId}/meetings/${EX.meetingId}/agenda/${EX.itemId}`, {}),
    ]),
    folder('Presença', [
      req('Consultar lista de presença', 'GET', `/councils/${EX.councilId}/meetings/${EX.meetingId}/attendance`, {}),
      req('Registrar presença', 'PUT', `/councils/${EX.councilId}/meetings/${EX.meetingId}/attendance`, {
        body: J({
          attendance: [
            { membershipId: EX.membershipId, isPresent: true },
            { membershipId: '{{outroMembershipId}}', isPresent: false, justifiedAbsence: true },
          ],
        }),
      }),
    ]),
    folder('Documentos e Assinatura', [
      req('Listar documentos da reunião', 'GET', `/councils/${EX.councilId}/meetings/${EX.meetingId}/documents`, {}),
      req('Upload de documento (ata)', 'POST', `/councils/${EX.councilId}/meetings/${EX.meetingId}/documents`, {
        body: FD([
          { key: 'file', type: 'file', src: '' },
          { key: 'title', type: 'text', value: 'Ata da Reunião Ordinária de Junho' },
          { key: 'documentType', type: 'text', value: 'ATA' },
        ]),
      }),
      req('Baixar documento', 'GET', `/councils/${EX.councilId}/meetings/${EX.meetingId}/documents/${EX.docId}/download`, {}),
      req('Excluir documento', 'DELETE', `/councils/${EX.councilId}/meetings/${EX.meetingId}/documents/${EX.docId}`, {}),
      req('Iniciar assinatura Gov.br', 'POST', '/councils/sign/initiate', {
        body: J({ documentId: EX.docId }),
      }),
      req('Consultar status da assinatura', 'GET', '/councils/sign/{{signatureRequestId}}/status', {}),
      req('Callback OAuth2 Gov.br (uso interno, não chamar manualmente)', 'GET', '/councils/sign/callback', {
        auth: 'noauth',
        description: 'Rota pública de callback do fluxo OAuth2. O navegador é redirecionado para cá pelo Gov.br — não é para ser chamada diretamente.',
        query: Q({ code: '{{govBrCode}}', state: '{{govBrState}}' }),
      }),
    ]),
  ]),
])

// ═══════════════════════════════════════════════════════════════════════════
// 9. FROTA / ABASTECIMENTOS
// ═══════════════════════════════════════════════════════════════════════════

const fleetFolder = folder('9. Frota / Abastecimentos', [
  req('Listar abastecimentos', 'GET', '/fleet-fuelings', {
    query: Q({ page: 1, limit: 20, departmentId: null, licensePlate: null, issued: null, startDate: null, endDate: null }),
  }),
  req('Registrar abastecimento', 'POST', '/fleet-fuelings', {
    body: J({
      departmentId: EX.deptId,
      licensePlate: 'ABC1D23',
      odometer: 45230,
      liters: 40.5,
      totalValue: 250.0,
      date: '2026-06-10T00:00:00.000Z',
    }),
  }),
  req('Emitir documento oficial de abastecimento', 'POST', `/fleet-fuelings/${EX.fleetFuelingId}/issue`, {}),
  req('Baixar PDF do abastecimento emitido', 'GET', `/fleet-fuelings/${EX.fleetFuelingId}/pdf`, {}),
  req('Detalhar abastecimento', 'GET', `/fleet-fuelings/${EX.fleetFuelingId}`, {}),
  req('Atualizar abastecimento (somente rascunho)', 'PATCH', `/fleet-fuelings/${EX.fleetFuelingId}`, {
    body: J({ odometer: 45280, liters: 42 }),
  }),
  req('Excluir abastecimento (somente rascunho)', 'DELETE', `/fleet-fuelings/${EX.fleetFuelingId}`, {}),
])

// ═══════════════════════════════════════════════════════════════════════════
// 10. TRILHA DE AUDITORIA (AUDIT LEDGER)
// ═══════════════════════════════════════════════════════════════════════════

const auditFolder = folder('10. Trilha de Auditoria (Audit Ledger)', [
  req('Consultar trilha de auditoria', 'GET', '/api/v1/audit', {
    description:
      'Somente leitura — não existe endpoint de alteração/remoção de auditoria. ' +
      'Super admin pode filtrar por organizationId; usuário comum vê só a própria organização.',
    query: Q({
      page: 1, limit: 50, userId: null, organizationId: null, action: null, resource: null,
      startDate: null, endDate: null,
    }),
  }),
])

// ═══════════════════════════════════════════════════════════════════════════
// 11. PROTOCOLOS & ATOS NORMATIVOS
// ═══════════════════════════════════════════════════════════════════════════

const protocolFolder = folder('11. Protocolos & Atos Normativos', [
  req('Gerar número de protocolo (RESERVADO)', 'POST', '/protocols/generate', {
    description:
      'documentCategory=COMUNICACAO exige departmentId (numeração sequencial automática por setor). ' +
      'documentCategory=NORMATIVO exige sequenceNumber e year informados manualmente.',
    body: J({
      documentCategory: 'COMUNICACAO',
      documentType: 'Ofício',
      numberingType: 'SEQUENTIAL',
      subject: 'Solicitação de manutenção predial',
      recipient: 'Secretaria de Obras',
      departmentId: EX.deptId,
    }),
  }),
  req('Listar documentos protocolados', 'GET', '/protocols', {
    query: Q({ page: 1, limit: 20, search: null, documentCategory: null, documentType: null, sector: null, status: null, year: null, month: null }),
  }),
  req('Atualizar status do protocolo', 'PATCH', `/protocols/${EX.protocolId}/status`, {
    body: J({ status: 'EMITIDO', libraryDocumentId: EX.libraryDocId }),
  }),
  req('Excluir protocolo (somente RESERVADO)', 'DELETE', `/protocols/${EX.protocolId}`, {}),
  req('Relatório de protocolos (PDF)', 'GET', '/protocols/report', {
    query: Q({ startDate: null, endDate: null, documentCategory: null, type: null }),
  }),
  req('Consultar contadores de sequência', 'GET', '/protocols/sequences', {
    query: Q({ year: null }),
  }),
])

// ═══════════════════════════════════════════════════════════════════════════
// 12. FINANCEIRO
// ═══════════════════════════════════════════════════════════════════════════

const financeFolder = folder('12. Financeiro', [
  folder('Contas Bancárias', [
    req('Criar conta bancária', 'POST', '/finance/accounts', {
      body: J({ name: 'Conta Movimento', agency: '1234-5', accountNumber: '67890-1', initialBalanceCents: 0 }),
    }),
    req('Listar contas bancárias', 'GET', '/finance/accounts', {}),
    req('Atualizar conta bancária', 'PUT', `/finance/accounts/${EX.accountId}`, {
      body: J({ name: 'Conta Movimento - Principal' }),
    }),
    req('Excluir conta bancária', 'DELETE', `/finance/accounts/${EX.accountId}`, {}),
  ]),
  folder('Categorias', [
    req('Criar categoria financeira', 'POST', '/finance/categories', {
      body: J({ name: 'Educação', description: 'Despesas com material e infraestrutura escolar.' }),
    }),
    req('Listar categorias financeiras', 'GET', '/finance/categories', {}),
    req('Atualizar categoria financeira', 'PUT', `/finance/categories/${EX.categoryId}`, {
      body: J({ name: 'Educação Infantil' }),
    }),
    req('Excluir categoria financeira', 'DELETE', `/finance/categories/${EX.categoryId}`, {}),
  ]),
  folder('Lançamentos', [
    req('Criar lançamento', 'POST', '/finance/entries', {
      body: J({
        occurredAt: '2026-06-10T00:00:00.000Z',
        description: 'Compra de material de limpeza',
        amountCents: 45000,
        type: 'EXPENSE',
        categoryId: EX.categoryId,
        accountId: EX.accountId,
        subcategoryName: 'Material de Consumo',
        providerDocument: '12345678000199',
        nfeNumber: '000123',
        empenhoNumber: 'EMP-2026-001',
        liquidacaoNumber: 'LIQ-2026-001',
        issueDate: '2026-06-08T00:00:00.000Z',
        deliveryDate: '2026-06-09T00:00:00.000Z',
        attachmentsStatus: 'none',
      }),
    }),
    req('Listar lançamentos', 'GET', '/finance/entries', {
      query: Q({ startDate: null, endDate: null, type: null, categoryNames: null, page: 1, limit: 20, search: null }),
    }),
    req('Atualizar lançamento', 'PUT', `/finance/entries/${EX.entryId}`, {
      body: J({ description: 'Compra de material de limpeza (revisado)' }),
    }),
    req('Excluir lançamento', 'DELETE', `/finance/entries/${EX.entryId}`, {}),
    req('Listar anexos do lançamento', 'GET', `/finance/entries/${EX.entryId}/attachments`, {}),
    req('Anexar comprovante ao lançamento', 'POST', `/finance/entries/${EX.entryId}/attachments`, {
      body: FD([{ key: 'file', type: 'file', src: '' }]),
    }),
    req('Excluir anexo do lançamento', 'DELETE', `/finance/entries/${EX.entryId}/attachments/${EX.attachmentId}`, {}),
  ]),
  req('Relatório financeiro (PDF)', 'GET', '/finance/report/pdf', {
    query: Q({ type: null, search: null, categoryNames: null, startDate: null, endDate: null }),
  }),
])

// ═══════════════════════════════════════════════════════════════════════════
// 13. BIBLIOTECA DE DOCUMENTOS
// ═══════════════════════════════════════════════════════════════════════════

const libraryFolder = folder('13. Biblioteca de Documentos', [
  req('Upload de documento (PDF)', 'POST', '/api/v1/library/upload', {
    body: FD([
      { key: 'file', type: 'file', src: '' },
      { key: 'title', type: 'text', value: 'Edital de Licitação 001/2026' },
      { key: 'accessLevel', type: 'text', value: '1' },
      { key: 'categoryId', type: 'text', value: EX.libraryCategoryId },
    ]),
  }),
  req('Listar documentos', 'GET', '/api/v1/library', {
    query: Q({ search: null, categoryId: null, covenantId: null, page: 1, limit: 20 }),
  }),
  req('Baixar documento', 'GET', `/api/v1/library/${EX.libraryDocId}/download`, {}),
  req('Excluir documento (soft delete)', 'DELETE', `/api/v1/library/${EX.libraryDocId}`, {}),
  req('Download em lote (ZIP)', 'POST', '/api/v1/library/download-zip', {
    body: J({ documentIds: [EX.libraryDocId] }),
  }),
  req('Log de acessos', 'GET', '/api/v1/library/logs', {
    query: Q({ page: 1, limit: 30 }),
  }),
  folder('Categorias', [
    req('Listar categorias', 'GET', '/api/v1/library/categories', {}),
    req('Criar categoria', 'POST', '/api/v1/library/categories', { body: J({ name: 'Licitações' }) }),
    req('Excluir categoria', 'DELETE', `/api/v1/library/categories/${EX.libraryCategoryId}`, {}),
  ]),
])

// ═══════════════════════════════════════════════════════════════════════════
// 14. COMUNICAÇÃO INTERNA
// ═══════════════════════════════════════════════════════════════════════════

const commFolder = folder('14. Comunicação Interna', [
  req('Upload de anexo para mensagem', 'POST', '/api/v1/communication/messages/upload', {
    body: FD([{ key: 'file', type: 'file', src: '' }]),
  }),
  req('Criar e enviar mensagem', 'POST', '/api/v1/communication/messages', {
    body: J({
      subject: 'Reunião de alinhamento',
      body: 'Prezados, segue convite para reunião de alinhamento na quinta-feira às 14h.',
      recipients: [{ userId: EX.userId, role: 'TO' }],
      attachments: [],
    }),
  }),
  req('Caixa de entrada', 'GET', '/api/v1/communication/inbox', {
    query: Q({ startDate: null, endDate: null, personId: null }),
  }),
  req('Mensagens enviadas', 'GET', '/api/v1/communication/sent', {
    query: Q({ startDate: null, endDate: null, personId: null }),
  }),
  req('Destinatários elegíveis', 'GET', '/api/v1/communication/recipients', {
    query: Q({ search: null }),
  }),
  req('Detalhar mensagem', 'GET', `/api/v1/communication/messages/${EX.messageId}`, {}),
  req('Atualizar rascunho', 'PUT', `/api/v1/communication/messages/${EX.messageId}`, {
    body: J({ subject: 'Reunião de alinhamento (revisado)' }),
  }),
  req('Excluir rascunho', 'DELETE', `/api/v1/communication/messages/${EX.messageId}`, {}),
  req('Baixar anexo da mensagem', 'GET', `/api/v1/communication/messages/${EX.messageId}/attachments/${EX.attachmentId}/download`, {}),
])

// ═══════════════════════════════════════════════════════════════════════════
// 15. WORKSPACES & TAREFAS
// ═══════════════════════════════════════════════════════════════════════════

const workspaceFolder = folder('15. Workspaces & Tarefas', [
  folder('Workspaces', [
    req('Criar workspace', 'POST', '/workspaces', {
      body: J({ name: 'Projeto Reforma da Escola Municipal', description: 'Acompanhamento da obra.', departmentId: EX.deptId }),
    }),
    req('Listar meus workspaces', 'GET', '/workspaces', {}),
    req('Detalhar workspace', 'GET', `/workspaces/${EX.workspaceId}`, {}),
    req('Excluir workspace (somente OWNER)', 'DELETE', `/workspaces/${EX.workspaceId}`, {}),
    req('Adicionar membro ao workspace', 'POST', `/workspaces/${EX.workspaceId}/members`, {
      body: J({ email: 'colega@prefeitura.gov.br', role: 'MEMBER' }),
    }),
    req('Remover membro do workspace', 'DELETE', `/workspaces/${EX.workspaceId}/members/${EX.userId}`, {}),
    req('Usuários atribuíveis do workspace', 'GET', `/workspaces/${EX.workspaceId}/assignable-users`, {}),
  ]),
  folder('Tarefas', [
    req('Criar tarefa no workspace', 'POST', `/workspaces/${EX.workspaceId}/tasks`, {
      body: J({
        title: 'Vistoria inicial da obra',
        description: 'Levantamento fotográfico do estado atual.',
        priority: 'HIGH',
        status: 'TODO',
        dueDate: '2026-06-20T00:00:00.000Z',
        assigneeIds: [EX.userId],
      }),
    }),
    req('Listar tarefas do workspace', 'GET', `/workspaces/${EX.workspaceId}/tasks`, {}),
    req('Detalhar tarefa', 'GET', `/tasks/${EX.taskId}`, {}),
    req('Atualizar tarefa', 'PUT', `/tasks/${EX.taskId}`, {
      body: J({ priority: 'URGENT', status: 'IN_PROGRESS' }),
    }),
    req('Excluir tarefa', 'DELETE', `/tasks/${EX.taskId}`, {}),
    req('Mover tarefa (alterar status)', 'PATCH', `/tasks/${EX.taskId}/status`, {
      body: J({ status: 'DONE' }),
    }),
    req('Adicionar item ao checklist', 'POST', `/tasks/${EX.taskId}/checklist`, {
      body: J({ title: 'Fotografar fachada principal' }),
    }),
    req('Atualizar item do checklist', 'PUT', `/tasks/checklist/${EX.checklistItemId}`, {
      body: J({ isDone: true }),
    }),
    req('Remover item do checklist', 'DELETE', `/tasks/checklist/${EX.checklistItemId}`, {}),
    req('Comentar na tarefa', 'POST', `/tasks/${EX.taskId}/notes`, {
      body: J({ content: 'Vistoria remarcada para sexta-feira.' }),
    }),
    req('Excluir comentário', 'DELETE', `/tasks/${EX.taskId}/notes/${EX.noteId}`, {}),
    req('Anexar arquivo à tarefa', 'POST', `/tasks/${EX.taskId}/attachments`, {
      body: FD([{ key: 'file', type: 'file', src: '' }]),
    }),
    req('Excluir anexo da tarefa', 'DELETE', `/tasks/attachments/${EX.attachmentId}`, {}),
    req('Adicionar responsável à tarefa', 'POST', `/tasks/${EX.taskId}/assignees`, {
      body: J({ userId: EX.userId }),
    }),
    req('Remover responsável da tarefa', 'DELETE', `/tasks/${EX.taskId}/assignees/${EX.userId}`, {}),
  ]),
])

// ═══════════════════════════════════════════════════════════════════════════
// 16. UTILIDADES (Calendário, Notas, Notificações)
// ═══════════════════════════════════════════════════════════════════════════

const utilitiesFolder = folder('16. Utilidades', [
  folder('Calendário', [
    req('Listar eventos', 'GET', '/api/v1/utilities/calendar', {
      query: Q({ start: null, end: null }),
    }),
    req('Criar evento', 'POST', '/api/v1/utilities/calendar', {
      body: J({
        title: 'Audiência Pública do Orçamento',
        description: 'Apresentação da proposta orçamentária 2027.',
        startAt: '2026-09-15T18:00:00.000Z',
        endAt: '2026-09-15T20:00:00.000Z',
        allDay: false,
        color: '#3B82F6',
        location: 'Câmara Municipal',
      }),
    }),
    req('Atualizar evento', 'PUT', `/api/v1/utilities/calendar/${EX.calendarEventId}`, {
      body: J({ location: 'Auditório da Prefeitura' }),
    }),
    req('Excluir evento', 'DELETE', `/api/v1/utilities/calendar/${EX.calendarEventId}`, {}),
    req('Alertas de hoje/amanhã', 'GET', '/api/v1/utilities/calendar/today-alerts', {}),
  ]),
  folder('Notas', [
    req('Listar minhas notas', 'GET', '/api/v1/utilities/notes', {}),
    req('Criar nota', 'POST', '/api/v1/utilities/notes', {
      body: J({ title: 'Lembrete', content: 'Ligar para o fornecedor sobre o atraso na entrega.', color: '#FDE68A' }),
    }),
    req('Atualizar nota', 'PUT', `/api/v1/utilities/notes/${EX.noteId}`, {
      body: J({ content: 'Ligar para o fornecedor — já resolvido, aguardando NF.' }),
    }),
    req('Excluir nota', 'DELETE', `/api/v1/utilities/notes/${EX.noteId}`, {}),
  ]),
  folder('Notificações', [
    req('Stream de notificações em tempo real (SSE)', 'GET', '/notifications/stream', {
      description: 'Conexão Server-Sent Events de longa duração — não é uma chamada request/response comum.',
    }),
    req('Listar notificações', 'GET', '/notifications', {}),
    req('Atualizar preferências de notificação', 'PATCH', '/notifications/preferences', {
      body: J({ emailNotifications: true, autoClearDays: 30 }),
    }),
    req('Marcar todas como lidas', 'PATCH', '/notifications/read-all', {}),
    req('Marcar uma como lida', 'PATCH', `/notifications/${EX.notificationId}/read`, {}),
    req('Excluir todas as notificações', 'DELETE', '/notifications', {}),
    req('Excluir uma notificação', 'DELETE', `/notifications/${EX.notificationId}`, {}),
  ]),
  req('Upload genérico de arquivo', 'POST', '/api/v1/upload', {
    body: FD([{ key: 'file', type: 'file', src: '' }]),
  }),
])

// ═══════════════════════════════════════════════════════════════════════════
// 17. SUPORTE
// ═══════════════════════════════════════════════════════════════════════════

const supportFolder = folder('17. Suporte', [
  req('Abrir chamado/chat de suporte', 'POST', '/support', {
    body: J({ type: 'TICKET', subject: 'Erro ao emitir diária', message: 'Ao clicar em emitir, a tela trava.' }),
  }),
  req('Listar chamados', 'GET', '/support', {
    description: 'Super admin vê todos; usuário comum vê apenas os próprios.',
    query: Q({ status: null, type: null, page: 1, limit: 20 }),
  }),
  req('Insights de suporte (super admin)', 'GET', '/support/insights', {}),
  req('Ver mensagens do chamado', 'GET', `/support/${EX.supportRequestId}/messages`, {}),
  req('Responder chamado', 'POST', `/support/${EX.supportRequestId}/messages`, {
    body: J({ content: 'Já identificamos a causa, correção sai ainda hoje.' }),
  }),
  req('Atualizar status do chamado (super admin)', 'PATCH', `/support/${EX.supportRequestId}/status`, {
    body: J({ status: 'RESOLVED' }),
  }),
])

// ═══════════════════════════════════════════════════════════════════════════
// 18. VALIDAÇÃO PÚBLICA & SAÚDE DO SISTEMA
// ═══════════════════════════════════════════════════════════════════════════

const publicFolder = folder('18. Validação Pública & Saúde do Sistema', [
  req('Validar documento pelo QR Code (UUID)', 'GET', '/api/v1/public/documents/validate/{{documentPublicId}}', {
    auth: 'noauth',
    description:
      'Portal público sem autenticação — o que o cidadão/fiscal acessa ao ler o QR Code impresso no ' +
      'documento oficial. Rate limit próprio: 30/min.',
  }),
  req('Validar documento por hash (legado, removido)', 'GET', '/public/validate/{{documentHash}}', {
    auth: 'noauth',
    description: 'Endpoint legado — hoje sempre responde 410 Gone. Mantido só para não quebrar links antigos.',
  }),
  req('Health check', 'GET', '/health', { auth: 'noauth' }),
  req('Test endpoint', 'GET', '/test', { auth: 'noauth' }),
])

// ═══════════════════════════════════════════════════════════════════════════
// MONTAGEM FINAL
// ═══════════════════════════════════════════════════════════════════════════

const collection = {
  info: {
    _postman_id: randomUUID(),
    name: 'SIMP-BACKEND — API Completa',
    description:
      'Coleção completa das rotas ativas do SIMP-BACKEND (Sistema Integrado de Gestão Municipal), ' +
      'extraída diretamente de `src/routes/`, `src/controllers/` e dos schemas Zod de validação.\n\n' +
      '**Autenticação:** a coleção usa Bearer Token via `{{token}}` (herdado por padrão em todas as ' +
      'pastas). Rode "Login" primeiro — o script em Tests salva o token automaticamente no Environment.\n\n' +
      '**Multi-tenant:** a organização do usuário logado é sempre resolvida no SERVIDOR a partir do ' +
      'token — nenhuma rota aceita `organizationId` no corpo da requisição para essa finalidade.\n\n' +
      '**Convenção de path params:** segmentos como `:id` viram variáveis de path editáveis no Postman ' +
      '(aba "Params" de cada requisição). Os exemplos de corpo usam variáveis de Environment ' +
      '(`{{departmentId}}`, `{{dailyAllowanceId}}` etc.) — preencha-as ao criar os recursos correspondentes ' +
      'para encadear as chamadas.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
  },
  event: [],
  variable: [{ key: 'baseUrl', value: 'http://localhost:3000', type: 'string' }],
  item: [
    authFolder,
    orgFolder,
    usersFolder,
    deptFolder,
    budgetFolder,
    dailyFolder,
    processFolder,
    councilFolder,
    fleetFolder,
    auditFolder,
    protocolFolder,
    financeFolder,
    libraryFolder,
    commFolder,
    workspaceFolder,
    utilitiesFolder,
    supportFolder,
    publicFolder,
  ],
}

// Script de Tests do Login — salva o token no Environment automaticamente.
const loginItem = authFolder.item[1]
loginItem.event = [
  {
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: [
        "if (pm.response.code === 200) {",
        "    const response = pm.response.json();",
        "    const token = response.token || response.accessToken",
        "        || (response.data && response.data.token)",
        "        || (response.tokens && response.tokens.accessToken);",
        "    if (token) {",
        "        pm.environment.set('token', token);",
        "        console.log('Token salvo no Environment.');",
        "    }",
        "    const refreshToken = response.refreshToken || (response.tokens && response.tokens.refreshToken);",
        "    if (refreshToken) {",
        "        pm.environment.set('refreshToken', refreshToken);",
        "    }",
        "}",
      ],
    },
  },
]

// A rota de onboarding público de organização também devolve um token —
// captura no mesmo padrão, útil para popular o Environment sem passar por login.
const onboardOrgItem = orgFolder.item[1]
onboardOrgItem.event = [
  {
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: [
        "if (pm.response.code === 201) {",
        "    const response = pm.response.json();",
        "    if (response.tokens && response.tokens.accessToken) {",
        "        pm.environment.set('token', response.tokens.accessToken);",
        "    }",
        "    if (response.org && response.org.id) {",
        "        pm.environment.set('organizationId', response.org.id);",
        "    }",
        "}",
      ],
    },
  },
]

// ─── Environment ─────────────────────────────────────────────────────────

const environment = {
  id: randomUUID(),
  name: 'SIMP-BACKEND — Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:3000', type: 'default', enabled: true },
    { key: 'token', value: '', type: 'secret', enabled: true },
    { key: 'refreshToken', value: '', type: 'secret', enabled: true },
    { key: 'loginEmail', value: 'admin@prefeitura-exemplo.gov.br', type: 'default', enabled: true },
    { key: 'loginPassword', value: 'SenhaForte@123', type: 'secret', enabled: true },
    { key: 'resetToken', value: '', type: 'default', enabled: true },
    { key: 'verifyEmailToken', value: '', type: 'default', enabled: true },
    { key: 'organizationId', value: '', type: 'default', enabled: true },
    { key: 'departmentId', value: '', type: 'default', enabled: true },
    { key: 'userId', value: '', type: 'default', enabled: true },
    { key: 'roleId', value: '', type: 'default', enabled: true },
    { key: 'sessionId', value: '', type: 'default', enabled: true },
    { key: 'councilId', value: '', type: 'default', enabled: true },
    { key: 'meetingId', value: '', type: 'default', enabled: true },
    { key: 'membershipId', value: '', type: 'default', enabled: true },
    { key: 'outroMembershipId', value: '', type: 'default', enabled: true },
    { key: 'agendaItemId', value: '', type: 'default', enabled: true },
    { key: 'documentId', value: '', type: 'default', enabled: true },
    { key: 'signatureRequestId', value: '', type: 'default', enabled: true },
    { key: 'govBrCode', value: '', type: 'default', enabled: true },
    { key: 'govBrState', value: '', type: 'default', enabled: true },
    { key: 'covenantId', value: '', type: 'default', enabled: true },
    { key: 'covenantTypeId', value: '', type: 'default', enabled: true },
    { key: 'convenenteId', value: '', type: 'default', enabled: true },
    { key: 'concedenteId', value: '', type: 'default', enabled: true },
    { key: 'virtualProcessId', value: '', type: 'default', enabled: true },
    { key: 'virtualProcessDocumentId', value: '', type: 'default', enabled: true },
    { key: 'virtualProcessCategoryId', value: '', type: 'default', enabled: true },
    { key: 'virtualProcessSourceId', value: '', type: 'default', enabled: true },
    { key: 'virtualProcessCompanyId', value: '', type: 'default', enabled: true },
    { key: 'qddItemId', value: '', type: 'default', enabled: true },
    { key: 'budgetLawId', value: '', type: 'default', enabled: true },
    { key: 'dailyAllowanceId', value: '', type: 'default', enabled: true },
    { key: 'beneficiaryId', value: '', type: 'default', enabled: true },
    { key: 'fleetFuelingId', value: '', type: 'default', enabled: true },
    { key: 'protocolId', value: '', type: 'default', enabled: true },
    { key: 'workspaceId', value: '', type: 'default', enabled: true },
    { key: 'taskId', value: '', type: 'default', enabled: true },
    { key: 'checklistItemId', value: '', type: 'default', enabled: true },
    { key: 'noteId', value: '', type: 'default', enabled: true },
    { key: 'attachmentId', value: '', type: 'default', enabled: true },
    { key: 'financeEntryId', value: '', type: 'default', enabled: true },
    { key: 'bankAccountId', value: '', type: 'default', enabled: true },
    { key: 'financeCategoryId', value: '', type: 'default', enabled: true },
    { key: 'libraryDocumentId', value: '', type: 'default', enabled: true },
    { key: 'libraryCategoryId', value: '', type: 'default', enabled: true },
    { key: 'messageId', value: '', type: 'default', enabled: true },
    { key: 'calendarEventId', value: '', type: 'default', enabled: true },
    { key: 'notificationId', value: '', type: 'default', enabled: true },
    { key: 'supportRequestId', value: '', type: 'default', enabled: true },
    { key: 'documentPublicId', value: '', type: 'default', enabled: true },
    { key: 'documentHash', value: '', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
}

// ─── Escrita dos arquivos ────────────────────────────────────────────────

const OUT_DIR = process.argv[2] || '.'
writeFileSync(`${OUT_DIR}/SIMP-Backend.postman_collection.json`, JSON.stringify(collection, null, 2))
writeFileSync(`${OUT_DIR}/SIMP-Backend.postman_environment.json`, JSON.stringify(environment, null, 2))

// Contagem de requisições para conferência.
function countRequests(items) {
  let n = 0
  for (const it of items) {
    if (it.request) n++
    else if (it.item) n += countRequests(it.item)
  }
  return n
}
console.log(`Coleção gerada: ${countRequests(collection.item)} requisições em ${collection.item.length} pastas de topo.`)
