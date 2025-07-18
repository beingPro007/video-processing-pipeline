import fs from "fs/promises";
import path from "path";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const run = async () => {
    const messagePath = path.resolve("sqs-message.json");

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

    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const tempDir = path.resolve("tmp");
    await fs.mkdir(tempDir, { recursive: true });
    const localInputPath = path.join(tempDir, path.basename(key));
    const localOutputPath = localInputPath.replace(".mp4", "_processed.mp4");

    try {
        const videoStream = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        await fs.writeFile(localInputPath, await videoStream.Body.transformToByteArray());

        await new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", ["-i", localInputPath, "-vcodec", "libx264", localOutputPath]);
            ffmpeg.stderr.on("data", data => console.log("FFmpeg:", data.toString()));
            ffmpeg.on("close", code => (code === 0 ? resolve() : reject("FFmpeg failed")));
        });

        const outputKey = key.replace("videos/", "processed/");
        await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: outputKey,
            Body: await fs.readFile(localOutputPath),
            ContentType: "video/mp4"
        }));

        console.log("✅ Video processed and uploaded:", outputKey);
    } catch (err) {
        console.error("❌ Processing failed:", err);
    } finally {
        try {
            await fs.unlink(localInputPath);
            await fs.unlink(localOutputPath);
            await fs.unlink(messagePath);
        } catch (e) {
            console.warn("⚠️ Cleanup failed:", e.message);
        }
    }
};

run().catch(console.error);
