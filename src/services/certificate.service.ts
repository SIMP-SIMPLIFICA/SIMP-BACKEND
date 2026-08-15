import forge from 'node-forge';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class CertificateService {
    
    /**
     * Gera um certificado digital (PFX) auto-assinado para um usuário específico.
     * Retorna o Buffer do arquivo e a senha gerada para proteção.
     */
    async generateForUser(userData: { 
        username: string, 
        fullName: string, 
        email: string, 
        department: string 
    }) {
        // 1. Gera o par de chaves RSA (2048 bits)
        const keys = forge.pki.rsa.generateKeyPair(2048);

        // 2. Cria o Certificado X.509
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        
        // Define validade (Ex: 1 ano)
        cert.serialNumber = '01' + crypto.randomBytes(19).toString('hex'); // Agora vai funcionar!
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

        // 3. Define os Atributos (Quem é o dono?)
        const attrs = [
            { name: 'commonName', value: userData.fullName },
            { name: 'countryName', value: 'BR' },
            { shortName: 'ST', value: 'TO' },
            { name: 'localityName', value: 'Pequizeiro' },
            { name: 'organizationName', value: 'Prefeitura Municipal de Pequizeiro' },
            { shortName: 'OU', value: userData.department },
            { name: 'emailAddress', value: userData.email }
        ];

        cert.setSubject(attrs);
        cert.setIssuer(attrs); // Auto-assinado (Issuer = Subject)

        // 4. Assina o certificado com a própria chave privada
        cert.sign(keys.privateKey, forge.md.sha256.create());

        // 5. Empacota tudo num arquivo PFX (PKCS#12) protegido por senha
        // Em produção, a senha deve ser segura e única por usuário
        const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
            keys.privateKey, 
            [cert], 
            '1234' // Senha padrão para teste (ou use env var)
        );

        const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
        const pfxBuffer = Buffer.from(p12Der, 'binary');

        return pfxBuffer;
    }

    /**
     * Salva o certificado do usuário na pasta de certificados
     */
    async saveUserCertificate(userId: string, pfxBuffer: Buffer) {
        const certDir = path.resolve(__dirname, '../../certs/users');
        
        if (!fs.existsSync(certDir)) {
            fs.mkdirSync(certDir, { recursive: true });
        }

        const filePath = path.join(certDir, `${userId}.pfx`);
        fs.writeFileSync(filePath, pfxBuffer);
        
        return filePath;
    }
}

export const certificateService = new CertificateService();