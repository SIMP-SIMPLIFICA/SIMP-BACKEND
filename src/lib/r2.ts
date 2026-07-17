import { S3Client } from '@aws-sdk/client-s3';
import { config } from '@/config/config.js'

const accessKeyId     = config.r2.accessKeyId     ?? ''
const secretAccessKey = config.r2.secretAccessKey ?? ''

if (!accessKeyId || !secretAccessKey) {
  console.warn(
    '[R2] R2_ACCESS_KEY_ID ou R2_SECRET_ACCESS_KEY não configurados — uploads/downloads de arquivos vão falhar.' +
    ' Configure as variáveis no .env.'
  )
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

export default r2;
