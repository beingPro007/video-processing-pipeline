import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../clients/dynamoDBClient.js";

export const storeMetadataToDynamo = async (videoId, metadata) => {
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