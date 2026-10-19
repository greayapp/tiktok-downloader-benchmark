// Reference ("ground truth") for every sample (SPEC.md §4.3): read from
// TikTok's own page data, cross-checked with yt-dlp for videos. Also fetches
// TikTok's own unwatermarked and watermarked versions of each video for the
// watermark check (kept locally in .cache/refs, never published).
//
//   node src/reference.mjs [--samples ../samples/core.json] [--only V1,P4] [--no-media]
//
// Needs direct access to tiktok.com (where it is blocked, run it through a VPN
// and note that in the edition's run.json) and yt-dlp on PATH.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const REF_DIR = join(REPO, "samples", "reference");
const MEDIA_DIR = join(HERE, "..", ".cache", "refs");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

/** TikTok post IDs carry their publish time in the top 32 bits. */
export const idTime = (id) => new Date(Number(BigInt(id) >> 32n) * 1000).toISOString();

/** The post's canonical /video/ URL (photo posts only expose their data there). */
export function canonical(url) {
    const m = url.match(/tiktok\.com\/@([^/?#]+)\/(?:video|photo)\/(\d+)/);
    return m ? { url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`, user: m[1], id: m[2] } : null;
}

export async function pageData(url) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
    const html = await res.text();
    const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error(`no page data (HTTP ${res.status}, ${html.length} bytes)`);
    const scope = JSON.parse(m[1]).__DEFAULT_SCOPE__?.["webapp.video-detail"];
    if (!scope?.itemInfo?.itemStruct) throw new Error(`no item (statusCode ${scope?.statusCode ?? "?"})`);
    return scope.itemInfo.itemStruct;
}

/** Reference fields from TikTok's page data. */
export function fromItem(it) {
    const images = it.imagePost?.images ?? [];
    const v = it.video ?? {};
    const heights = (v.bitrateInfo ?? []).map((b) => Math.max(b.PlayAddr?.Height ?? 0, b.PlayAddr?.Width ?? 0)).filter(Boolean);
    return {
        id: it.id,
        author: it.author?.uniqueId ?? null,
        created: it.createTime ? new Date(Number(it.createTime) * 1000).toISOString() : null,
        isPhoto: images.length > 0,
        duration: images.length ? null : Number(v.duration) || null,
        maxHeight: images.length ? null : (heights.length ? Math.max(...heights) : Math.max(v.height ?? 0, v.width ?? 0) || null),
        imageCount: images.length || null,
        maxImageWidth: images.length ? Math.max(...images.map((i) => i.imageWidth ?? 0)) || null : null,
        hasMusic: !!it.music?.id,
        musicDuration: Number(it.music?.duration) || null,
        musicOriginal: it.music?.original ?? null,
    };
}

async function ytdlp(url) {
    const { stdout } = await run("yt-dlp", ["-J", "--no-warnings", url], { maxBuffer: 64 << 20, timeout: 90_000 });
    return JSON.parse(stdout);
}

/** yt-dlp's view of a video: duration, the tallest unwatermarked format, and the watermarked one. */
export function formatsOf(j) {
    const fmts = (j.formats ?? []).filter((f) => f.vcodec && f.vcodec !== "none");
    const marked = fmts.find((f) => /watermark/i.test(f.format_note ?? "") || /^download/.test(f.format_id));
    const clean = fmts.filter((f) => f !== marked).sort((a, b) => Math.max(b.height ?? 0, b.width ?? 0) - Math.max(a.height ?? 0, a.width ?? 0))[0];
    return { duration: j.duration ?? null, maxHeight: clean ? Math.max(clean.height ?? 0, clean.width ?? 0) : null, clean: clean?.format_id ?? null, marked: marked?.format_id ?? null };
}

async function main() {
    const samplesFile = arg("samples", join(REPO, "samples", "core.json"));
    const only = arg("only", null)?.split(",");
    const media = !process.argv.includes("--no-media");
    const items = JSON.parse(readFileSync(samplesFile, "utf8")).items.filter((i) => i.kind !== "negative" && !i.refId && (!only || only.includes(i.id)));
    mkdirSync(REF_DIR, { recursive: true });
    mkdirSync(MEDIA_DIR, { recursive: true });
    for (const item of items) {
        const c = canonical(item.url);
        if (!c) { console.log(`${item.id}: not a TikTok post link, skipped`); continue; }
        try {
            const ref = { sample: item.id, url: item.url, captured: new Date().toISOString(), ...fromItem(await pageData(c.url)) };
            if (!ref.isPhoto) {
                const y = formatsOf(await ytdlp(c.url));
                ref.ytdlp = { duration: y.duration, maxHeight: y.maxHeight };
                if (y.duration && ref.duration && Math.abs(y.duration - ref.duration) > 1) ref.warning = `page says ${ref.duration}s, yt-dlp ${y.duration}s`;
                if (media && y.clean && y.marked) {
                    for (const [which, fmt] of [["clean", y.clean], ["marked", y.marked]]) {
                        const out = join(MEDIA_DIR, `${item.id}-${which}.mp4`);
                        if (!existsSync(out)) await run("yt-dlp", ["-q", "--no-warnings", "-f", fmt, "-o", out, c.url], { timeout: 180_000 });
                    }
                    ref.watermarkReference = true;
                }
            }
            writeFileSync(join(REF_DIR, `${item.id}.json`), JSON.stringify(ref, null, 2) + "\n");
            console.log(`${item.id}: ${ref.isPhoto ? `${ref.imageCount} images` : `${ref.duration}s, ${ref.maxHeight}p`}${ref.musicDuration ? `, music ${ref.musicDuration}s` : ""}, ${ref.created?.slice(0, 10)}${ref.warning ? ` ⚠ ${ref.warning}` : ""}`);
        } catch (e) {
            console.log(`${item.id}: FAILED ${e.message.split("\n")[0].slice(0, 160)}`);
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
