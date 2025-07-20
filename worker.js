import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { pipeline } from "stream/promises";
import dotenv from "dotenv";
import { ApiError } from "./utils/ApiError.js";
import { analyzeVideoComplexity } from "./helper/contentAnalyzer.js";
import { updateStatus } from "./helper/updateStatus.js";
import { storeMetadataToDynamo } from "./helper/metaDataStore.js";
import { generateResolutions } from "./pipeline/transcoder.js";
import { s3 } from "./clients/s3Client.js";
import { uploadProcessedFile } from "./pipeline/uploadTos3.js";

dotenv.config();

const run = async () => {
    const messagePath = path.resolve("sqs-message.json");
    if(!messagePath){
        throw new ApiError(500, "Message path wont exists or there is an error in sqs messaging poller")
    }
    console.log("📩 Reading SQS message from:", messagePath);

    let message;
    try {
        message = JSON.parse(await fs.readFile(messagePath, "utf-8"));
    } catch (e) {
        console.error("❌ Failed to read message file:", e);
        return;
    }

    console.log("📬 Message received:", message);

    const parsedBody = JSON.parse(message.Body);
    const record = parsedBody.Records?.[0];
    if (!record) {
        console.log("⚠️ No valid S3 record found.");
        return;
    }

    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const videoId = path.basename(key, path.extname(key));

    const tempDir = path.resolve("tmp");
    await fs.mkdir(tempDir, { recursive: true });
    const localInputPath = path.join(tempDir, path.basename(key));

    console.log("📦 S3 Bucket:", bucket);
    console.log("🔑 S3 Key:", key);

    try {
        const localInputPath = path.join('tmp', `${videoId}.mp4`);

        console.log("📥 Downloading video from S3...");
        const videoStream = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

        await pipeline(videoStream.Body, createWriteStream(localInputPath));
        console.log("✅ Download complete. Saved to:", localInputPath);

        console.log("📊 Analyzing video complexity...");
        const metadata = await analyzeVideoComplexity(localInputPath);
        console.log("📈 Metadata:", metadata);
        await storeMetadataToDynamo(videoId, metadata);

        console.log("🎞️ Running FFmpeg for all resolutions...");
        const processedPaths = await generateResolutions(localInputPath, videoId);

        for (const outputPath of processedPaths) {
            await uploadProcessedFile({
                bucket,
                key,
                videoId,
                outputPath,
                s3
            });
        }

        await updateStatus(videoId, "done");
        console.log("🎉 Processing complete for:", videoId);

    } catch (err) {
        console.error("❌ Error during processing:", err);
        await updateStatus(videoId, "failed");
    } finally {
        console.log("🧹 Cleaning up...");
        try {
            await fs.unlink(localInputPath);
            await fs.unlink(messagePath);
            console.log("🧼 Temp files removed.");
        } catch (e) {
            console.warn("⚠️ Cleanup failed:", e.message);
        }
    }
};

run().catch(console.error);
