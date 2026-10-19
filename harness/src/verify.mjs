// Checks a downloaded file against the item's reference (SPEC.md §6.A1, §6.B).
// Needs ffmpeg and ffprobe on PATH.
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { imageSize } from "image-size";

const run = promisify(execFile);
const DURATION_TOLERANCE_S = 1;

export async function probe(file) {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { maxBuffer: 8 << 20 });
    const j = JSON.parse(stdout);
    const v = j.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
    const a = j.streams.find((s) => s.codec_type === "audio");
    return {
        format: j.format?.format_name ?? null,
        duration: Number(j.format?.duration ?? v?.duration ?? a?.duration ?? NaN),
        bytes: Number(j.format?.size ?? NaN),
        video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
        audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : null,
    };
}

/** Decode the whole file; a truncated or corrupt file fails here. */
export async function decodes(file) {
    try {
        const { stderr } = await run("ffmpeg", ["-v", "error", "-nostdin", "-i", file, "-f", "null", "-"], { maxBuffer: 8 << 20, timeout: 180_000 });
        const errors = stderr.split("\n").filter(Boolean);
        return { ok: true, warnings: errors.slice(0, 3) };
    } catch (e) {
        return { ok: false, warnings: String(e.stderr || e.message).split("\n").filter(Boolean).slice(0, 3) };
    }
}

/**
 * A video item. `ref` = { duration, maxHeight }. `label` = the control's text,
 * checked for honesty against what was delivered.
 */
export async function verifyVideo(file, ref, label = "") {
    const reasons = [];
    let p;
    try {
        p = await probe(file);
    } catch (e) {
        return { ok: false, reasons: ["not a readable media file"], probe: null };
    }
    if (!p.video) reasons.push("no video stream");
    if (ref?.duration && !(Math.abs(p.duration - ref.duration) <= DURATION_TOLERANCE_S)) reasons.push(`duration ${p.duration}s vs ${ref.duration}s`);
    const d = await decodes(file);
    if (!d.ok) reasons.push("does not decode cleanly");
    const height = p.video ? Math.max(p.video.height, p.video.width) : 0;
    const refHeight = ref?.maxHeight ?? null;
    const resolutionRatio = refHeight && height ? Math.min(1, height / refHeight) : null;
    return {
        ok: reasons.length === 0,
        reasons,
        probe: p,
        decodeWarnings: d.warnings,
        resolutionRatio,
        labelDishonesty: videoLabelProblems(label, p),
    };
}

/** "HD" < 720p, "1080p" < 1080p, "MP4" that isn't MP4 (SPEC.md §6.B). Watermark claims are checked separately. */
export function videoLabelProblems(label, p) {
    const problems = [];
    const longSide = p?.video ? Math.max(p.video.width, p.video.height) : 0;
    const shortSide = p?.video ? Math.min(p.video.width, p.video.height) : 0;
    if (/1080/.test(label) && shortSide < 1080) problems.push(`"1080" label but ${p.video?.width}x${p.video?.height}`);
    else if (/\bHD\b/i.test(label) && shortSide < 720) problems.push(`"HD" label but ${p.video?.width}x${p.video?.height}`);
    if (/\bmp4\b/i.test(label) && p?.format && !/mp4|mov/.test(p.format)) problems.push(`"MP4" label but ${p.format}`);
    void longSide;
    return problems;
}

/** An MP3 task: real audio, at least a second long, decodes; "MP3" must be MP3. */
export async function verifyAudio(file, ref, label = "") {
    const reasons = [];
    let p;
    try {
        p = await probe(file);
    } catch {
        return { ok: false, reasons: ["not a readable media file"], probe: null };
    }
    if (!p.audio) reasons.push("no audio stream");
    if (!(p.duration >= 1)) reasons.push("shorter than 1 s");
    if (ref?.musicDuration && Math.abs(p.duration - ref.musicDuration) > DURATION_TOLERANCE_S && ref?.duration && Math.abs(p.duration - ref.duration) > DURATION_TOLERANCE_S) {
        reasons.push(`duration ${p.duration}s matches neither the sound (${ref.musicDuration}s) nor the video (${ref.duration}s)`);
    }
    const d = await decodes(file);
    if (!d.ok) reasons.push("does not decode cleanly");
    const labelDishonesty = [];
    if (/mp3/i.test(label) && p.audio?.codec !== "mp3") labelDishonesty.push(`"MP3" label but ${p.audio?.codec ?? "no audio"} in ${p.format}`);
    return { ok: reasons.length === 0, reasons, probe: p, labelDishonesty };
}

