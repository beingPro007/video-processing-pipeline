import { spawn } from "child_process";

export const analyzeVideoComplexity = (videoPath) => {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn("ffprobe", [
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            videoPath
        ]);

        let output = "";
        ffprobe.stdout.on("data", data => output += data.toString());
        ffprobe.stderr.on("data", err => console.error("ffprobe error:", err.toString()));

        ffprobe.on("close", code => {
            if (code !== 0) return reject(new Error(`ffprobe failed with code ${code}`));
            try {
                const parsed = JSON.parse(output);
                const videoStream = parsed.streams.find(s => s.codec_type === "video");
                const audioStream = parsed.streams.find(s => s.codec_type === "audio");

                const metadata = {
                    duration: parseFloat(parsed.format.duration),
                    size: parseInt(parsed.format.size),
                    bitrate: parseInt(parsed.format.bit_rate),
                    codec: videoStream?.codec_name,
                    width: videoStream?.width,
                    height: videoStream?.height,
                    frame_rate: eval(videoStream?.r_frame_rate || "0"),
                    video_bit_rate: parseInt(videoStream?.bit_rate || "0"),
                    audio_codec: audioStream?.codec_name || null,
                };

                resolve(metadata);
            } catch (e) {
                reject(new Error("Error parsing ffprobe output: " + e.message));
            }
        });
    });
};