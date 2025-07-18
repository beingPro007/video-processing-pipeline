// poller.js
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { exec } from "child_process";
import dotenv from "dotenv";
import util from "util";
import fs from "fs/promises";
import path from "path";

dotenv.config();
const execPromise = util.promisify(exec);
const sqs = new SQSClient({ region: process.env.AWS_REGION });

async function checkQueueAndLaunchWorker() {
    while (true) {
        const { Messages } = await sqs.send(new ReceiveMessageCommand({
            QueueUrl: process.env.SQS_QUEUE_URL,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 2,
        }));

        if (!Messages?.length) {
            console.log("📭 No messages. Sleeping...");
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
        }

        const message = Messages[0];
        const receiptHandle = message.ReceiptHandle;

        let parsedBody;
        try {
            parsedBody = JSON.parse(message.Body);
        } catch (err) {
            console.error("❌ Could not parse message body:", message.Body);
            continue;
        }

        if (parsedBody?.Event === "s3:TestEvent") {
            console.log("⚠️ Skipping s3:TestEvent");
            await sqs.send(new DeleteMessageCommand({
                QueueUrl: process.env.SQS_QUEUE_URL,
                ReceiptHandle: receiptHandle
            }));
            continue;
        }

        console.log("📦 Valid message found. Writing to file...");

        const messagePath = path.resolve("sqs-message.json");
        await fs.writeFile(messagePath, JSON.stringify(message));

        try {
            console.log("🚀 Launching container with message file...");
            await execPromise(`docker run --rm -v ${process.cwd()}:/app --env-file .env video-encoder:v8`);
        } catch (err) {
            console.error("❌ Worker container failed:", err.stderr || err.message);
            continue; // Do not delete the message if processing fails
        }

        // ✅ Delete only if success
        await sqs.send(new DeleteMessageCommand({
            QueueUrl: process.env.SQS_QUEUE_URL,
            ReceiptHandle: receiptHandle
        }));
        console.log("🧹 SQS message deleted.");
    }
}

checkQueueAndLaunchWorker();
