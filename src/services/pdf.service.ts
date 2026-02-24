import puppeteer from 'puppeteer';
import handlebars from 'handlebars';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLogoBase64 } from '../utils/pdf.utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PdfData {
    numero_oficio: string;
    data_extenso: string;
    // Data e Hora para o rodapé de autenticação
    data_hora_criacao?: string;
    nome_destinatario: string;
    cargo_destinatario: string;
    assunto: string;
    lista_paragrafos: { texto: string }[];
    nome_remetente: string;
    cargo_remetente: string;
    rodape_hash: string;
    qr_code_url: string;
    logo_base64?: string;
    cabecalho_livre?: string;

    // Dados para a página de histórico/assinaturas
    historico?: {
        date: string; // Já formatado
        action: string;
        action_label?: string; // NOVO: Label amigável (e.g. "Visualizado")
        user: string;
        role: string;
        details: any;
    }[];
    assinaturas?: {
        nome: string;
        cargo: string;
        data: string; // Já formatado
        hash: string;
        is_digital: boolean;
        cpf_mascarado?: string; // NOVO
        ip?: string; // NOVO
    }[];
}

export class PdfService {


    private async getTemplateHtml(): Promise<string> {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                /** 
                 * Define as margens da página. 
                 */
                @page { 
                    margin-top: 2cm;
                    margin-bottom: 2cm;
                    margin-left: 2cm;
                    margin-right: 2cm;
                }

                body { 
                    font-family: 'Times New Roman', serif; 
                    font-size: 12pt; 
                    color: #333;
                }

                /* HEADER */
                .header-logo { 
                    text-align: center; 
                    margin-bottom: 20px; 
                }
                .header-logo img { 
                    height: 80px; 
                }
                
                /* CONTROLE DE PAGINAÇÃO */
                .content-page { 
                    page-break-after: always; 
                }
                .history-page { 
                    page-break-before: always; 
                }

                /* CORPO DO OFÍCIO */
                .info-block { 
                    margin-bottom: 30px; 
                }
                .numero-oficio { 
                    font-weight: bold; 
                    font-size: 14pt; 
                    margin-bottom: 10px; 
                }
                .data-local { 
                    text-align: right; 
                    margin-bottom: 40px; 
                }
                
                .destinatario { 
                    margin-bottom: 30px; 
                    font-weight: bold; 
                    text-transform: uppercase; 
                }
                .assunto { 
                    font-weight: bold; 
                    margin-bottom: 25px; 
                    text-transform: uppercase; 
                }
                
                .texto p { 
                    text-align: justify; 
                    text-indent: 2.5cm; 
                    margin-bottom: 15px; 
                    line-height: 1.5;
                }
                
                /* ASSINATURAS */
                .assinatura-wrapper {
                    margin-top: 50px;
                    page-break-inside: avoid; 
                }

                .assinatura-visual { 
                    text-align: center; 
                    margin-bottom: 40px;
                }
                .linha { 
                    border-top: 1px solid #000; 
                    width: 60%; 
                    margin: 0 auto 5px auto; 
                }

                /* --- NOVO SELO DE ASSINATURA SOFISTICADO --- */
                .seal-container {
                    border: 1px solid #004a8f;
                    border-radius: 4px;
                    padding: 0;
                    margin: 20px auto;
                    width: 90%;
                    max-width: 260px;
                    background-color: #fff;
                    font-family: 'Arial', sans-serif;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    position: relative;
                    overflow: hidden;
                }

                .seal-header {
                    background-color: #004a8f;
                    color: white;
                    padding: 3px 6px;
                    font-size: 7pt;
                    font-weight: bold;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .seal-body {
                    padding: 4px;
                    font-size: 7pt;
                    color: #333;
                    display: flex;
                    align-items: center;
                }


                .seal-logo {
                    width: 30px;
                    height: 30px;
                    margin-right: 10px;
                    opacity: 0.8;
                }
                
                .seal-info {
                    flex: 1;
                }

                .seal-row {
                    margin-bottom: 2px;
                    display: flex;
                }
                .seal-label {
                    font-weight: bold;
                    width: 50px;
                    color: #555;
                }
                .seal-value {
                    flex: 1;
                    font-weight: 500;
                }
                .seal-hash {
                    font-family: 'Courier New', monospace;
                    font-size: 6pt;
                    color: #666;
                    margin-top: 3px;
                    word-break: break-all;
                }

                /* --- PÁGINA DE MANIFESTO --- */
                .manifest-header {
                    text-align: center;
                    border-bottom: 2px solid #004a8f;
                    padding-bottom: 10px;
                    margin-bottom: 30px;
                }
                .manifest-title {
                    font-size: 18pt;
                    font-weight: bold;
                    color: #004a8f;
                    text-transform: uppercase;
                }
                .manifest-subtitle {
                    font-size: 10pt;
                    color: #666;
                }

                .section-title {
                    font-size: 12pt;
                    font-weight: bold;
                    color: #333;
                    margin-bottom: 15px;
                    border-left: 4px solid #004a8f;
                    padding-left: 10px;
                    background: #f9f9f9;
                    padding-top: 5px;
                    padding-bottom: 5px;
                }

                .manifest-signatures {
                    margin-bottom: 40px;
                }

                .signature-item {
                    border: 1px solid #eee;
                    border-radius: 4px;
                    padding: 10px;
                    margin-bottom: 10px;
                    background: #fafafa;
                }
                .signature-item.valid {
                    border-left: 4px solid #28a745;
                }
                .valid-badge {
                    color: #28a745;
                    font-weight: bold;
                    font-size: 9pt;
                    float: right;
                }

                /* VISUAL TIMELINE */
                .timeline {
                    position: relative;
                    margin: 20px 0 20px 20px;
                    border-left: 2px solid #ddd;
                }
                .timeline-item {
                    position: relative;
                    margin-bottom: 20px;
                    padding-left: 20px;
                }
                .timeline-dot {
                    position: absolute;
                    left: -6px;
                    top: 5px;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: #004a8f;
                    border: 2px solid #fff;
                    box-shadow: 0 0 0 1px #004a8f;
                }
                .timeline-date {
                    font-size: 9pt;
                    color: #666;
                }
                .timeline-content {
                    font-weight: bold;
                    font-size: 10pt;
                }
                .timeline-details {
                    font-size: 9pt;
                    color: #555;
                    margin-top: 2px;
                }

                .verification-info {
                    text-align: center;
                    margin-top: 50px;
                    padding: 20px;
                    background: #f0f7ff;
                    border-radius: 8px;
                    border: 1px dashed #004a8f;
                }
                .qr-code img {
                    width: 100px;
                    height: 100px;
                }
                .verification-text {
                    margin-top: 10px;
                    font-size: 10pt;
                }
                .verification-url {
                    font-weight: bold;
                    color: #004a8f;
                    text-decoration: none;
                }
            </style>
        </head>
        <body>

            <!-- 1. PÁGINA DE CONTEÚDO -->
            <div class="content-page">
                <div class="header-logo">
                    {{#if logo_base64}}
                        <img src="data:image/png;base64,{{logo_base64}}" />
                    {{/if}}
                </div>

                <div class="info-block">
                    {{#if numero_oficio}}
                        <div class="numero-oficio">{{numero_oficio}}</div>
                    {{/if}}
                    <div class="data-local">Pequizeiro - TO, {{data_extenso}}.</div>
                </div>

                <div class="destinatario">
                    {{#if cabecalho_livre}}
                        <pre style="font-family: inherit; white-space: pre-wrap;">{{cabecalho_livre}}</pre>
                    {{else}}
                        À SUA SENHORIA O(A) SENHOR(A)<br>
                        {{nome_destinatario}}<br>
                        {{cargo_destinatario}}
                    {{/if}}
                </div>

                <div class="assunto">ASSUNTO: {{assunto}}</div>

                <div class="texto">
                    <p>Senhor(a),</p>
                    {{#each lista_paragrafos}}
                        <p>{{{this.texto}}}</p>
                    {{/each}}
                    <p style="margin-top: 30px;">Atenciosamente,</p>
                </div>

                <!-- ASSINATURA DO REMETENTE (Obrigatória visualmente) -->
                <div class="assinatura-wrapper">
                   {{#if remetente_assinou}}
                        <!-- Novo Selo Sofisticado -->
                        <div class="seal-container">
                            <div class="seal-header">
                                <span>ASSINATURA ELETRÔNICA QUALIFICADA</span>
                                <span>ICP-Brasil (Simulado)</span>
                            </div>
                            <div class="seal-body">
                                {{#if ../logo_base64}}
                                    <img src="data:image/png;base64,{{../logo_base64}}" class="seal-logo" />
                                {{else}}
                                    <div class="seal-logo" style="background: #eee; border-radius: 50%;"></div>
                                {{/if}}
                                <div class="seal-info">
                                    <div class="seal-row"><span class="seal-label">Por:</span> <span class="seal-value">{{nome_remetente}}</span></div>
                                    <div class="seal-row"><span class="seal-label">Cargo:</span> <span class="seal-value">{{cargo_remetente}}</span></div>
                                    <div class="seal-row"><span class="seal-label">Data:</span> <span class="seal-value">{{data_extenso}}</span></div>
                                    <div class="seal-hash">Hash: {{rodape_hash}}</div>
                                </div>
                            </div>
                        </div>
                   {{else}}
                       <div class="assinatura-visual">
                            <div class="linha"></div>
                            <div>{{nome_remetente}}</div>
                            <div>{{cargo_remetente}}</div>
                       </div>
                   {{/if}}
                </div>
            </div>

            <!-- 2. PÁGINA DE MANIFESTO (Sempre presente se houver assinaturas ou histórico) -->
            {{#if mostrar_historico}}
            <div class="history-page">
                <div class="manifest-header">
                    <div class="manifest-title">Manifesto de Assinaturas</div>
                    <div class="manifest-subtitle">Registro Oficial de Rastreabilidade e Auditoria do Documento</div>
                </div>

                <!-- Lista de Assinantes Válidos -->
                <div class="section-title">ASSINATURAS RECONHECIDAS</div>
                <div class="manifest-signatures">
                    {{#each assinaturas}}
                        {{#if this.is_digital}}
                        <div class="signature-item valid">
                            <span class="valid-badge">✓ VÁLIDO</span>
                            <div style="font-weight: bold; font-size: 11pt;">{{this.nome}}</div>
                            <div style="font-size: 9pt; color: #555;">{{this.cargo}}</div>
                            <div style="margin-top: 5px; font-size: 9pt;">
                                <strong>Data:</strong> {{this.data}}<br/>
                                <strong>Método:</strong> Autenticação via Token/Login Seguro<br/>
                                <strong>CPF/ID:</strong> {{this.cpf_mascarado}}<br/>
                                <strong>IP/Local:</strong> {{this.ip}}
                            </div>
                            <div style="margin-top: 5px; font-family: monospace; font-size: 8pt; color: #888;">
                                Hash: {{this.hash}}
                            </div>
                        </div>
                        {{/if}}
                    {{/each}}
                    <!-- Se remetente também assinou e não está na lista 'assinaturas', adicionar visualmente -->
                     {{#if remetente_assinou}}
                        <div class="signature-item valid">
                            <span class="valid-badge">✓ VÁLIDO (AUTOR)</span>
                            <div style="font-weight: bold; font-size: 11pt;">{{nome_remetente}}</div>
                            <div style="font-size: 9pt; color: #555;">{{cargo_remetente}}</div>
                            <div style="margin-top: 5px; font-size: 9pt;">
                                <strong>Data:</strong> {{data_extenso}}<br/>
                                <strong>Método:</strong> Criação e Assinatura na Origem
                            </div>
                        </div>
                     {{/if}}
                </div>

                <!-- Timeline de Eventos -->
                <div class="section-title">LINHA DO TEMPO DE AUDITORIA</div>
                <div class="timeline">
                    {{#each historico}}
                    <div class="timeline-item">
                        <div class="timeline-dot"></div>
                        <div class="timeline-date">{{this.date}}</div>
                        <div class="timeline-content">{{this.action_label}}</div>
                        <div class="timeline-details">
                            Por: {{this.user}} ({{this.role}})<br/>
                            {{this.details}}
                        </div>
                    </div>
                    {{/each}}
                </div>

                <!-- Área de Validação -->
                <div class="verification-info">
                    <div class="qr-code">
                        <!-- Placeholder para QR, idealmente gerado via imagem base64 também -->
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={{qr_code_url}}" alt="QR Code" />
                    </div>
                    <div class="verification-text">
                        Para verificar a validade deste documento, aponte a câmera para o QR Code ou acesse:<br/>
                        <a href="{{qr_code_url}}" class="verification-url">{{qr_code_url}}</a>
                    </div>
                    <div style="margin-top: 10px; font-size: 8pt; color: #777;">
                        Código Hash Original: {{rodape_hash}}
                    </div>
                </div>

            </div>
            {{/if}}
        </body>
        </html>
        `;
    }

    async generate(data: PdfData): Promise<Buffer> {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // 1. Carrega LOGO PEQUIZEIRO (via utility)
        let safeLogo = data.logo_base64;
        if (safeLogo && safeLogo.includes('base64,')) {
            safeLogo = safeLogo.split('base64,')[1];
        }

        if (!safeLogo) {
            const loadedLogo = loadLogoBase64();
            if (loadedLogo) {
                safeLogo = loadedLogo;
            }
        }

        const templateHtml = await this.getTemplateHtml();
        const template = handlebars.compile(templateHtml);

        handlebars.registerHelper('formatDate', (date) => {
            return new Date(date).toLocaleString('pt-BR');
        });

        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const dataHoraRodape = data.data_hora_criacao || new Date().toLocaleString('pt-BR');

        const finalHtml = template({
            ...data,
            base_url: baseUrl,
            logo_base64: safeLogo,
            data_hora_criacao: dataHoraRodape,
            rodape_hash_curto: data.rodape_hash.substring(0, 8),
            remetente_assinou: true, // Lógica pode vir de fora futuramente
            mostrar_historico: (data.historico && data.historico.length > 0) || (data.assinaturas && data.assinaturas.length > 0)
        });

        await page.setContent(finalHtml, { waitUntil: 'load' });

        const pdfBuffer = await page.pdf({
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
        });

        await browser.close();
        return Buffer.from(pdfBuffer);
    }
}

export const pdfService = new PdfService();
