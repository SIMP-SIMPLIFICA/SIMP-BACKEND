import { loadLogoBase64 } from '../src/utils/pdf.utils';
import fs from 'node:fs';
import path from 'node:path';

const resultFile = path.resolve(process.cwd(), 'verification_result.txt');

try {
    const logoBase64 = loadLogoBase64();
    if (logoBase64) {
        const isPng = logoBase64.startsWith('iVBORw0KGgo');
        const content = `SUCCESS\nLength: ${logoBase64.length}\nIsPNG: ${isPng}\nStart: ${logoBase64.substring(0, 20)}`;
        fs.writeFileSync(resultFile, content);
        console.log('Verification done. Result written to file.');
    } else {
        fs.writeFileSync(resultFile, 'FAILURE: Logo not found');
        console.error('Verification failed. Result written to file.');
        process.exit(1);
    }
} catch (error) {
    fs.writeFileSync(resultFile, `ERROR: ${error}`);
    console.error('Verification error. Result written to file.');
    process.exit(1);
}
