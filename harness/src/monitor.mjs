// Daily uptime check (SPEC.md §5.4): one video and one photo post per tool,
// rotating through the core set, through the same flow as an edition (desktop).
//
//   node src/monitor.mjs [--push] [--tools a,b] [--force]
//
// Appends to results/monitor/<YYYY-MM>.jsonl and rebuilds results/monitor/uptime.json
// (per edition quarter, per tool: checks, successes, blocked). --push commits and
// pushes, which redeploys the live site. Runs once per day unless --force.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { launchBrowser, newContext } from "./browser.mjs";
import { runItem } from "./flow.mjs";
import { loadEngines } from "./lists.mjs";
import { observe, siteOf } from "./observe.mjs";
import { loadAdapter, TOOLS } from "./tools.mjs";

const git = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const MON = join(REPO, "results", "monitor");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };

const today = new Date().toISOString().slice(0, 10);
/** Edition a date belongs to: 2026-10-19 → 2026q4. */
export const editionOf = (date) => `${date.slice(0, 4)}q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

export function rebuildUptime(dir = MON) {
    const uptime = {};
    for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x))) {
        for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
            const r = JSON.parse(line);
            const e = (uptime[editionOf(r.date)] ??= {});
            const t = (e[r.tool] ??= { checks: 0, successes: 0, blocked: 0, days: new Set() });
            t.days.add(r.date);
            if (r.outcome === "blocked") t.blocked++;
            else {
                t.checks++;
                if (r.outcome === "success") t.successes++;
            }
        }
    }
    for (const e of Object.values(uptime)) for (const t of Object.values(e)) t.days = t.days.size;
    return uptime;
}

async function main() {
    mkdirSync(MON, { recursive: true });
    const logFile = join(MON, `${today.slice(0, 7)}.jsonl`);
    if (!process.argv.includes("--force") && existsSync(logFile) && readFileSync(logFile, "utf8").includes(`"date":"${today}"`)) {
        console.log(`already ran on ${today}`);
        return;
    }
    const core = JSON.parse(readFileSync(join(REPO, "samples", "core.json"), "utf8")).items;
    const videos = core.filter((i) => i.kind === "video");
    const photos = core.filter((i) => i.kind === "photos");
    const day = Math.floor(Date.parse(today) / 86_400_000);
    const picks = [videos[day % videos.length], photos[day % photos.length]].filter(Boolean);
    const only = arg("tools", null)?.split(",");
    const engines = await loadEngines();
    const browser = await launchBrowser();
    for (const tool of await Promise.all(TOOLS.filter((t) => !only || only.includes(t.domain)).map(loadAdapter))) {
        const context = await newContext(browser);
        const log = await observe(context, { toolSite: siteOf(tool.url), engines, evidenceDir: null });
        const page = await context.newPage();
        for (const item of picks) {
            const refFile = join(REPO, "samples", "reference", `${item.id}.json`);
            const ref = existsSync(refFile) ? JSON.parse(readFileSync(refFile, "utf8")) : null;
            const rec = await runItem({ context, page, log, adapter: tool, item, ref, refMedia: null, dir: join(HERE, "..", "runs-local", "monitor", today, tool.domain), viewport: "desktop" })
                .catch((e) => ({ outcome: "failure", failure: `harness error: ${e.message.slice(0, 120)}` }));
            const line = { date: today, tool: tool.domain, item: item.id, outcome: rec.outcome, failure: rec.failure ?? undefined, to_file_ms: rec.timings_ms?.to_file ?? undefined };
            appendFileSync(logFile, JSON.stringify(line) + "\n");
            console.log(`${tool.domain} ${item.id}: ${rec.outcome}${rec.failure ? ` (${rec.failure})` : ""}`);
        }
        await context.close();
    }
    await browser.close();
    writeFileSync(join(MON, "uptime.json"), JSON.stringify({ updated: new Date().toISOString(), ...rebuildUptime() }, null, 2) + "\n");
    if (process.argv.includes("--push")) {
        await git("git", ["add", "results/monitor"], { cwd: REPO });
        await git("git", ["commit", "-m", `Monitor: ${today}`], { cwd: REPO }).catch(() => {});
        await git("git", ["pull", "--rebase", "--autostash"], { cwd: REPO }).catch(() => {});
        await git("git", ["push"], { cwd: REPO });
        console.log("pushed");
    }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
