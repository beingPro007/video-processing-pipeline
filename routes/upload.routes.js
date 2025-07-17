import express, { Router } from "express";
import fs from "fs";
import { upload } from "../middlewares/multer.middleware.js";
import { preUploads3 } from "../controller/videos.controller.js";

const router = Router()

router.route("/upload").post(upload.single("video"), preUploads3)

export default router