"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadLogoBase64 = loadLogoBase64;
exports.loadLogoFromPath = loadLogoFromPath;
var node_fs_1 = __importDefault(require("node:fs"));
var node_path_1 = __importDefault(require("node:path"));
var node_url_1 = require("node:url");
var __filename = (0, node_url_1.fileURLToPath)(import.meta.url);
var __dirname = node_path_1.default.dirname(__filename);
/**
 * Carrega a logo da instituição (Pequizeiro) como string Base64.
 * Tenta localizar o arquivo em múltiplos caminhos para garantir funcionamento em Dev e Prod via Docker.
 * @returns String Base64 da imagem ou undefined se não encontrar.
 */
function loadLogoBase64() {
    // Lista de caminhos possíveis para a logo
    var logoPaths = [
        // 1. Caminho absoluto no container/prod (baseado no CWD) - Prioridade para volume montado ou build
        node_path_1.default.resolve(process.cwd(), 'src/templates/assets/logo_pequizeiro.png'),
        node_path_1.default.resolve(process.cwd(), 'dist/templates/assets/logo_pequizeiro.png'),
        // 2. Caminho relativo ao arquivo atual (src/utils -> src/templates/assets)
        node_path_1.default.resolve(__dirname, '../templates/assets/logo_pequizeiro.png'),
        // 3. Caminho de fallback (public)
        node_path_1.default.resolve(process.cwd(), 'public/logo.png'),
    ];
    for (var _i = 0, logoPaths_1 = logoPaths; _i < logoPaths_1.length; _i++) {
        var logoPath = logoPaths_1[_i];
        try {
            if (node_fs_1.default.existsSync(logoPath)) {
                // Lê o arquivo e converte para base64
                var fileBuffer = node_fs_1.default.readFileSync(logoPath);
                // Retorna apenas a string Base64 (sem o prefixo data:image/png;base64, pois os templates já adicionam ou não conforme necessidade)
                // Nos templates atuais: <img src="data:image/png;base64,{{logo_base64}}" />
                // Portanto, retornamos apenas o payload.
                return fileBuffer.toString('base64');
            }
        }
        catch (error) {
            console.warn("Erro ao tentar ler logo em ".concat(logoPath, ":"), error);
        }
    }
    console.error('CRÍTICO: Logo "logo_pequizeiro.png" não encontrada em nenhum dos caminhos verificados.');
    return undefined;
}
/**
 * Carrega a logo de um usuário a partir de uma URL relativa armazenada em user.metadata.logoUrl.
 * Ex: "/uploads/logos/abc123.png" -> Base64 string
 * @param logoUrl URL relativa armazenada no banco (ex: "/uploads/logos/abc.png")
 * @returns String Base64 da imagem ou undefined se não encontrar.
 */
function loadLogoFromPath(logoUrl) {
    if (!logoUrl)
        return undefined;
    // Remove a barra inicial para construir o caminho absoluto a partir do CWD
    var relativePath = logoUrl.startsWith('/') ? logoUrl.slice(1) : logoUrl;
    var absolutePath = node_path_1.default.resolve(process.cwd(), relativePath);
    try {
        if (node_fs_1.default.existsSync(absolutePath)) {
            return node_fs_1.default.readFileSync(absolutePath).toString('base64');
        }
    }
    catch (error) {
        console.warn("Erro ao tentar carregar logo do usu\u00E1rio em ".concat(absolutePath, ":"), error);
    }
    return undefined;
}
