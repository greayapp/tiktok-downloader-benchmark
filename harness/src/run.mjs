// Run tools × items × viewports and write result records (SPEC.md §5, Appendix B).
//
//   node src/run.mjs --edition 2026q4 --run r1 [--tools snaptik.app,ssstik.io]
//                    [--items all|core|V1,P4] [--viewports desktop,mobile]
//                    [--no-retry] [--headless] [--parallel 3] [--samples dev-samples.json]
//
// Records → ../results/<edition>/runs/<run>/<tool>/ (published);
// downloads and screenshots → runs-local/ (not published; SPEC.md §8).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, newContext } from "./browser.mjs";
import { runItem } from "./flow.mjs";
import { loadEngines } from "./lists.mjs";
import { observe, siteOf, snapshot, thirdPartyCookies } from "./observe.mjs";
import { loadAdapter, TOOLS } from "./tools.mjs";
import { checkVantage } from "./vantage.mjs";
import { heldBy, take } from "./lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const edition = arg("edition", "dev");
const runId = arg("run", "r0");
const toolFilter = arg("tools", null)?.split(",");
const viewports = arg("viewports", "desktop,mobile").split(",");
const itemSel = arg("items", "all");
const retry = !flag("no-retry");
// Tools tested at once: 1 for editions (SPEC.md §5.1: no test shares the line); more only for development.
const parallel = Math.max(1, Number(arg("parallel", "1")));
const headless = flag("headless");
// --resume: keep this run's finished tool × viewport blocks (those with a behaviour file) and redo
// any block left unfinished, from its start, so its behaviour record stays complete.
const resume = flag("resume");
// A harness hang must not stall a run: an item still unfinished after 12 minutes is recorded as
// skipped (not the tool's failure) and the tool continues in a fresh tab.
const ITEM_WATCHDOG_MS = Number(process.env.TDB_WATCHDOG_MS) || 12 * 60_000; // env override for testing only

// Seeded shuffle, so a run's order is random but reproducible from its id.
function seeded(seed) {
    let h = 2166136261;
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}
const shuffle = (xs, rnd) => xs.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadSamples() {
    // --samples <file> for development runs; otherwise the core set plus the
    // edition's rotating set (private until published: samples/local-rotating.json).
    const files = arg("samples", null)
        ? [arg("samples")]
        : [join(REPO, "samples", "core.json"), join(REPO, "samples", `${edition}-rotating.json`), join(REPO, "samples", "local-rotating.json")];
    const items = [];
    for (const f of files) if (existsSync(f)) items.push(...JSON.parse(readFileSync(f, "utf8")).items);
    if (itemSel === "all") return items;
    if (itemSel === "core") return items.filter((i) => !i.rotating);
    const ids = new Set(itemSel.split(","));
    return items.filter((i) => ids.has(i.id));
}

function loadRef(item) {
    const id = item.refId ?? item.id;
    const f = join(REPO, "samples", "reference", `${id}.json`);
    const ref = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
    const media = join(HERE, "..", ".cache", "refs");
    const clean = join(media, `${id}-clean.mp4`), marked = join(media, `${id}-marked.mp4`);
    return { ref, refMedia: existsSync(clean) && existsSync(marked) ? { clean, marked } : null };
}

const items = loadSamples();
if (!items.length) {
    console.error("no samples selected (samples/core.json missing or --items matched nothing)");
    process.exit(2);
}
const tools = (await Promise.all(TOOLS.filter((t) => !toolFilter || toolFilter.includes(t.domain)).map(loadAdapter)));
const rnd = seeded(`${edition}/${runId}`);
const engines = await loadEngines();
const outBase = join(REPO, "results", edition, "runs", runId);
const localBase = join(HERE, "..", "runs-local", edition, runId);
// One test at a time on the line (SPEC.md §5.1): wait for a daily monitor check that is running.
for (let m; (m = heldBy("monitor")); ) { console.log(`waiting: the daily monitor is running (since ${m.started})`); await sleep(60_000); }
take("edition-run", { edition, run: runId });
// Location and bandwidth first (SPEC.md §5.1); refuses to run off the residential line.
const vantage = await checkVantage({ allowAny: flag("any-vantage") }).catch((e) => { console.error(e.message); process.exit(2); });
const refFile = join(REPO, "samples", "reference", "capture.json");
const browser = await launchBrowser({ headless });
// On --resume, the run keeps its original start (the earliest record) and notes when it resumed.
const earliest = () => {
    let t = null;
    if (!existsSync(outBase)) return t;
    for (const d of readdirSync(outBase, { withFileTypes: true }).filter((e) => e.isDirectory())) {
        for (const f of readdirSync(join(outBase, d.name)).filter((x) => /^[A-Z]\d+-(desktop|mobile)\.json$/.test(x))) {
            const st = JSON.parse(readFileSync(join(outBase, d.name, f), "utf8")).started;
            if (st && (!t || st < t)) t = st;
        }
    }
    return t;
};
const now = new Date().toISOString();
const meta = {
    edition, run: runId, started: (resume && earliest()) || now, ...(resume ? { resumed: [{ at: now, vantage: null }] } : {}), chrome: browser.version(), node: process.version,
    lists: engines.versions, viewports, items: items.map((i) => i.id), retry, headless, parallel,
    vantage, references: existsSync(refFile) ? JSON.parse(readFileSync(refFile, "utf8")) : null,
};
if (resume) meta.resumed[0].vantage = vantage;

