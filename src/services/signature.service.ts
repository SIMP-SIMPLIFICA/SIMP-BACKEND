import forge from 'node-forge';
import { plainAddPlaceholder } from 'node-signpdf/dist/helpers'; // Ajuste o import conforme versão
import signer from 'node-signpdf';

export class SignatureService {

    /**
     * Assina um Buffer PDF usando um certificado PFX (PKCS#12)
     */
    async signPdf(pdfBuffer: Buffer, pfxBuffer: Buffer, password: string): Promise<Buffer> {
        // 1. Adiciona Placeholder (Espaço vazio no PDF para a assinatura byte-range)
        const pdfWithPlaceholder = plainAddPlaceholder({
            pdfBuffer,
            reason: 'Assinado Digitalmente via SIMP',
            contactInfo: 'ti@pequizeiro.to.gov.br',
            name: 'Prefeitura Municipal de Pequizeiro',
            location: 'Pequizeiro - TO',
        });

        // 2. Extrai e Prepara o Certificado com Node-Forge
        // Nota: O node-signpdf espera buffers "limpos"
        const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

        // O node-signpdf cuida da extração interna na versão mais recente, 
        // ou passamos os buffers diretos. Vamos usar a abordagem direta do signer:
        
        const signedPdf = signer.sign(pdfWithPlaceholder, pfxBuffer, { passphrase: password });

        return signedPdf;
    }
}

export const signatureService = new SignatureService();