/** ZIP archives (e.g. "Download all photos") are unpacked; their files are checked like the rest. */
export async function expandZips(files) {
    const out = [];
    for (const f of files) {
        const head = await readFile(f).then((b) => b.subarray(0, 4)).catch(() => Buffer.alloc(0));
        if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
            const dir = `${f}.unzipped`;
            await mkdir(dir, { recursive: true });
            await run("unzip", ["-o", "-q", f, "-d", dir], { timeout: 60_000 }).catch(() => {});
            const walk = async (d) => {
                for (const e of await readdir(d, { withFileTypes: true })) {
                    const p = join(d, e.name);
                    if (e.isDirectory()) await walk(p);
                    else if (!e.name.startsWith(".") && !p.includes("__MACOSX")) out.push(p);
                }
            };
            await walk(dir);
        } else out.push(f);
    }
    return out.sort();
}

/** Photo-post files: every image decodes; count and size against the reference. */
export async function verifyImages(rawFiles, ref) {
    const files = await expandZips(rawFiles);
    const images = [];
    for (const f of files) {
        try {
            const buf = await readFile(f);
            const s = imageSize(buf);
            images.push({ file: f, type: s.type, width: s.width, height: s.height });
        } catch {
            // Not an image: say what it is when it is media (a photo post answered with its sound or a video).
            const p = await probe(f).catch(() => null);
            images.push({ file: f, type: null, media: p?.video ? "video" : p?.audio ? "audio" : null });
        }
    }
    const reasons = [];
    const readable = images.filter((i) => i.type);
    const media = images.filter((i) => i.media);
    if (media.length) reasons.push(`delivered ${[...new Set(media.map((i) => i.media))].join(" and ")} instead of the photos`);
    if (readable.length + media.length !== images.length) reasons.push(`${images.length - readable.length - media.length} file(s) are not readable images`);
    if (ref?.imageCount && readable.length !== ref.imageCount) reasons.push(`${readable.length} images vs ${ref.imageCount} in the post`);
    const heicOnly = readable.length > 0 && readable.every((i) => /hei[cf]/i.test(i.type));
    const downscaled = ref?.maxImageWidth ? readable.filter((i) => i.width < ref.maxImageWidth * 0.95).length : 0;
    return { ok: reasons.length === 0, reasons, images, heicOnly, downscaled };
}

// ── Watermark check (SPEC.md §6.B) ──────────────────────────────────────
const FW = 36, FH = 64;

async function grayFrame(file, t) {
    const { stdout } = await run("ffmpeg", ["-v", "error", "-nostdin", "-ss", String(t), "-i", file, "-frames:v", "1",
        "-vf", `scale=${FW}:${FH},format=gray`, "-f", "rawvideo", "pipe:1"], { encoding: "buffer", maxBuffer: 1 << 20, timeout: 30_000 });
    return stdout.length === FW * FH ? stdout : null;
}

/**
 * Compare the tool's file with TikTok's unwatermarked and watermarked versions
 * of the same post at 10%, 50% and 90% of its length, only on the pixels where
 * those two differ (the watermark). Closer to the watermarked one at 2 of the
 * 3 points → flagged for a person to confirm (`flagged`), never decided alone.
 */
export async function watermarkCheck(file, refClean, refMarked, duration) {
    if (!refClean || !refMarked || !duration) return { checked: false };
    const votes = [];
    for (const frac of [0.1, 0.5, 0.9]) {
        const t = (duration * frac).toFixed(2);
        const [a, n, w] = await Promise.all([grayFrame(file, t), grayFrame(refClean, t), grayFrame(refMarked, t)]).catch(() => [null, null, null]);
        if (!a || !n || !w) continue;
        let toClean = 0, toMarked = 0, count = 0;
        for (let i = 0; i < a.length; i++) {
            if (Math.abs(n[i] - w[i]) <= 25) continue;
            count++;
            toClean += Math.abs(a[i] - n[i]);
            toMarked += Math.abs(a[i] - w[i]);
        }
        if (count >= 12) votes.push(toMarked < toClean ? "marked" : "clean");
    }
    const marked = votes.filter((v) => v === "marked").length;
    return { checked: votes.length >= 2, votes, flagged: marked >= 2 };
}
