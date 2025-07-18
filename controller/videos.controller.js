import { PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import asyncHandler from "../utils/asyncHandler.js";
import { readFile } from "node:fs/promises";
import { ApiError } from "../utils/ApiError.js";
import { configDotenv } from "dotenv";
import fs from "fs";
import { ApiResponse } from "../utils/ApiResponse.js";
import path from "path";

configDotenv()


const preUploads3 = asyncHandler(async (req, res, _) => {

    const filePath = req.file?.path;

    if (!filePath) {
        throw new ApiError(500, "Error Uploading Video")
    }

    console.log("Video uploaded to:", req.file.path);

    const s3client = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    const cmd = new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: `videos/${path.basename(filePath)}`,
        Body: await readFile(filePath),
        ContentType: req.file.mimetype,
        ACL: 'private',
        ServerSideEncryption: 'AES256',
    });


    try {
        const response = await s3client.send(cmd);
        console.log(response);
    } catch (caught) {
        if (
            caught instanceof S3ServiceException &&
            caught.name === "EntityTooLarge"
        ) {
            console.error(
                `Error from S3 while uploading object to ${bucketName}. \
The object was too large. To upload objects larger than 5GB, use the S3 console (160GB max) \
or the multipart upload API (5TB max).`,
            );
        } else if (caught instanceof S3ServiceException) {
            console.error(
                `Error from S3 while uploading object to ${bucketName}.  ${caught.name}: ${caught.message}`,
            );
        } else {
            throw caught;
        }
    } finally {
        fs.unlinkSync(filePath)
    }

    return res
        .status(200)
        .json(new ApiResponse(200, "Video Pre Processing Done to S3"))
})

export { preUploads3 }