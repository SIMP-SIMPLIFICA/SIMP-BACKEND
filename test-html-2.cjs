const fs = require('fs');
const Handlebars = require('handlebars');

const htmlContent = fs.readFileSync('./src/services/pdf.service.ts', 'utf8');

// Extrai o conteúdo entre as crazes na string template
const regex = /return \`([\s\S]*?)\`/m;
const match = regex.exec(htmlContent);
if (!match) {
    console.error("Template não encontrado");
    process.exit(1);
}
const templateHtml = match[1];

const template = Handlebars.compile(templateHtml);

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
    authorHasDigitalSignature: true,
    remetente_assinou: true,
    mostrar_historico: true
};

const finalHtml = template(pdfData);

fs.writeFileSync('test-output.html', finalHtml);
console.log('HTML generated to test-output.html');
