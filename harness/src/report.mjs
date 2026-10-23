// Turn an edition's records into scores (SPEC.md §7) and the live site's data.
//
//   node src/report.mjs --edition 2026q4 [--publish]
//
// Reads  results/<edition>/runs/<run>/<tool>/*.json    (harness records)
//        results/<edition>/review.json                  (what a person confirmed)
//        results/<edition>/pagespeed/<tool>.json        (accessibility, Core Web Vitals)
//        results/<edition>/safety.json                  (Safe Browsing / VirusTotal)
//        results/<edition>/iphone.json                  (iOS Safari check)
//        results/monitor/uptime.json                    (daily monitor)
// Writes results/<edition>/scores.json, scores.csv, review-todo.json and, with
// --publish, results/latest.json for the live site.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { markNotOffered, median, rank, scoreTool } from "./scoring.mjs";
import { TOOLS } from "./tools.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const readJson = (f, d = null) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);

export function collect(editionDir) {
    const runsDir = join(editionDir, "runs");
    const byTool = {};
    if (!existsSync(runsDir)) return byTool;
    for (const run of readdirSync(runsDir)) {
        const runDir = join(runsDir, run);
        if (!existsSync(join(runDir))) continue;
        for (const tool of readdirSync(runDir).filter((d) => !d.endsWith(".json"))) {
            const t = (byTool[tool] ??= { desktop: { records: [], behaviour: [] }, mobile: { records: [], behaviour: [] } });
            for (const f of readdirSync(join(runDir, tool))) {
                const data = JSON.parse(readFileSync(join(runDir, tool, f), "utf8"));
                const b = f.match(/^behaviour-(desktop|mobile)\.json$/);
                if (b) t[b[1]].behaviour.push({ run, ...data });
                else if (data.viewport && t[data.viewport]) t[data.viewport].records.push({ run, ...data });
            }
        }
    }
    return byTool;
}

/**
 * Publish the evidence behind failures and penalties (SPEC.md §8): screenshots
 * of failed / blocked / ad-wall items and of tabs the site opened, copied from
 * runs-local/ to results/<edition>/evidence/<tool>/. Returns how many.
 */
export function publishEvidence(byTool, editionDir) {
    let n = 0;
    for (const [tool, t] of Object.entries(byTool)) {
        const dest = join(editionDir, "evidence", tool);
        const copy = (src) => {
            if (!src || !existsSync(src)) return null;
            mkdirSync(dest, { recursive: true });
            const to = join(dest, basename(src));
            if (!existsSync(to)) { copyFileSync(src, to); n++; }
            return relative(editionDir, to);
        };
        for (const v of ["desktop", "mobile"]) {
            for (const r of t[v].records) if (r.outcome !== "success" || r.kind === "negative") r.publishedEvidence = (r.evidence ?? []).map(copy).filter(Boolean);
            for (const b of t[v].behaviour) for (const p of b.newPages ?? []) p.publishedEvidence = copy(p.evidence);
        }
    }
    return n;
}

/** Behaviour across runs → the inputs of ads() for one viewport. */
export function adsInputs(v, review = {}) {
    const success = v.records.filter((r) => r.outcome === "success" && r.kind !== "negative" && Number.isFinite(r.clicks));
    return {
        // A tab showing the file itself is the delivery, not a pop-up (SPEC.md §6.D).
        popups: v.behaviour.reduce((s, b) => s + (b.newPages ?? []).filter((p) => !p.media).length, 0),
        // Navigations to another web site; records made before the observer ignored Chrome's error
        // page (chrome-error://, a page that failed to load) still list it, so it is left out here too.
        offsiteRedirects: v.behaviour.reduce((s, b) => s + (b.offsiteNavigations ?? []).filter((n) => /^https?:/.test(n.url)).length, 0),
        notificationPrompt: v.behaviour.some((b) => (b.permissions ?? []).some((p) => /notification|push/.test(p.kind))),
        adWall: v.records.some((r) => r.outcome === "ad-wall"),
        adGatedOption: v.records.some((r) => (r.adGatedOptions?.length ?? 0) > 0),
        extraClicks: success.length ? Math.max(0, Math.round(median(success.map((r) => r.clicks - 2)))) : 0,
        betterAdsViolations: review.betterAdsViolations ?? [],
        deceptiveAd: !!review.deceptiveAd,
        forcedWait: !!review.forcedWait,
    };
}

export function privacyInputs(v, review = {}) {
    const trackers = new Set(v.behaviour.flatMap((b) => b.trackerDomains ?? []));
    return {
        trackerDomains: trackers.size,
        cookiesBeforeInteraction: Math.max(0, ...v.behaviour.map((b) => b.cookiesBeforeInteraction?.length ?? 0)),
        installPush: !!review.installPush,
        httpsProblem: !!review.httpsProblem,
    };
}

