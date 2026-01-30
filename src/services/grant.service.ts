import axios from 'axios';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

// Interface flexível para lidar com variações da API
interface ConvenioPortal {
  id: number;
  numero: string;
  objeto: string;
  valorGlobal: string | number; // Pode vir como string "100.000,00"
  valorRepasse: string | number;
  valorContrapartida: string | number;
  situacao: string;
  dataInicioVigencia: string;
  dataFimVigencia: string;
  concedente: { nome: string; sigla: string; };
}

// Helper: Formata data para URL (DD/MM/AAAA)
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Helper: Converte "R$ 1.500,50" para float javascript (1500.50)
function parseCurrency(val: string | number | undefined): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  // Remove pontos de milhar e troca virgula decimal por ponto
  const cleanStr = val.replace(/\./g, '').replace(',', '.');
  return parseFloat(cleanStr) || 0;
}

export class GrantService {
  private readonly API_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados/convenios';

  private async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper: Converte string de data da API (DD/MM/AAAA) para Date do JS
  private parseDate(dateStr: string): Date | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const [day, month, year] = parts;
    return new Date(`${year}-${month}-${day}`);
  }

  // --- NOVO MÉTODO: LIMPAR BASE LOCAL ---
  async deleteAll() {
    // Apaga primeiro as notas (por causa da chave estrangeira)
    await prisma.grantNote.deleteMany({});
    // Apaga os convênios
    await prisma.grant.deleteMany({});
    return { message: "Banco de dados limpo com sucesso." };
  }

  async getConfig() {
    const [tokenSetting, cnpjSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'GOV_API_TOKEN' } }),
      prisma.setting.findUnique({ where: { key: 'GOV_CNPJ_ALVO' } })
    ]);
    return {
      token: tokenSetting?.value ? String(tokenSetting.value) : null,
      cnpj: cnpjSetting?.value ? String(cnpjSetting.value) : null
    };
  }

  async saveConfig(token: string, cnpj: string) {
    await prisma.setting.upsert({
      where: { key: 'GOV_API_TOKEN' },
      update: { value: token },
      create: { key: 'GOV_API_TOKEN', value: token, type: 'STRING' }
    });
    const cleanCnpj = cnpj.replace(/\D/g, '');
    await prisma.setting.upsert({
      where: { key: 'GOV_CNPJ_ALVO' },
      update: { value: cleanCnpj },
      create: { key: 'GOV_CNPJ_ALVO', value: cleanCnpj, type: 'STRING' }
    });
  }

  // --- SINCRONIZAÇÃO ROBUSTA ---
  async syncGrants(filters: { startDate?: string, endDate?: string, status?: string }) {
    const config = await this.getConfig();

    if (!config.token) throw new Error('TOKEN_MISSING');
    if (!config.cnpj) throw new Error('CNPJ_MISSING');

    logger.info(`🚀 Iniciando sincronização. CNPJ: ${config.cnpj}`);

    const today = new Date();
    
    // Configura datas (padrão: 1 ano atrás)
    let startPeriod = filters.startDate ? new Date(filters.startDate) : new Date();
    if (!filters.startDate) startPeriod.setFullYear(today.getFullYear() - 1);

    let endPeriod = filters.endDate ? new Date(filters.endDate) : new Date();

    startPeriod.setHours(0,0,0,0);
    endPeriod.setHours(23,59,59,999);

    let currentRefDate = new Date(startPeriod);
    const processedIds = new Set<string>();
    
    let totalCriados = 0;
    let totalAtualizados = 0;

    while (currentRefDate <= endPeriod) {
      const chunkEndDate = new Date(currentRefDate.getFullYear(), currentRefDate.getMonth() + 1, 0);
      const finalDate = chunkEndDate > endPeriod ? endPeriod : chunkEndDate;

      const strInicio = formatDate(currentRefDate);
      const strFim = formatDate(finalDate);

      logger.info(`📅 Consultando: ${strInicio} até ${strFim}...`);

      try {
        const params: any = {
          cnpjConvenente: config.cnpj,
          pagina: 1,
          dataInicial: strInicio,
          dataFinal: strFim
        };

        if (filters.status && filters.status !== 'TODOS') {
          params.situacao = filters.status;
        }

        const response = await axios.get(this.API_URL, {
          params,
          headers: {
            'chave-api-dados': config.token,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 15000
        });

        const listaGov = response.data as ConvenioPortal[];

        if (Array.isArray(listaGov) && listaGov.length > 0) {
          let novosNestaPagina = 0;

          for (const item of listaGov) {
            const externalId = String(item.id); 

            if (processedIds.has(externalId)) continue;
            processedIds.add(externalId);
            novosNestaPagina++;

            // CORREÇÃO CRÍTICA DOS DADOS:
            const dataToSave = {
              numeroConvenio: item.numero || 'S/N',
              objeto: item.objeto || 'Objeto não informado pelo concedente',
              // Usa o helper parseCurrency para corrigir o dinheiro
              valorGlobal: parseCurrency(item.valorGlobal),
              valorRepasse: parseCurrency(item.valorRepasse),
              valorContrapartida: parseCurrency(item.valorContrapartida),
              situacao: item.situacao || 'Não informada',
              dataInicio: this.parseDate(item.dataInicioVigencia),
              dataFim: this.parseDate(item.dataFimVigencia),
              orgaoConcedente: item.concedente?.nome || 'Órgão não identificado',
              lastSyncAt: new Date()
            };

            const result = await prisma.grant.upsert({
              where: { externalId },
              update: dataToSave, // Atualiza se já existir
              create: { externalId, ...dataToSave } // Cria se não existir
            });

            if (Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 2000) {
              totalCriados++;
            } else {
              totalAtualizados++;
            }
          }
          logger.info(`   ✅ Processados ${novosNestaPagina} itens únicos.`);
        } else {
          logger.info(`   ⚠️ Nenhum item novo.`);
        }

      } catch (error: any) {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
             throw new Error('TOKEN_INVALID');
        }
        logger.warn(`   ❌ Erro no mês ${strInicio}: ${error.message}`);
      }

      currentRefDate.setMonth(currentRefDate.getMonth() + 1);
      currentRefDate.setDate(1);
      await this.delay(1200);
    }

    logger.info(`🏁 Finalizado. Total Únicos: ${processedIds.size} (Criados: ${totalCriados}, Atualizados: ${totalAtualizados})`);
    return { created: totalCriados, updated: totalAtualizados };
  }

  // Métodos de Leitura (Sem alterações)
  async listGrants(filters: { search?: string, status?: string }) {
    const where: any = {};
    if (filters.status) where.situacao = { contains: filters.status, mode: 'insensitive' };
    if (filters.search) {
      where.OR = [
        { numeroConvenio: { contains: filters.search } },
        { objeto: { contains: filters.search, mode: 'insensitive' } }
      ];
    }
    return prisma.grant.findMany({
      where,
      orderBy: { dataFim: 'desc' },
      include: { _count: { select: { notes: true } } }
    });
  }

  async addNote(userId: string, grantId: string, content: string) {
    return prisma.grantNote.create({
      data: { userId, grantId, content },
      include: { user: { select: { firstName: true, lastName: true } } }
    });
  }

  async getGrantDetails(id: string) {
    return prisma.grant.findUnique({
      where: { id },
      include: {
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { firstName: true, lastName: true, avatar: true } } }
        }
      }
    });
  }
}