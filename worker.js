import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";
import dotenv from "dotenv";
import { ApiError } from "./utils/ApiError.js";

dotenv.config();

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION })
);



//Helper Functions
const updateStatus = async (videoId, status) => {
    try {
        await ddb.send(
            new UpdateCommand({
                TableName: process.env.DYNAMO_TABLE_NAME,
                Key: { videoId },
                UpdateExpression: "set #s = :s, updatedAt = :u",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: {
                    ":s": status,
                    ":u": new Date().toISOString(),
                },
            })
        );
        console.log(`🗃️ DynamoDB updated: videoId=${videoId}, status=${status}`);
    } catch (err) {
        console.error("❌ Failed to update DynamoDB:", err);
    }
};

const analyzeVideoComplexity = (videoPath) => {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn("ffprobe", [
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            videoPath
        ]);

        let output = "";
        ffprobe.stdout.on("data", data => output += data.toString());
        ffprobe.stderr.on("data", err => console.error("ffprobe error:", err.toString()));

        ffprobe.on("close", code => {
            if (code !== 0) return reject(new Error(`ffprobe failed with code ${code}`));
            try {
                const parsed = JSON.parse(output);
                const videoStream = parsed.streams.find(s => s.codec_type === "video");
                const audioStream = parsed.streams.find(s => s.codec_type === "audio");

                const metadata = {
                    duration: parseFloat(parsed.format.duration),
                    size: parseInt(parsed.format.size),
                    bitrate: parseInt(parsed.format.bit_rate),
                    codec: videoStream?.codec_name,
                    width: videoStream?.width,
                    height: videoStream?.height,
                    frame_rate: eval(videoStream?.r_frame_rate || "0"),
                    video_bit_rate: parseInt(videoStream?.bit_rate || "0"),
                    audio_codec: audioStream?.codec_name || null,
                };

                resolve(metadata);
            } catch (e) {
                reject(new Error("Error parsing ffprobe output: " + e.message));
            }
        });
    });
};

const storeMetadataToDynamo = async (videoId, metadata) => {
    try {
        await ddb.send(new PutCommand({
            TableName: process.env.DYNAMO_METADATA_TABLE,
            Item: {
                videoId,
                ...metadata,
                createdAt: new Date().toISOString()
            }
        }));
        console.log("🧠 Metadata inserted successfully.");
    } catch (err) {
        console.error("❌ Failed to save metadata:", err);
    }
};
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
    const localOutputPath = localInputPath.replace(".mp4", "_processed.mp4");

    console.log("📦 S3 Bucket:", bucket);
    console.log("🔑 S3 Key:", key);

    try {
        await updateStatus(videoId, "processing");

        console.log("📥 Downloading video from S3...");
        const videoStream = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

        await pipeline(videoStream.Body, createWriteStream(localInputPath));
        console.log("✅ Download complete. Saved to:", localInputPath);

        console.log("📊 Analyzing video complexity...");
        const metadata = await analyzeVideoComplexity(localInputPath);
        console.log("📈 Metadata:", metadata);
        await storeMetadataToDynamo(videoId, metadata);

        console.log("🎞️ Running FFmpeg...");
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", ["-i", localInputPath, "-vcodec", "libx264", localOutputPath]);

            ffmpeg.stderr.on("data", data => console.log("FFmpeg:", data.toString()));
            ffmpeg.on("close", code => {
                if (code === 0) {
                    console.log("✅ FFmpeg processing complete.");
                    resolve();
                } else {
                    reject("❌ FFmpeg failed with exit code: " + code);
                }
            });
        });

        const outputKey = key.replace("videos/", "processed/");
        const processedFile = await fs.readFile(localOutputPath);

        console.log("📤 Uploading processed video to S3...");
        await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: outputKey,
            Body: processedFile,
            ContentType: "video/mp4"
        }));

        console.log("✅ Upload successful:", outputKey);
        await updateStatus(videoId, "done");

    } catch (err) {
        console.error("❌ Processing failed:", err);
        await updateStatus(videoId, "failed");
    } finally {
        console.log("🧹 Cleaning up...");
        try {
            await fs.unlink(localInputPath);
            await fs.unlink(localOutputPath);
            await fs.unlink(messagePath);
            console.log("🧼 Temp files removed.");
        } catch (e) {
            console.warn("⚠️ Cleanup failed:", e.message);
        }
    }
};

run().catch(console.error);
