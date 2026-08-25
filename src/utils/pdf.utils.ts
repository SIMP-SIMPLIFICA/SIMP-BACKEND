import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { config } from '@/config/config.js';
import { logger } from '@/utils/logger.js';
import { getFilePath } from '@/services/storage.service.js';
import { UnsafeUrlError, safeFetch } from '@/utils/url-security.js';

/**
 * Carrega a logo da instituição (Pequizeiro) como string Base64.
 * Tenta localizar o arquivo em múltiplos caminhos para garantir funcionamento em Dev e Prod via Docker.
 * @returns String Base64 da imagem ou undefined se não encontrar.
 */
export function loadLogoBase64(): string | undefined {
    // Lista de caminhos possíveis para a logo
    const logoPaths = [
        // 1. Caminho absoluto no container/prod (baseado no CWD) - Prioridade para volume montado ou build
        path.resolve(process.cwd(), 'src/templates/assets/logo_pequizeiro.png'),
        path.resolve(process.cwd(), 'dist/templates/assets/logo_pequizeiro.png'),

        // 2. Caminho relativo ao arquivo atual (src/utils -> src/templates/assets)
        path.resolve(__dirname, '../templates/assets/logo_pequizeiro.png'),

        // 3. Caminho de fallback (public)
        path.resolve(process.cwd(), 'public/logo.png'),
    ];

    for (const logoPath of logoPaths) {
        try {
            if (fs.existsSync(logoPath)) {
                // Lê o arquivo e converte para base64
                const fileBuffer = fs.readFileSync(logoPath);
                // Retorna apenas a string Base64 (sem o prefixo data:image/png;base64, pois os templates já adicionam ou não conforme necessidade)
                // Nos templates atuais: <img src="data:image/png;base64,{{logo_base64}}" />
                // Portanto, retornamos apenas o payload.
                return fileBuffer.toString('base64');
            }
        } catch (error) {
            console.warn(`Erro ao tentar ler logo em ${logoPath}:`, error);
        }
    }

    console.error('CRÍTICO: Logo "logo_pequizeiro.png" não encontrada em nenhum dos caminhos verificados.');
    return undefined;
}

/**
 * Carrega a logo de um usuário a partir da URL gravada em `user.metadata.logoUrl`.
 *
 * SSRF: `metadata` é gravável pelo próprio usuário (`updateProfileSchema` aceita
 * `metadata: z.record(z.any())`), então `logoUrl` é input NÃO CONFIÁVEL. Sem guarda,
 * um `PUT /users/me` com `metadata.logoUrl = "http://169.254.169.254/latest/meta-data/"`
 * faria o servidor buscar credenciais da nuvem e embutir o resultado num PDF.
 *
 * Duas camadas:
 *  1. Se a URL aponta para os uploads do próprio backend, lê do DISCO. Não há
 *     requisição de rede alguma — e continua funcionando em dev, onde APP_URL é
 *     localhost e portanto seria (corretamente) bloqueado pelo guard de SSRF.
 *  2. Qualquer outra URL (legado R2/presigned) passa por `safeFetch`, que bloqueia
 *     IPs internos em todos os saltos de redirecionamento.
 */
export async function loadLogoFromPath(logoUrl: string | undefined | null): Promise<string | undefined> {
    if (!logoUrl) return undefined;

    const localKey = resolveLocalUploadKey(logoUrl);
    if (localKey) {
        try {
            // getFilePath já rejeita path traversal (`../`) contra UPLOADS_ROOT.
            const buffer = await fsp.readFile(getFilePath(localKey));
            return buffer.toString('base64');
        } catch (error) {
            logger.warn({ err: error, logoUrl }, 'Falha ao ler logo local do usuário');
            return undefined;
        }
    }

    try {
        const res = await safeFetch(logoUrl, {}, { maxRedirects: 2, timeoutMs: 5000 });
        if (!res.ok) return undefined;
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer).toString('base64');
    } catch (error) {
        if (error instanceof UnsafeUrlError) {
            // Nível warn, não error: é uma tentativa bloqueada com sucesso, mas o
            // par (usuário, motivo) precisa ser auditável.
            logger.warn({ reason: error.reason, logoUrl }, 'Logo do usuário bloqueada por política de SSRF');
            return undefined;
        }
        logger.warn({ err: error, logoUrl }, 'Erro ao carregar logo do usuário');
    }

    return undefined;
}

/**
 * Extrai a fileKey quando a URL aponta para os uploads servidos por este backend.
 * `null` quando é uma URL externa, que então precisa passar pelo guard de SSRF.
 */
function resolveLocalUploadKey(logoUrl: string): string | null {
    const base = config.urls.app;
    if (!base) return null;

    let url: URL;
    let baseUrl: URL;
    try {
        url = new URL(logoUrl);
        baseUrl = new URL(base);
    } catch {
        return null;
    }

    if (url.origin !== baseUrl.origin) return null;
    if (!url.pathname.startsWith('/uploads/')) return null;

    // decodeURIComponent porque a chave pode ter sido percent-encoded na montagem
    // da URL; getFilePath faz a checagem de traversal sobre o valor já decodificado.
    return decodeURIComponent(url.pathname.slice('/uploads/'.length));
}

