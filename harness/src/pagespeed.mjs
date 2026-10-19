// Accessibility and Core Web Vitals per tool home page (SPEC.md §6.F).
// Field data from Chrome UX Report when CRUX_API_KEY is set (a free Google
// API key); otherwise the median of 3 local Lighthouse mobile lab runs, with
// Total Blocking Time standing in for INP, labelled "lab".
//
//   node src/pagespeed.mjs --edition 2026q4 [--tools a,b]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { median } from "./scoring.mjs";
import { TOOLS } from "./tools.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const GOOD = { lcp: 2500, inp: 200, tbt: 200, cls: 0.1 };

async function crux(origin, key) {
    const res = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, formFactor: "PHONE", metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"] }),
        signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) return null; // not enough traffic for field data
    if (!res.ok) throw new Error(`CrUX HTTP ${res.status}`);
    const m = (await res.json()).record.metrics;
    const p75 = (k) => Number(m[k]?.percentiles?.p75);
    return { lcp: p75("largest_contentful_paint"), inp: p75("interaction_to_next_paint"), cls: p75("cumulative_layout_shift") };
}

async function lab(url, runs = 3) {
    const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-first-run"] });
    const results = [];
    try {
        for (let i = 0; i < runs; i++) {
            const r = await lighthouse(url, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["accessibility", "performance"], formFactor: "mobile" });
            const lhr = r?.lhr;
            if (!lhr || lhr.runtimeError) continue;
            results.push({
                accessibility: Math.round((lhr.categories.accessibility?.score ?? NaN) * 100),
                lcp: lhr.audits["largest-contentful-paint"]?.numericValue,
                tbt: lhr.audits["total-blocking-time"]?.numericValue,
                cls: lhr.audits["cumulative-layout-shift"]?.numericValue,
                version: lhr.lighthouseVersion,
                finalUrl: lhr.finalDisplayedUrl,
            });
        }
    } finally {
        await chrome.kill();
    }
    if (!results.length) return null;
    const med = (k) => median(results.map((x) => x[k]).filter(Number.isFinite));
    return { accessibility: med("accessibility"), lcp: med("lcp"), tbt: med("tbt"), cls: med("cls"), version: results[0].version, runs: results.length, finalUrl: results[0].finalUrl };
}

async function main() {
    const edition = arg("edition", "dev");
    const only = arg("tools", null)?.split(",");
    const key = process.env.CRUX_API_KEY;
    const outDir = join(REPO, "results", edition, "pagespeed");
    mkdirSync(outDir, { recursive: true });
    for (const tool of TOOLS.filter((t) => !only || only.includes(t.domain))) {
        try {
            const l = await lab(tool.url);
            const field = key ? await crux(new URL(tool.url).origin, key).catch(() => null) : null;
            const vit = field ?? (l ? { lcp: l.lcp, inp: l.tbt, cls: l.cls } : null);
            const goodVitals = vit ? [vit.lcp <= GOOD.lcp, vit.inp <= (field ? GOOD.inp : GOOD.tbt), vit.cls <= GOOD.cls].filter(Boolean).length : null;
            const out = {
                tool: tool.domain, measured: new Date().toISOString(),
                accessibility: l?.accessibility ?? null,
                vitals: vit, vitalsSource: field ? "crux-field" : l ? "lighthouse-lab (TBT stands in for INP)" : null,
                goodVitals, lighthouse: l ? { version: l.version, runs: l.runs, finalUrl: l.finalUrl } : null,
            };
            writeFileSync(join(outDir, `${tool.domain}.json`), JSON.stringify(out, null, 2) + "\n");
            console.log(`${tool.domain.padEnd(18)} a11y ${out.accessibility ?? "–"}  good vitals ${goodVitals ?? "–"}/3  (${out.vitalsSource ?? "not measured"})`);
        } catch (e) {
            console.log(`${tool.domain.padEnd(18)} FAILED ${e.message.slice(0, 120)}`);
        }
    }
}

await main();
