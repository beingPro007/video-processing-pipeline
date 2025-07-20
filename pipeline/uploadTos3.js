import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";

/**
 * Uploads a local video file to S3 under the processed/{videoId}/{resolution}/{filename} path.
 * 
 * @param {Object} params
 * @param {string} params.bucket - S3 bucket name
 * @param {string} params.key - Original key (e.g., "videos/video.mp4")
 * @param {string} params.videoId - Unique video ID
 * @param {string} params.outputPath - Local path to processed file
 * @param {object} params.s3 - AWS S3 client instance
 */
export async function uploadProcessedFile({ bucket, key, videoId, outputPath, s3 }) {
    const fileName = path.basename(key); // e.g. "video.mp4"
    const resolution = path.basename(outputPath).split('_')[1].replace('.mp4', '');
    const outputKey = `processed/${videoId}/${resolution}/${fileName}`;

    try {
        const processedFile = await fs.readFile(outputPath);

        console.log(`📤 Uploading ${resolution} of file ${fileName} to S3...`);
        await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: outputKey,
            Body: processedFile,
            ContentType: "video/mp4"
        }));

        console.log(`✅ Uploaded ${resolution} of file ${fileName}:`, outputKey);
    } catch (error) {
        throw new Error(`❌ Failed to upload ${resolution}: ${error.message}`);
    } finally {
        fs.unlink(outputPath).catch(err => {
            console.warn(`⚠️ Could not delete temp file ${outputPath}:`, err.message);
        });
    }
}
