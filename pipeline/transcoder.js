import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

export async function transcodeHLSFromRecipe(filePath, videoId, recipe) {
    const hlsDir = path.join("tmp", videoId, "hls");
    await fs.mkdir(hlsDir, { recursive: true });

    const variants = [];

    for (const { resolution, height, bitrate } of recipe) {
        const variantDir = path.join(hlsDir, `${resolution}p`);
        await fs.mkdir(variantDir, { recursive: true });

        const outputPath = path.join(variantDir, "index.m3u8");
        const segmentPattern = path.join(variantDir, "segment_%03d.ts");

        const args = [
            "-i", filePath,
            "-vf", `scale=-2:${height}`,
            "-c:a", "aac",
            "-ar", "48000",
            "-c:v", "h264",
            "-profile:v", "main",
            "-crf", "20",
            "-sc_threshold", "0",
            "-g", "48",
            "-keyint_min", "48",
            "-b:v", bitrate.toString(),
            "-maxrate", Math.floor(bitrate * 1.07).toString(),
            "-bufsize", (bitrate * 2).toString(),
            "-hls_time", "4",
            "-hls_playlist_type", "vod",
            "-hls_segment_filename", segmentPattern,
            outputPath
        ];

        await new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", args);
            ffmpeg.stderr.on("data", data => {
                console.log(`[HLS ${resolution}p]`, data.toString());
            });
            ffmpeg.on("close", code => {
                if (code === 0) {
                    console.log(`✅ HLS ${resolution}p generated`);
                    variants.push({
                        resolution,
                        height,
                        path: `${resolution}p/index.m3u8`,
                        bandwidth: bitrate
                    });
                    resolve();
                } else {
                    reject(new Error(`❌ HLS ${resolution}p failed with code ${code}`));
                }
            });
        });
    }

    // Create master playlist
    const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3
${variants.map(v => `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=1280x${v.height}
${v.path}`).join("\n")}
`;

    const masterPath = path.join(hlsDir, "master.m3u8");
    await fs.writeFile(masterPath, masterPlaylist);

    return {
        variants,
        masterPlaylistPath: masterPath,
        outputDir: hlsDir
    };
}
