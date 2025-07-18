import express from "express";
import cors from "cors"

const app = express({
    debug: true
})

app.use(cors({
    origin: "*"
}))
app.use(express.json({limit: "16kb"}))

import uploadRouter from "./routes/upload.routes.js"
import { debug } from "node:console";

app.use("/api/v1/video", uploadRouter)

export default app;