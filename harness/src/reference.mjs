// Reference ("ground truth") for every sample (SPEC.md §4.3): read from
// TikTok's own page data, cross-checked with yt-dlp for videos. Also fetches
// TikTok's own unwatermarked and watermarked versions of each video for the
// watermark check (kept locally in .cache/refs, never published).
//
//   node src/reference.mjs [--samples ../samples/core.json] [--only V1,P4] [--no-media] [--force]
//   node src/reference.mjs --check     (before each run: is every sample still live and public?)
//
// Items that already have a reference are skipped unless --force.
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

/**
 * TikTok's page data for a post. With `page` (a Playwright page in the
 * installed Chrome) it is read the way a visitor's browser loads it, which
 * TikTok throttles far less than plain requests; without, a plain fetch.
 */
export async function pageData(url, page = null) {
    let raw = null, status, size = 0, parsed = null;
    if (page) {
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        status = res?.status();
        // TikTok sometimes reloads the page once it has loaded; read until the data is complete.
        for (let i = 0; i < 20 && !parsed; i++) {
            await page.waitForLoadState("domcontentloaded").catch(() => {});
            raw = await page.$eval("#__UNIVERSAL_DATA_FOR_REHYDRATION__", (el) => el.textContent).catch(() => null);
            size = raw?.length ?? 0;
            try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
            if (!parsed) await page.waitForTimeout(1000);
        }
    } else {
        const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
        const html = await res.text();
        status = res.status;
        size = html.length;
        raw = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? null;
        parsed = raw ? JSON.parse(raw) : null;
    }
    if (!parsed) throw new Error(`no page data (HTTP ${status}, ${size} bytes)`);
    const scope = parsed.__DEFAULT_SCOPE__?.["webapp.video-detail"];
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
        musicId: it.music?.id ?? null,
        musicDuration: Number(it.music?.duration) || null,
        musicOriginal: it.music?.original ?? null,
    };
}

/** yt-dlp's metadata for a post; kept in `infoFile` so the media downloads reuse it (one page load per post). */
async function ytdlp(url, infoFile) {
    const { stdout } = await run("yt-dlp", ["-J", "--no-warnings", url], { maxBuffer: 64 << 20, timeout: 90_000 });
    writeFileSync(infoFile, stdout);
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
    const { launchBrowser, newContext } = await import("./browser.mjs");
    const browser = await launchBrowser();
    const page = await (await newContext(browser)).newPage();
    if (process.argv.includes("--check")) {
        // Every positive sample, core and rotating, against its reference (SPEC.md §4.2).
        const files = arg("samples", null) ? [samplesFile] : [join(REPO, "samples", "core.json"), join(REPO, "samples", "local-rotating.json")];
        const all = files.filter(existsSync).flatMap((f) => JSON.parse(readFileSync(f, "utf8")).items).filter((i) => i.kind === "video" || i.kind === "photos");
        const dead = [];
        for (const item of all) {
            const c = canonical(item.url);
            try {
                const now = fromItem(await pageData(c.url, page));
                const ref = existsSync(join(REF_DIR, `${item.id}.json`)) ? JSON.parse(readFileSync(join(REF_DIR, `${item.id}.json`), "utf8")) : null;
                const changed = ref && (now.duration !== ref.duration || now.imageCount !== ref.imageCount) ? " (changed since the reference — recapture with --force)" : "";
                console.log(`${item.id}: live${changed}`);
                if (changed) dead.push(item.id);
            } catch (e) {
                console.log(`${item.id}: NOT LIVE — ${e.message}`);
                dead.push(item.id);
            }
            await new Promise((r) => setTimeout(r, 3000 + Math.random() * 3000));
        }
        await browser.close();
        console.log(dead.length ? `\n${dead.length} sample(s) to replace or recapture (log it in CHANGELOG.md): ${dead.join(", ")}` : `\nall ${all.length} samples live`);
        process.exitCode = dead.length ? 1 : 0;
        return;
    }
    for (const item of items) {
        if (!process.argv.includes("--force") && existsSync(join(REF_DIR, `${item.id}.json`))) continue;
        const c = canonical(item.url);
        if (!c) { console.log(`${item.id}: not a TikTok post link, skipped`); continue; }
        try {
            const it = await pageData(c.url, page);
            const ref = { sample: item.id, url: item.url, captured: new Date().toISOString(), ...fromItem(it) };
            // The caption is printed for the operator's content check (SPEC.md §4.2), not stored.
            console.log(`${item.id}: @${ref.author} “${String(it.desc ?? "").replace(/\s+/g, " ").slice(0, 90)}”`);
            if (!ref.isPhoto) {
                const infoFile = join(MEDIA_DIR, `${item.id}.info.json`);
                const y = formatsOf(await ytdlp(c.url, infoFile));
                ref.ytdlp = { duration: y.duration, maxHeight: y.maxHeight };
                if (y.duration && ref.duration && Math.abs(y.duration - ref.duration) > 1) ref.warning = `page says ${ref.duration}s, yt-dlp ${y.duration}s`;
                if (media && y.clean && y.marked) {
                    for (const [which, fmt] of [["clean", y.clean], ["marked", y.marked]]) {
                        const out = join(MEDIA_DIR, `${item.id}-${which}.mp4`);
                        if (!existsSync(out)) await run("yt-dlp", ["-q", "--no-warnings", "--load-info-json", infoFile, "-f", fmt, "-o", out], { timeout: 180_000 });
                    }
                    ref.watermarkReference = true;
                }
            }
            writeFileSync(join(REF_DIR, `${item.id}.json`), JSON.stringify(ref, null, 2) + "\n");
            console.log(`${item.id}: ${ref.isPhoto ? `${ref.imageCount} images` : `${ref.duration}s, ${ref.maxHeight}p`}${ref.musicDuration ? `, music ${ref.musicDuration}s` : ""}, ${ref.created?.slice(0, 10)}${ref.warning ? ` ⚠ ${ref.warning}` : ""}`);
        } catch (e) {
            console.log(`${item.id}: FAILED ${e.message.split("\n")[0].slice(0, 160)}`);
        }
        await new Promise((r) => setTimeout(r, 3000 + Math.random() * 3000));
    }
    await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
