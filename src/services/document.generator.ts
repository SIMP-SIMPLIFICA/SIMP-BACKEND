import puppeteer from 'puppeteer';
import handlebars from 'handlebars';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLogoBase64 } from '../utils/pdf.utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DocumentData {
    numero_oficio: string;
    data_extenso: string;
    nome_destinatario: string;
    cargo_destinatario: string;
    assunto: string;
    lista_paragrafos: { texto: string }[];
    nome_remetente: string;
    cargo_remetente: string;
    rodape_hash: string;
    qr_code_url: string;
    logo_base64?: string;
    cabecalho_livre?: string; // NOVO: Para receber o texto editado
}

export class DocumentGeneratorService {

    private async getTemplateHtml(): Promise<string> {
        // Template HTML Ajustado
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @page {
                    size: A4;
                    margin: 2cm 2cm 2cm 2cm; /* Margens ajustadas */
                }
                body {
                    font-family: 'Times New Roman', serif;
                    font-size: 12pt;
                    line-height: 1.5;
                    color: #000;
                    margin: 0;
                    padding: 0;
                }
                .header {
                    text-align: center;
                    margin-bottom: 20px;
                }
                .header img {
                    height: 90px;
                    object-fit: contain;
                    margin-bottom: 10px;
                }
                /* REMOVIDO: Estilos de texto fixo do cabeçalho */
                
                .info-block {
                    margin-bottom: 30px;
                }
                .numero-oficio {
                    font-weight: bold;
                    font-size: 14pt;
                    margin-bottom: 10px;
                    text-transform: uppercase;
                }
                .data-local {
                    text-align: right;
                    margin-bottom: 40px;
                }
                
                /* Estilo para o cabeçalho livre (editado) */
                .destinatario-livre {
                    margin-bottom: 30px;
                    font-weight: bold;
                    text-transform: uppercase;
                    white-space: pre-wrap; /* Respeita as quebras de linha */
                }

                .assunto {
                    font-weight: bold;
                    margin-bottom: 25px;
                    text-transform: uppercase;
                }
                .conteudo {
                    text-align: justify;
                    min-height: 200px;
                }
                .conteudo p {
                    text-indent: 2.5cm; /* Recuo ABNT */
                    margin-bottom: 15px;
                }
                .assinatura {
                    margin-top: 60px;
                    text-align: center;
                    page-break-inside: avoid;
                }
                .assinatura-linha {
                    margin-bottom: 5px;
                    font-weight: bold;
                    text-transform: uppercase;
                    border-top: 1px solid #000;
                    display: inline-block;
                    padding-top: 5px;
                    min-width: 50%;
                }
                .footer {
                    margin-top: 50px;
                    font-size: 9pt;
                    text-align: center;
                    border-top: 1px solid #ccc;
                    padding-top: 10px;
                    color: #555;
                }
                .hash-code {
                    font-size: 8pt;
                    color: #999;
                    margin-top: 5px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                {{#if logo_base64}}
                    <img src="data:image/png;base64,{{logo_base64}}" />
                {{/if}}
            </div>

            <div class="info-block">
                <div class="numero-oficio">
                    {{numero_oficio}}
                </div>
                <div class="data-local">
                    Pequizeiro - TO, {{data_extenso}}.
                </div>
            </div>

            {{#if cabecalho_livre}}
                <div class="destinatario-livre">{{cabecalho_livre}}</div>
            {{else}}
                <div class="destinatario-livre">
                    À SUA SENHORIA O(A) SENHOR(A)<br>
                    {{nome_destinatario}}<br>
                    {{cargo_destinatario}}
                </div>
            {{/if}}

            <div class="assunto">
                ASSUNTO: {{assunto}}
            </div>

            <div class="conteudo">
                <p>Senhor(a),</p>
                
                {{#each lista_paragrafos}}
                    <p>{{this.texto}}</p>
                {{/each}}
                
                <p style="margin-top: 30px;">Atenciosamente,</p>
            </div>

            <div class="assinatura">
                <div class="assinatura-linha">{{nome_remetente}}</div>
                <div>{{cargo_remetente}}</div>
                <div style="font-size: 10px; margin-top: 5px;">Assinado Digitalmente via SIMP</div>
            </div>

            <div class="footer">
                PREFEITURA MUNICIPAL DE PEQUIZEIRO
                <div class="hash-code">Autenticação: {{rodape_hash}}</div>
            </div>
        </body>
        </html>
        `;
    }

    async generatePDF(data: DocumentData): Promise<Buffer> {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // LÓGICA DE LOGO: Se não veio no data, tenta carregar local (via utility)
        if (!data.logo_base64) {
            const loadedLogo = loadLogoBase64();
            if (loadedLogo) {
                data.logo_base64 = loadedLogo;
            }
        }

        const templateHtml = await this.getTemplateHtml();
        const template = handlebars.compile(templateHtml);
        const finalHtml = template(data);

        await page.setContent(finalHtml, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: false,
            margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' }
        });

        await browser.close();
        return Buffer.from(pdfBuffer);
    }
}

export const documentGenerator = new DocumentGeneratorService();