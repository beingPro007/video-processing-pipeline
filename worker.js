import fs, { rm } from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { pipeline } from "stream/promises";
import dotenv from "dotenv";

import { ApiError } from "./utils/ApiError.js";
import { s3 } from "./clients/s3Client.js";
import { storeMetadataToDynamo } from "./helper/metaDataStore.js";
import { analyzeVideoComplexity } from "./pipeline/services/contentAnalyzer.js";
import { generateLadder } from "./pipeline/services/generateLadder.js";
import { transcodeHLSFromRecipe } from "./pipeline/transcoder.js";
import { uploadHLSDirectory } from "./pipeline/uploadTos3.js";
import { updateStatus } from "./helper/updateStatus.js";

dotenv.config();

const isLocal = process.env.RUN_MODE === "local";

const run = async () => {
    let bucket, key, videoId;

    if (isLocal) {
        const messagePath = path.resolve("sqs-message.json");
        console.log("📩 Running in LOCAL mode. Reading message from:", messagePath);

        let message;
        try {
            message = JSON.parse(await fs.readFile(messagePath, "utf-8"));
        } catch (e) {
            console.error("❌ Failed to read message file:", e);
            return;
        }

        const parsedBody = JSON.parse(message.Body);
        const record = parsedBody.Records?.[0];

        if (!record) {
            console.log("⚠️ No valid S3 record found.");
            return;
        }

        bucket = record.s3.bucket.name;
        key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    } else {
        console.log("🚀 Running in PRODUCTION (Fargate) mode.");
        console.log("Data We got is: ", process.env.BUCKET, process.env.KEY);
        bucket = process.env.BUCKET;
        key = decodeURIComponent(process.env.KEY || "");
    }

    if (!bucket || !key) {
        throw new ApiError(500, "Missing bucket or key");
    }

    videoId = path.basename(key, path.extname(key));
    const localInputPath = path.join("tmp", `${videoId}.mp4`);
    const tempDir = path.resolve("tmp");

    await fs.mkdir(tempDir, { recursive: true });

    console.log("📦 S3 Bucket:", bucket);
    console.log("🔑 S3 Key:", key);

    try {
        console.log("📥 Downloading video from S3...");
        const videoStream = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        await pipeline(videoStream.Body, createWriteStream(localInputPath));
        console.log("✅ Download complete:", localInputPath);

        console.log("📊 Running content analysis...");
        const metadata = await analyzeVideoComplexity(localInputPath);
        await storeMetadataToDynamo(videoId, metadata);

        console.log("📐 Generating ladder...");
        const recipe = generateLadder(metadata);
        console.log("📋 Recipe:", recipe);

        console.log("🎞️ Transcoding video...");
        const { variants, outputDir } = await transcodeHLSFromRecipe(localInputPath, videoId, recipe);

        if (!Array.isArray(variants)) {
            throw new Error("transcodeHLSFromRecipe must return a variants array");
        }

        for (const variant of variants) {
            const localDir = path.join(outputDir, `${variant.resolution}p`);
            console.log(`📤 Uploading HLS for ${variant.resolution}p from ${localDir}`);

            await uploadHLSDirectory({
                bucket,
                localDir,
                s3Prefix: `processed/${videoId}/${variant.resolution}p`,
                s3
            });
        }

        await updateStatus(videoId, "done");
        console.log("✅ Processing complete for:", videoId);
    } catch (err) {
        console.error("❌ Processing error:", err);
        await updateStatus(videoId, "failed");
    } finally {
        console.log("🧹 Cleaning up...");
        try {
            await rm(path.join("tmp", videoId), { recursive: true, force: true });
            await fs.unlink(localInputPath);
            if (isLocal) {
                await fs.unlink(path.resolve("sqs-message.json"));
            }
            console.log("🧼 Temp files removed.");
        } catch (e) {
            console.warn("⚠️ Cleanup failed:", e.message);
        }
    }
};

run().catch(console.error);
