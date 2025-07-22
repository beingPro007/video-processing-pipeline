const resolutions = ["1080", "720", "480", "360"];
const bitrateTable = {
    "1080": 4500_000,
    "720": 2500_000,
    "480": 1000_000,
    "360": 700_000
};

export function generateLadder(metadata) {
    const allowed = resolutions.filter(r => parseInt(r) <= metadata.height);
    const isComplex = metadata.video_bit_rate > 5_000_000 || metadata.frame_rate > 50;

    return allowed.map(res => {
        const height = parseInt(res);
        const isSameResolution = metadata.height === height;

        return {
            resolution: res,
            height,
            bitrate: bitrateTable[res],
            preset: isComplex ? "slow" : "veryfast",
            codec: isSameResolution && metadata.codec === "h264" && metadata.video_bit_rate < 2_000_000
                ? "copy"
                : "libx264"
        };
    });
}
