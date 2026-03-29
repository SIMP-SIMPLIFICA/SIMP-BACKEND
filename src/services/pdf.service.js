"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfService = exports.PdfService = void 0;
var puppeteer_1 = __importDefault(require("puppeteer"));
var handlebars_1 = __importDefault(require("handlebars"));
var node_path_1 = __importDefault(require("node:path"));
var node_url_1 = require("node:url");
var pdf_utils_1 = require("../utils/pdf.utils");
var __filename = (0, node_url_1.fileURLToPath)(import.meta.url);
var __dirname = node_path_1.default.dirname(__filename);
var PdfService = /** @class */ (function () {
    function PdfService() {
    }
    PdfService.prototype.getTemplateHtml = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, "\n        <!DOCTYPE html>\n        <html>\n        <head>\n            <style>\n                /** \n                 * Define as margens da p\u00E1gina. \n                 */\n                @page { \n                    margin-top: 2cm;\n                    margin-bottom: 2cm;\n                    margin-left: 2cm;\n                    margin-right: 2cm;\n                }\n\n                body { \n                    font-family: 'Times New Roman', serif; \n                    font-size: 12pt; \n                    color: #333;\n                }\n\n                /* HEADER */\n                .header-logo { \n                    text-align: center; \n                    margin-bottom: 20px; \n                }\n                .header-logo img { \n                    height: 80px; \n                }\n                \n                /* CONTROLE DE PAGINA\u00C7\u00C3O */\n                .content-page { \n                    page-break-after: always; \n                }\n                .history-page { \n                    page-break-before: always; \n                }\n\n                /* CORPO DO OF\u00CDCIO */\n                .info-block { \n                    margin-bottom: 30px; \n                }\n                .numero-oficio { \n                    font-weight: bold; \n                    font-size: 14pt; \n                    margin-bottom: 10px; \n                }\n                .data-local { \n                    text-align: right; \n                    margin-bottom: 40px; \n                }\n                \n                .destinatario { \n                    margin-bottom: 30px; \n                    font-weight: bold; \n                    text-transform: uppercase; \n                }\n                .assunto { \n                    font-weight: bold; \n                    margin-bottom: 25px; \n                    text-transform: uppercase; \n                }\n                \n                .texto p { \n                    text-align: justify; \n                    text-indent: 2.5cm; \n                    margin-bottom: 15px; \n                    line-height: 1.5;\n                }\n                \n                /* ASSINATURAS */\n                .assinatura-wrapper {\n                    margin-top: 50px;\n                }\n\n                .assinatura-visual { \n                    text-align: center; \n                    margin-bottom: 40px;\n                }\n                .linha { \n                    border-top: 1px solid #000; \n                    width: 60%; \n                    margin: 0 auto 5px auto; \n                }\n\n                /* --- NOVO SELO DE ASSINATURA SOFISTICADO --- */\n                .seal-container {\n                    border: 1px solid #004a8f;\n                    border-radius: 4px;\n                    padding: 0;\n                    margin: 20px auto;\n                    width: 90%;\n                    max-width: 260px;\n                    background-color: #fff;\n                    font-family: 'Arial', sans-serif;\n                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);\n                    position: relative;\n                    overflow: hidden;\n                }\n\n                .seal-header {\n                    background-color: #004a8f;\n                    color: white;\n                    padding: 3px 6px;\n                    font-size: 7pt;\n                    font-weight: bold;\n                    display: flex;\n                    align-items: center;\n                    justify-content: space-between;\n                }\n\n                .seal-body {\n                    padding: 4px;\n                    font-size: 7pt;\n                    color: #333;\n                    display: flex;\n                    align-items: center;\n                }\n\n\n                .seal-logo {\n                    width: 30px;\n                    height: 30px;\n                    margin-right: 10px;\n                    opacity: 0.8;\n                }\n                \n                .seal-info {\n                    flex: 1;\n                }\n\n                .seal-row {\n                    margin-bottom: 2px;\n                    display: flex;\n                }\n                .seal-label {\n                    font-weight: bold;\n                    width: 50px;\n                    color: #555;\n                }\n                .seal-value {\n                    flex: 1;\n                    font-weight: 500;\n                }\n                .seal-hash {\n                    font-family: 'Courier New', monospace;\n                    font-size: 6pt;\n                    color: #666;\n                    margin-top: 3px;\n                    word-break: break-all;\n                }\n\n                /* --- P\u00C1GINA DE MANIFESTO --- */\n                .manifest-header {\n                    text-align: center;\n                    border-bottom: 2px solid #004a8f;\n                    padding-bottom: 10px;\n                    margin-bottom: 30px;\n                }\n                .manifest-title {\n                    font-size: 18pt;\n                    font-weight: bold;\n                    color: #004a8f;\n                    text-transform: uppercase;\n                }\n                .manifest-subtitle {\n                    font-size: 10pt;\n                    color: #666;\n                }\n\n                .section-title {\n                    font-size: 12pt;\n                    font-weight: bold;\n                    color: #333;\n                    margin-bottom: 15px;\n                    border-left: 4px solid #004a8f;\n                    padding-left: 10px;\n                    background: #f9f9f9;\n                    padding-top: 5px;\n                    padding-bottom: 5px;\n                }\n\n                .manifest-signatures {\n                    margin-bottom: 40px;\n                }\n\n                .signature-item {\n                    border: 1px solid #eee;\n                    border-radius: 4px;\n                    padding: 10px;\n                    margin-bottom: 10px;\n                    background: #fafafa;\n                }\n                .signature-item.valid {\n                    border-left: 4px solid #28a745;\n                }\n                .valid-badge {\n                    color: #28a745;\n                    font-weight: bold;\n                    font-size: 9pt;\n                    float: right;\n                }\n\n                /* VISUAL TIMELINE */\n                .timeline {\n                    position: relative;\n                    margin: 20px 0 20px 20px;\n                    border-left: 2px solid #ddd;\n                }\n                .timeline-item {\n                    position: relative;\n                    margin-bottom: 20px;\n                    padding-left: 20px;\n                }\n                .timeline-dot {\n                    position: absolute;\n                    left: -6px;\n                    top: 5px;\n                    width: 10px;\n                    height: 10px;\n                    border-radius: 50%;\n                    background: #004a8f;\n                    border: 2px solid #fff;\n                    box-shadow: 0 0 0 1px #004a8f;\n                }\n                .timeline-date {\n                    font-size: 9pt;\n                    color: #666;\n                }\n                .timeline-content {\n                    font-weight: bold;\n                    font-size: 10pt;\n                }\n                .timeline-details {\n                    font-size: 9pt;\n                    color: #555;\n                    margin-top: 2px;\n                }\n\n                .verification-info {\n                    text-align: center;\n                    margin-top: 50px;\n                    padding: 20px;\n                    background: #f0f7ff;\n                    border-radius: 8px;\n                    border: 1px dashed #004a8f;\n                }\n                .qr-code img {\n                    width: 100px;\n                    height: 100px;\n                }\n                .verification-text {\n                    margin-top: 10px;\n                    font-size: 10pt;\n                }\n                .verification-url {\n                    font-weight: bold;\n                    color: #004a8f;\n                    text-decoration: none;\n                }\n            </style>\n        </head>\n        <body>\n\n            <!-- 1. P\u00C1GINA DE CONTE\u00DADO -->\n            <div class=\"content-page\">\n                <div class=\"header-logo\">\n                    {{#if logo_base64}}\n                        <img src=\"data:image/png;base64,{{logo_base64}}\" />\n                    {{/if}}\n                </div>\n\n                <div class=\"info-block\">\n                    {{#if numero_oficio}}\n                        <div class=\"numero-oficio\">{{numero_oficio}}</div>\n                    {{/if}}\n                    <div class=\"data-local\">Pequizeiro - TO, {{data_extenso}}.</div>\n                </div>\n\n                <div class=\"destinatario\">\n                    {{#if cabecalho_livre}}\n                        <pre style=\"font-family: inherit; white-space: pre-wrap;\">{{cabecalho_livre}}</pre>\n                    {{else}}\n                        \u00C0 SUA SENHORIA O(A) SENHOR(A)<br>\n                        {{nome_destinatario}}<br>\n                        {{cargo_destinatario}}\n                    {{/if}}\n                </div>\n\n                <div class=\"assunto\">ASSUNTO: {{assunto}}</div>\n\n                <div class=\"texto\">\n                    {{#each lista_paragrafos}}\n                        <p>{{{this.texto}}}</p>\n                    {{/each}}\n                </div>\n\n                <!-- ASSINATURA DO REMETENTE (Obrigat\u00F3ria visualmente) -->\n                <div class=\"assinatura-wrapper\">\n                   {{#if remetente_assinou}}\n                        <!-- Novo Selo Sofisticado -->\n                        <div class=\"seal-container\">\n                            <div class=\"seal-header\">\n                                <span>ASSINATURA ELETR\u00D4NICA QUALIFICADA</span>\n                                <span>ICP-Brasil (Simulado)</span>\n                            </div>\n                            <div class=\"seal-body\">\n                                {{#if logo_base64}}\n                                    <img src=\"data:image/png;base64,{{logo_base64}}\" class=\"seal-logo\" />\n                                {{else}}\n                                    <div class=\"seal-logo\" style=\"background: #eee; border-radius: 50%;\"></div>\n                                {{/if}}\n                                <div class=\"seal-info\">\n                                    <div class=\"seal-row\"><span class=\"seal-label\">Por:</span> <span class=\"seal-value\">{{nome_remetente}}</span></div>\n                                    <div class=\"seal-row\"><span class=\"seal-label\">Cargo:</span> <span class=\"seal-value\">{{cargo_remetente}}</span></div>\n                                    <div class=\"seal-row\"><span class=\"seal-label\">Data:</span> <span class=\"seal-value\">{{data_extenso}}</span></div>\n                                    <div class=\"seal-hash\">Hash: {{rodape_hash}}</div>\n                                </div>\n                            </div>\n                        </div>\n                   {{else}}\n                       <div class=\"assinatura-visual\">\n                            <div class=\"linha\"></div>\n                            <div>{{nome_remetente}}</div>\n                            <div>{{cargo_remetente}}</div>\n                       </div>\n                   {{/if}}\n                </div>\n            </div>\n\n            <!-- 2. P\u00C1GINA DE MANIFESTO (Sempre presente se houver assinaturas ou hist\u00F3rico) -->\n            {{#if mostrar_historico}}\n            <div class=\"history-page\">\n                <div class=\"manifest-header\">\n                    <div class=\"manifest-title\">Manifesto de Assinaturas</div>\n                    <div class=\"manifest-subtitle\">Registro Oficial de Rastreabilidade e Auditoria do Documento</div>\n                </div>\n\n                <!-- Lista de Assinantes V\u00E1lidos -->\n                <div class=\"section-title\">ASSINATURAS RECONHECIDAS</div>\n                <div class=\"manifest-signatures\">\n                    {{#each assinaturas}}\n                        {{#if this.is_digital}}\n                        <div class=\"signature-item valid\">\n                            <span class=\"valid-badge\">\u2713 V\u00C1LIDO{{#if this.isAuthor}} (AUTOR){{/if}}</span>\n                            <div style=\"font-weight: bold; font-size: 11pt;\">{{this.nome}}</div>\n                            <div style=\"font-size: 9pt; color: #555;\">{{this.cargo}}</div>\n                            <div style=\"margin-top: 5px; font-size: 9pt;\">\n                                <strong>Data:</strong> {{this.data}}<br/>\n                                <strong>M\u00E9todo:</strong> Autentica\u00E7\u00E3o via Token/Login Seguro<br/>\n                                <strong>CPF/ID:</strong> {{this.cpf_mascarado}}<br/>\n                                <strong>IP/Local:</strong> {{this.ip}}\n                            </div>\n                            <div style=\"margin-top: 5px; font-family: monospace; font-size: 8pt; color: #888;\">\n                                Hash: {{this.hash}}\n                            </div>\n                        </div>\n                        {{/if}}\n                    {{/each}}\n                    <!-- Se remetente tamb\u00E9m assinou e n\u00E3o est\u00E1 na lista 'assinaturas', adicionar visualmente -->\n                     {{#if remetente_assinou}}\n                      {{#unless authorHasDigitalSignature}}\n                        <div class=\"signature-item valid\">\n                            <span class=\"valid-badge\">\u2713 V\u00C1LIDO (AUTOR)</span>\n                            <div style=\"font-weight: bold; font-size: 11pt;\">{{nome_remetente}}</div>\n                            <div style=\"font-size: 9pt; color: #555;\">{{cargo_remetente}}</div>\n                            <div style=\"margin-top: 5px; font-size: 9pt;\">\n                                <strong>Data:</strong> {{data_extenso}}<br/>\n                                <strong>M\u00E9todo:</strong> Cria\u00E7\u00E3o e Assinatura na Origem\n                            </div>\n                        </div>\n                      {{/unless}}\n                     {{/if}}\n                </div>\n\n                <!-- Timeline de Eventos -->\n                <div class=\"section-title\">LINHA DO TEMPO DE AUDITORIA</div>\n                <div class=\"timeline\">\n                    {{#each historico}}\n                    <div class=\"timeline-item\">\n                        <div class=\"timeline-dot\"></div>\n                        <div class=\"timeline-date\">{{this.date}}</div>\n                        <div class=\"timeline-content\">{{this.action_label}}</div>\n                        <div class=\"timeline-details\">\n                            Por: {{this.user}} ({{this.role}})<br/>\n                            {{this.details}}\n                        </div>\n                    </div>\n                    {{/each}}\n                </div>\n\n                <!-- \u00C1rea de Valida\u00E7\u00E3o -->\n                <div class=\"verification-info\">\n                    <div class=\"qr-code\">\n                        <!-- Placeholder para QR, idealmente gerado via imagem base64 tamb\u00E9m -->\n                        <img src=\"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={{qr_code_url}}\" alt=\"QR Code\" />\n                    </div>\n                    <div class=\"verification-text\">\n                        Para verificar a validade deste documento, aponte a c\u00E2mera para o QR Code ou acesse:<br/>\n                        <a href=\"{{qr_code_url}}\" class=\"verification-url\">{{qr_code_url}}</a>\n                    </div>\n                    <div style=\"margin-top: 10px; font-size: 8pt; color: #777;\">\n                        C\u00F3digo Hash Original: {{rodape_hash}}\n                    </div>\n                </div>\n\n            </div>\n            {{/if}}\n        </body>\n        </html>\n        "];
            });
        });
    };
    PdfService.prototype.generate = function (data) {
        return __awaiter(this, void 0, void 0, function () {
            var browser, page, safeLogo, loadedLogo, templateHtml, template, baseUrl, dataHoraRodape, finalHtml, pdfBuffer;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, puppeteer_1.default.launch({
                            headless: true,
                            args: ['--no-sandbox', '--disable-setuid-sandbox']
                        })];
                    case 1:
                        browser = _a.sent();
                        return [4 /*yield*/, browser.newPage()];
                    case 2:
                        page = _a.sent();
                        safeLogo = data.logo_base64;
                        if (safeLogo && safeLogo.includes('base64,')) {
                            safeLogo = safeLogo.split('base64,')[1];
                        }
                        if (!safeLogo) {
                            loadedLogo = (0, pdf_utils_1.loadLogoBase64)();
                            if (loadedLogo) {
                                safeLogo = loadedLogo;
                            }
                        }
                        return [4 /*yield*/, this.getTemplateHtml()];
                    case 3:
                        templateHtml = _a.sent();
                        template = handlebars_1.default.compile(templateHtml);
                        handlebars_1.default.registerHelper('formatDate', function (date) {
                            return new Date(date).toLocaleString('pt-BR');
                        });
                        baseUrl = process.env.APP_URL || 'http://localhost:3000';
                        dataHoraRodape = data.data_hora_criacao || new Date().toLocaleString('pt-BR');
                        finalHtml = template(__assign(__assign({}, data), { base_url: baseUrl, logo_base64: safeLogo, data_hora_criacao: dataHoraRodape, rodape_hash_curto: data.rodape_hash.substring(0, 8), remetente_assinou: true, mostrar_historico: (data.historico && data.historico.length > 0) || (data.assinaturas && data.assinaturas.length > 0) }));
                        return [4 /*yield*/, page.setContent(finalHtml, { waitUntil: 'load' })];
                    case 4:
                        _a.sent();
                        return [4 /*yield*/, page.pdf({
                                format: 'A4',
                                printBackground: true,
                                // Header e Footer já estão no HTML via CSS fixed
                                displayHeaderFooter: false,
                                // Margens já definidas no @page do CSS, mas definimos '0' aqui para delegar ao CSS
                                // ou definimos margens mínimas se o CSS não pegar bem em headless
                                margin: {
                                    top: '0cm',
                                    bottom: '0cm',
                                    left: '0cm',
                                    right: '0cm'
                                }
                            })];
                    case 5:
                        pdfBuffer = _a.sent();
                        return [4 /*yield*/, browser.close()];
                    case 6:
                        _a.sent();
                        return [2 /*return*/, Buffer.from(pdfBuffer)];
                }
            });
        });
    };
    return PdfService;
}());
exports.PdfService = PdfService;
exports.pdfService = new PdfService();
