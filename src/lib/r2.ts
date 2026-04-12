import { S3Client } from '@aws-sdk/client-s3';

const accessKeyId     = process.env.R2_ACCESS_KEY_ID     ?? ''
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? ''

if (!accessKeyId || !secretAccessKey) {
  console.warn(
    '[R2] R2_ACCESS_KEY_ID ou R2_SECRET_ACCESS_KEY não configurados — uploads/downloads de arquivos vão falhar.' +
    ' Configure as variáveis no .env.'
  )
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId, secretAccessKey },
});

export default r2;