/** runItem with the watchdog: a hang becomes a "skipped" record and a fresh tab. */
async function runItemGuarded(args, swapPage) {
    let timer;
    const watchdog = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ITEM_WATCHDOG_MS); });
    const rec = await Promise.race([
        runItem(args).catch((e) => ({ item: args.item.id, kind: args.item.kind, viewport: args.viewport, outcome: "failure", failure: `harness error: ${e.message.slice(0, 160)}` })),
        watchdog,
    ]);
    clearTimeout(timer);
    if (rec) return rec;
    await swapPage();
    return { item: args.item.id, kind: args.item.kind, viewport: args.viewport, started: new Date(Date.now() - ITEM_WATCHDOG_MS).toISOString(), outcome: "skipped", failure: `harness watchdog: the item didn't finish in ${ITEM_WATCHDOG_MS / 60_000} minutes (a harness hang; not counted)`, harnessTimeout: true };
}

async function testTool(tool) {
    const toolSite = siteOf(tool.url);
    for (const viewport of viewports) {
        const trnd = seeded(`${edition}/${runId}/${tool.domain}/${viewport}`);
        const context = await newContext(browser, { mobile: viewport === "mobile" });
        const localDir = join(localBase, tool.domain);
        const outDir = join(outBase, tool.domain);
        mkdirSync(outDir, { recursive: true });
        if (resume && existsSync(join(outDir, `behaviour-${viewport}.json`))) { await context.close(); console.log(`${tool.domain} ${viewport}: kept (finished before the resume)`); continue; }
        if (resume) for (const f of readdirSync(outDir).filter((x) => x.endsWith(`-${viewport}.json`))) rmSync(join(outDir, f)); // an unfinished block is redone whole
        const log = await observe(context, { toolSite, engines, evidenceDir: join(localDir, "newtabs") });
        let page = await context.newPage();
        // A fresh tab for this tool after a harness hang; the observer treats it as the main tab, not a pop-up.
        const swapPage = async () => {
            const old = page;
            log.expectMainPage();
            page = await context.newPage();
            await old.close().catch(() => {});
        };

        // First visit: third-party cookies set before any click (SPEC.md §6.E).
        log.expectNavigation(true);
        await page.goto(tool.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
        log.expectNavigation(false);
        await sleep(4000);
        const cookiesBefore = await thirdPartyCookies(context, toolSite).catch(() => []);
        await page.screenshot({ path: join(localDir, `home-${viewport}.png`) }).catch(() => {});

        const order = shuffle(items, trnd);
        const failed = [];
        let measured = false;
        for (const item of order) {
            const { ref, refMedia } = loadRef(item);
            const measureMobile = viewport === "mobile" && !measured && item.kind === "video";
            let rec = await runItemGuarded({ context, page, log, adapter: tool, item, ref, refMedia, dir: localDir, viewport, measureMobile }, swapPage);
            if (measureMobile && rec.mobile) measured = true;
            rec.failedAt = rec.outcome === "failure" ? Date.now() : undefined;
            if (rec.outcome === "failure" && retry) failed.push({ item, rec });
            writeFileSync(join(outDir, `${item.id}-${viewport}.json`), JSON.stringify({ ...rec, lineMbps: vantage.bandwidth?.mbps ?? null }, null, 2));
            console.log(`${tool.domain} ${viewport} ${item.id}: ${rec.outcome}${rec.failure ? ` (${rec.failure})` : ""}${rec.timings_ms?.to_file ? ` ${(rec.timings_ms.to_file / 1000).toFixed(1)}s` : ""}`);
            await sleep(2000 + trnd() * 3000);
        }
        // One retry per failed item, 10 minutes after its failure (SPEC.md §5.3).
        for (const { item, rec: first } of failed) {
            const wait = first.failedAt + 10 * 60_000 - Date.now();
            if (wait > 0) await sleep(wait);
            const { ref, refMedia } = loadRef(item);
            const rec = await runItemGuarded({ context, page, log, adapter: tool, item, ref, refMedia, dir: localDir, viewport }, swapPage);
            rec.retried = true;
            rec.firstFailure = first.failure;
            writeFileSync(join(outDir, `${item.id}-${viewport}.json`), JSON.stringify({ ...rec, lineMbps: vantage.bandwidth?.mbps ?? null }, null, 2));
            console.log(`${tool.domain} ${viewport} ${item.id} (retry): ${rec.outcome}${rec.failure ? ` (${rec.failure})` : ""}`);
        }
        writeFileSync(join(outDir, `behaviour-${viewport}.json`), JSON.stringify({ ...snapshot(log), cookiesBeforeInteraction: cookiesBefore }, null, 2));
        await context.close();
    }
}

mkdirSync(outBase, { recursive: true });
writeFileSync(join(outBase, "run.json"), JSON.stringify(meta, null, 2)); // rewritten when the run finishes
// A small pool: `parallel` tools at a time, in the run's random order.
const queue = shuffle(tools, rnd);
await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length) await testTool(queue.shift());
}));
meta.finished = new Date().toISOString();
writeFileSync(join(outBase, "run.json"), JSON.stringify(meta, null, 2));
await browser.close();
