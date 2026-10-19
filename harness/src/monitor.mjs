// Daily uptime check (SPEC.md §5.4): one video and one photo post per tool,
// rotating through the core set, through the same flow as an edition (desktop).
//
//   node src/monitor.mjs [--push] [--tools a,b] [--force]
//
// Appends to results/monitor/<YYYY-MM>.jsonl and rebuilds results/monitor/uptime.json
// (per edition quarter, per tool: checks, successes, blocked). --push commits the monitor's
// files and pushes, which redeploys the live site. Runs once per day unless --force.
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
import { checkVantage } from "./vantage.mjs";

const git = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const MON = join(REPO, "results", "monitor");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };

const today = new Date().toISOString().slice(0, 10);
/** Edition a date belongs to: 2026-10-19 → 2026q4. */
export const editionOf = (date) => `${date.slice(0, 4)}q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/**
 * Per edition quarter, per tool: checks, successes, blocked, days (SPEC.md §6.A3). Left out of
 * `checks`: days the test machine was offline (no data), bot-protection challenges (`blocked`),
 * ad walls, and checks of a task the tool never offered that quarter (every one of them a failure
 * whose result offered other tasks only, §6.A1).
 */
export function rebuildUptime(dir = MON) {
    const lines = {};
    for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x))) {
        for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
            const r = JSON.parse(line);
            if (r.outcome === "skipped") continue;
            ((lines[editionOf(r.date)] ??= {})[r.tool] ??= []).push(r);
        }
    }
    const uptime = {};
    for (const [edition, tools] of Object.entries(lines)) {
        for (const [tool, rs] of Object.entries(tools)) {
            const taskOf = (r) => (String(r.item).startsWith("P") ? "photos" : "video");
            const notOffered = new Set(["video", "photos"].filter((t) => {
                const xs = rs.filter((r) => taskOf(r) === t && !["blocked", "ad-wall"].includes(r.outcome));
                return xs.length && xs.every((r) => r.outcome === "failure" && r.notOffered);
            }));
            const counted = rs.filter((r) => !["blocked", "ad-wall"].includes(r.outcome) && !notOffered.has(taskOf(r)));
            (uptime[edition] ??= {})[tool] = {
                checks: counted.length,
                successes: counted.filter((r) => r.outcome === "success").length,
                blocked: rs.filter((r) => r.outcome === "blocked").length,
                adWall: rs.filter((r) => r.outcome === "ad-wall").length,
                notOffered: [...notOffered],
                days: new Set(rs.map((r) => r.date)).size,
            };
        }
    }
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
    // Off the residential line (a VPN on), skip today's check without logging anything: the
    // LaunchAgent tries again next hour (SPEC.md §5.4).
    try {
        await checkVantage({ allowAny: process.argv.includes("--any-vantage"), measureBandwidth: false });
    } catch (e) {
        console.log(`${new Date().toISOString()} not run: ${e.message}`);
        return;
    }
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
            const line = { date: today, tool: tool.domain, item: item.id, outcome: rec.outcome, failure: rec.failure ?? undefined, notOffered: rec.notOffered || undefined, to_file_ms: rec.timings_ms?.to_file ?? undefined };
            appendFileSync(logFile, JSON.stringify(line) + "\n");
            console.log(`${tool.domain} ${item.id}: ${rec.outcome}${rec.failure ? ` (${rec.failure})` : ""}`);
        }
        await context.close();
    }
    await browser.close();
    const tools = Object.fromEntries(TOOLS.map((t) => [t.domain, { name: t.name, operator: !!t.operator }]));
    writeFileSync(join(MON, "uptime.json"), JSON.stringify({ updated: new Date().toISOString(), tools, ...rebuildUptime() }, null, 2) + "\n");
    if (process.argv.includes("--push")) {
        // Commit only the monitor's files, and push only when that commit is the one thing not yet on
        // GitHub — never someone's unpublished work that happens to be on the branch.
        await git("git", ["add", "results/monitor"], { cwd: REPO });
        await git("git", ["commit", "-m", `Monitor: ${today}`, "--", "results/monitor"], { cwd: REPO }).catch(() => {});
        await git("git", ["pull", "--rebase", "--autostash"], { cwd: REPO }).catch(() => {});
        const { stdout } = await git("git", ["log", "--format=%s", "@{u}..HEAD"], { cwd: REPO });
        const ahead = stdout.split("\n").filter(Boolean);
        if (ahead.some((m) => !m.startsWith("Monitor: "))) {
            console.log(`not pushed: the branch has unpublished commits besides the monitor's (${ahead.length} ahead)`);
            process.exitCode = 3;
        } else if (ahead.length) {
            await git("git", ["push"], { cwd: REPO });
            console.log("pushed");
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
