import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * Carrega a logo de um usuário a partir de uma URL HTTP (presigned R2 ou outro).
 * @param logoUrl URL armazenada em user.metadata.logoUrl
 * @returns String Base64 da imagem ou undefined se não encontrar.
 */
export async function loadLogoFromPath(logoUrl: string | undefined | null): Promise<string | undefined> {
    if (!logoUrl) return undefined;

    try {
        const res = await fetch(logoUrl);
        if (!res.ok) return undefined;
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer).toString('base64');
    } catch (error) {
        console.warn(`Erro ao carregar logo do usuário em ${logoUrl}:`, error);
    }

    return undefined;
}

