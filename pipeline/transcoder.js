import { spawn } from "child_process";
import path from "path";

const resolutions = ["1080", "720", "480", "360"];
const bitrateTable = {
    "1080": 4500_000,
    "720": 2500_000,
    "480": 1000_000,
    "360": 700_000
};

export async function generateResolutions(filePath, videoId, metadata) {
    const allowed = resolutions.filter(r => parseInt(r) <= metadata.height);

    const preset = metadata.video_bit_rate > 5_000_000 || metadata.frame_rate > 50
        ? "slow"
        : "veryfast";

    const codecCopySafe = metadata.codec === "h264" && metadata.video_bit_rate < 2_000_000;

    const tasks = allowed.map(res => {
        return new Promise((resolve, reject) => {
            const height = parseInt(res);
            const outputPath = path.join("tmp", `${videoId}_${res}p.mp4`);

            const args = [
                "-i", filePath,
                "-vf", `scale=-2:${height}`,
                ...(codecCopySafe
                    ? ["-c:v", "copy"]
                    : ["-vcodec", "libx264", "-b:v", bitrateTable[res].toString(), "-preset", preset]
                ),
                "-acodec", "aac",
                "-movflags", "+faststart",
                outputPath
            ];

            const ffmpeg = spawn("ffmpeg", args);
            ffmpeg.stderr.on("data", data => console.log(`[${res}p]`, data.toString()));
            ffmpeg.on("close", code => {
                if (code === 0) {
                    console.log(`✅ Generated ${res}p`);
                    resolve(outputPath);
                } else {
                    reject(new Error(`❌ ${res}p failed with code ${code}`));
                }
            });
        });
    });

    return Promise.all(tasks);
}
