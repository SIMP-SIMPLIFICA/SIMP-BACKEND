import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import * as path from 'path';

// Cloudflare R2 Credentials
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';

export const s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    forcePathStyle: true, // Cloudflare R2 MUST use path style (e.g endpoint/bucket vs bucket.endpoint)
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    }
});

/**
 * Faz upload de um buffer de arquivo para o Cloudflare R2.
 */
export async function uploadFileToR2(
    fileBuffer: Buffer,
    originalFilename: string,
    contentType: string,
    workspaceId: string
): Promise<{ key: string }> {
    const fileExtension = path.extname(originalFilename);
    // Cria um caminho único organizado por workspace e um uuid
    const key = `workspaces/${workspaceId}/finance/${randomUUID()}${fileExtension}`;

    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        // Opcional: ACL se o bucket fosse público, mas vamos usar Presigned URLs por segurança
    });

    await s3Client.send(command);
    return { key };
}

/**
 * Gera um link temporário (Presigned URL) para o Frontend ler o arquivo seguro por X minutos.
 */
export async function getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
    });

    // O link expirará em 1 hora por padrão (3600 segs)
    return await getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Remove um arquivo fisicamente do bucket do R2.
 */
export async function deleteFileFromR2(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
    });

    await s3Client.send(command);
}
