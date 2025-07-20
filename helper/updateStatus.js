import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../clients/dynamoDBClient.js";


export const updateStatus = async (videoId, status) => {
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