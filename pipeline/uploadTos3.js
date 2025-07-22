import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";

/**
 * Recursively uploads all files in localDir to S3.
 * 
 * @param {Object} params
 * @param {string} params.bucket - S3 bucket name
 * @param {string} params.localDir - Local folder path to upload
 * @param {string} params.s3Prefix - S3 key prefix
 * @param {object} params.s3 - AWS S3 client
 */
export async function uploadHLSDirectory({ bucket, localDir, s3Prefix, s3 }) {
    async function walkAndUpload(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(localDir, fullPath).replace(/\\/g, "/");
            const s3Key = `${s3Prefix}/${relativePath}`;

            if (entry.isDirectory()) {
                await walkAndUpload(fullPath);
            } else {
                const body = await fs.readFile(fullPath);
                const contentType = getContentType(entry.name);

                console.log(`📤 Uploading ${s3Key}...`);
                await s3.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: s3Key,
                    Body: body,
                    ContentType: contentType
                }));
            }
        }
    }

    await walkAndUpload(localDir);
    console.log(`✅ All files uploaded to s3://${bucket}/${s3Prefix}`);
}

/**
 * Returns appropriate content type for HLS files.
 */
function getContentType(fileName) {
    if (fileName.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
    if (fileName.endsWith(".ts")) return "video/mp2t";
    return "application/octet-stream";
}
