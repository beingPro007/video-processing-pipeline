import {
    SQSClient,
    ReceiveMessageCommand,
    DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { RunTaskCommand } from "@aws-sdk/client-ecs";
import { ecsClient } from "./clients/ecsClient.js";
import dotenv from "dotenv";
import util from "util";
import fs from "fs/promises";
import path from "path";
import { exec } from 'node:child_process';


dotenv.config();
const sqs = new SQSClient({ region: process.env.AWS_REGION });
const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION })
);

async function launchFargateWorker(videoId, bucket, key) {
    console.log(bucket, videoId, key);
    
    try {
        const command = new RunTaskCommand({
            cluster: process.env.ECS_CLUSTER_NAME,
            launchType: "FARGATE",
            taskDefinition: process.env.ECS_TASK_DEFINITION,
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: [process.env.SUBNET_ID],
                    securityGroups: [process.env.SECURITY_GROUP_ID],
                    assignPublicIp: "ENABLED",
                },
            },
            overrides: {
                containerOverrides: [
                    {
                        name: "video-worker",
                        environment: [
                            { name: "VIDEO_ID", value: videoId },
                            { name: "BUCKET", value: bucket },
                            { name: "KEY", value: key },
                        ],
                    },
                ],
            },
        });

        const result = await ecsClient.send(command);
        console.log("🚀 Launched ECS Task:", result.tasks?.[0]?.taskArn);
        return result;
    } catch (err) {
        console.error("❌ Failed to launch ECS task:", err);
        throw err;
    }
}

async function checkQueueAndLaunchWorker() {
    while (true) {
        let message, receiptHandle;
        try {
            const response = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: process.env.SQS_QUEUE_URL,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 2,
                })
            );
            message = response.Messages?.[0];
            if (!message) {
                console.log("📭 No messages. Sleeping...");
                await new Promise((resolve) => setTimeout(resolve, 2000));
                continue;
            }
            receiptHandle = message.ReceiptHandle;

            let parsedBody;
            try {
                parsedBody = JSON.parse(message.Body);
            } catch (err) {
                console.error("❌ Could not parse message body:", message.Body);
                continue;
            }

            if (parsedBody?.Event === "s3:TestEvent") {
                console.log("⚠️ Skipping s3:TestEvent");
                await sqs.send(
                    new DeleteMessageCommand({
                        QueueUrl: process.env.SQS_QUEUE_URL,
                        ReceiptHandle: receiptHandle,
                    })
                );
                continue;
            }

            const record = parsedBody?.Records?.[0];
            if (!record) {
                console.error("❌ Invalid S3 record.");
                continue;
            }

            const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
            const videoId = path.basename(key, path.extname(key));
            const bucket = record.s3.bucket.name;

            try {
                await ddb.send(
                    new PutCommand({
                        TableName: process.env.DYNAMO_TABLE_NAME,
                        Item: {
                            videoId,
                            bucket,
                            key,
                            status: "processing",
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                    })
                );
                console.log("🗃️ DynamoDB: status → processing");
            } catch (err) {
                console.error("❌ Failed to write to DynamoDB:", err);
                throw err;
            }

            const messagePath = path.resolve("sqs-message.json");
            await fs.writeFile(messagePath, JSON.stringify(message));

            try {
                console.log("🚀 Launching ECS Fargate task...");
                await launchFargateWorker(videoId, bucket, key);
            } catch (err) {
                console.error("❌ Worker container failed:", err);
                throw err;
            }

            // Success → delete message
            await sqs.send(
                new DeleteMessageCommand({
                    QueueUrl: process.env.SQS_QUEUE_URL,
                    ReceiptHandle: receiptHandle,
                })
            );
            console.log("🧹 SQS message deleted.");

        } catch (err) {
            console.error("❌ Poller error:", err);
            // In a production system, consider adding a backoff or circuit breaker here
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
        }
    }
}

checkQueueAndLaunchWorker();
