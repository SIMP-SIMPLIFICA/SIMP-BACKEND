import { pdfService } from './src/services/pdf.service';
import fs from 'fs';

async function run() {
    const pdfData = {
        numero_oficio: "TESTE Nº 123",
        data_extenso: "10 de Março de 2026",
        nome_destinatario: "TESTE DESTINATARIO",
        cargo_destinatario: "Gerente",
        assunto: "TESTE",
        lista_paragrafos: [{ texto: "Este é um paragrafo de teste." }],
        nome_remetente: "Carlos Magno",
        cargo_remetente: "Diretor",
        rodape_hash: "1234567890ABCDEF",
        qr_code_url: "http://localhost/verify/123",
        logo_base64: undefined,
        cabecalho_livre: undefined,
        data_hora_criacao: "10/03/2026 10:00",
        historico: [{
            date: "10/03/2026",
            action: "CREATED",
            action_label: "Criado",
            user: "Carlos Magno",
            role: "Diretor",
            details: ""
        }],
        assinaturas: [{
            nome: "Carlos Magno",
            cargo: "Diretor",
            data: "10/03/2026",
            hash: "ABCDEF123",
            is_digital: true,
            isAuthor: true,
            cpf_mascarado: "***.***.***-**",
            ip: "127.0.0.1"
        }],
        authorHasDigitalSignature: true
    };

    // Test getTemplateHtml which is private, so we cast it
    const html = await (pdfService as any).getTemplateHtml();
    const Handlebars = require('handlebars');
    const template = Handlebars.compile(html);
    const finalHtml = template({
        ...pdfData,
        remetente_assinou: true,
        mostrar_historico: true
    });

    fs.writeFileSync('test-output.html', finalHtml);
    console.log('HTML generated to test-output.html');
}
run();