function main() {
    const edition = arg("edition", "dev");
    const dir = join(REPO, "results", edition);
    const byTool = collect(dir);
    const evidence = publishEvidence(byTool, dir);
    const review = readJson(join(dir, "review.json"), {});
    const safety = readJson(join(dir, "safety.json"), {});
    const iphone = readJson(join(dir, "iphone.json"), {});
    // Uptime of the edition's quarter from the daily monitor (edition ids match: 2026q4).
    const uptime = readJson(join(REPO, "results", "monitor", "uptime.json"), {})?.[edition] ?? {};
    const todo = [];
    const tools = [];
    for (const tool of TOOLS) {
        const data = byTool[tool.domain];
        const r = review[tool.domain] ?? {};
        const psi = readJson(join(dir, "pagespeed", `${tool.domain}.json`), null);
        if (!data) { tools.push({ name: tool.name, domain: tool.domain, operator: !!tool.operator, unsafe: !!safety[tool.domain]?.unsafe, result: { overall: null, categories: {} }, note: "not tested" }); continue; }
        // Watermark flags and confirmed ones (a person decides — SPEC.md §6.B).
        for (const v of ["desktop", "mobile"]) {
            for (const rec of data[v].records) {
                if (rec.file?.watermark?.flagged) {
                    const confirmed = (r.watermarkConfirmed ?? []).includes(`${rec.run}/${rec.item}/${v}`);
                    rec.file.watermarkConfirmed = confirmed;
                    if (!confirmed && !(r.watermarkRejected ?? []).includes(`${rec.run}/${rec.item}/${v}`)) todo.push({ tool: tool.domain, check: "watermark", key: `${rec.run}/${rec.item}/${v}` });
                }
            }
            if (r.popupsConfirmed === undefined && data[v].behaviour.some((b) => b.newPages?.some((p) => !p.media))) todo.push({ tool: tool.domain, check: "review new tabs (pop-ups) evidence (review.json popupsConfirmed)", viewport: v });
        }
        if (!r.adsReviewed) todo.push({ tool: tool.domain, check: "review ad screenshots: Better Ads violations, deceptive ads, forced waits (review.json adsReviewed)" });
        if (iphone[tool.domain] && !iphone[tool.domain].saved && r.iphoneConfirmed === undefined) {
            todo.push({ tool: tool.domain, check: "iPhone check failed: confirm from the screenshot (review.json iphoneConfirmed: true) or reject (false)", reason: iphone[tool.domain].reason, evidence: iphone[tool.domain].evidence ?? iphone[tool.domain].screenshot });
        }
        const notOffered = {};
        for (const v of ["desktop", "mobile"]) notOffered[v] = markNotOffered(data[v].records);
        const mobileRec = data.mobile.records.find((x) => x.mobile);
        const blockedShare = (v) => { const rs = data[v].records; return rs.length ? rs.filter((x) => x.outcome === "blocked").length / rs.length : 0; };
        const input = {
            desktop: { records: data.desktop.records, ads: data.desktop.behaviour.length ? adsInputs(data.desktop, r.desktop ?? r) : null, privacy: data.desktop.behaviour.length ? privacyInputs(data.desktop, r) : null },
            mobile: {
                records: data.mobile.records,
                ads: data.mobile.behaviour.length ? adsInputs(data.mobile, r.mobile ?? r) : null,
                privacy: data.mobile.behaviour.length ? privacyInputs(data.mobile, r) : null,
                mobile: data.mobile.records.length ? {
                    ...(mobileRec?.mobile ?? {}),
                    accessibility: psi?.accessibility ?? null,
                    goodVitals: psi?.goodVitals ?? null,
                    loginRequired: !!r.loginRequired, captcha: !!r.captcha, limitOrPaywall: !!r.limitOrPaywall,
                    // A failed iPhone check counts only once a person confirmed it (SPEC.md §6.F).
                    iphoneSaveFails: !iphone[tool.domain] ? null : iphone[tool.domain].saved ? false : (r.iphoneConfirmed ? true : null),
                } : null,
            },
            uptime: uptime[tool.domain] ?? null,
        };
        const result = scoreTool(input);
        const notMeasurable = blockedShare("desktop") > 0.5 && blockedShare("mobile") > 0.5;
        // Down during testing: not one download worked in any run (every run an outage, SPEC.md §5.3).
        // A score made only of its ads, privacy and phone checks would mislead, so none is shown.
        const positives = [...data.desktop.records, ...data.mobile.records].filter((x) => x.kind !== "negative" && !["blocked", "skipped", "ad-wall"].includes(x.outcome));
        const down = !notMeasurable && positives.length > 0 && !positives.some((x) => x.outcome === "success");
        const unscored = notMeasurable || down;
        tools.push({
            name: tool.name, domain: tool.domain, operator: !!tool.operator,
            unsafe: !!safety[tool.domain]?.unsafe,
            // Not measurable or down: no scores shown; what little was measured is kept for reference.
            result: unscored ? { overall: null, categories: {} } : result,
            ...(unscored ? { partial: result.categories } : {}),
            note: notMeasurable ? "blocked by its bot protection in most tests — not measurable this edition"
                : down ? "down during testing: no download worked in any run (an outage in every run)" : null,
            notOffered: [...new Set([...notOffered.desktop, ...notOffered.mobile])],
        });
    }
    const ranked = rank(tools);
    const out = { edition, generated: new Date().toISOString(), tools: ranked };
    writeFileSync(join(dir, "scores.json"), JSON.stringify(out, null, 2) + "\n");
    const cats = ["reliability", "ads", "quality", "speed", "privacy", "mobile"];
    const fmt = (x) => (x === null || x === undefined ? "" : Math.round(x));
    writeFileSync(join(dir, "scores.csv"), ["rank,tool,domain,overall," + cats.join(","), ...ranked.map((t) => [t.rank ?? "", t.name, t.domain, fmt(t.result.overall), ...cats.map((c) => fmt(t.result.categories[c]?.score))].join(","))].join("\n") + "\n");
    writeFileSync(join(dir, "review-todo.json"), JSON.stringify(todo, null, 2) + "\n");
    if (process.argv.includes("--publish")) writeFileSync(join(REPO, "results", "latest.json"), JSON.stringify(out, null, 2) + "\n");
    for (const t of ranked) console.log(`${String(t.rank ?? "-").padStart(2)} ${t.name.padEnd(14)} ${String(t.result.overall ?? "–").padStart(3)}${t.note ? `  (${t.note})` : ""}`);
    console.log(`${evidence} evidence screenshot(s) published under results/${edition}/evidence/`);
    console.log(`${todo.length} item(s) for a person to review → results/${edition}/review-todo.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
