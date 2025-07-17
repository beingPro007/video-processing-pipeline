import multer from "multer";
import fs from "fs";
import path from "path";

const uploadDir = path.resolve("public", "temp");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log("Created folder:", uploadDir);
} else {
    console.log("Folder already exists:", uploadDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        console.log("📦 Writing file to:", uploadDir);
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        console.log("📝 Incoming file:", file.originalname);
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

export const upload = multer({ storage });
