import { ECSClient } from "@aws-sdk/client-ecs";
import { configDotenv } from "dotenv";
configDotenv({
    path:".env"
})


export const ecsClient = new ECSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
})