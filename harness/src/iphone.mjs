// iPhone check (SPEC.md §5.1, §6.F): one video per tool in iOS Safari on a
// booted iOS Simulator, driven with real taps by XCUITest (ios/), including
// Safari's own download prompt. Then checks the file landed on the device.
//
//   node src/iphone.mjs --edition 2026q4 [--tools a,b] [--item V1] [--udid <simulator>]
//
// Needs Xcode (free) with an iOS simulator runtime, and xcodegen.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadAdapter, TOOLS } from "./tools.mjs";
import { verifyVideo } from "./verify.mjs";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const REPO = join(ROOT, "..");
const IOS = join(ROOT, "ios");
const BUILD = join(ROOT, ".cache", "ios-build");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };

async function bootedSimulator() {
    const { stdout } = await run("xcrun", ["simctl", "list", "devices", "booted", "-j"]);
    const devices = Object.values(JSON.parse(stdout).devices).flat().filter((d) => d.state === "Booted" && /iPhone/.test(d.name));
    if (!devices.length) throw new Error("no booted iPhone simulator (boot one in Xcode or with `xcrun simctl boot`)");
    return devices[0];
}

async function ensureBuilt(udid) {
    const xctestrun = () => (existsSync(join(BUILD, "Build", "Products")) ? readdirSync(join(BUILD, "Build", "Products")).find((f) => f.endsWith(".xctestrun")) : null);
    const sources = ["project.yml", "SafariTests/SafariDownloadTests.swift", "Host/HostApp.swift"].map((f) => statSync(join(IOS, f)).mtimeMs);
    const built = xctestrun() ? statSync(join(BUILD, "Build", "Products", xctestrun())).mtimeMs : 0;
    if (built < Math.max(...sources)) {
        await run("xcodegen", ["generate", "--quiet"], { cwd: IOS });
        await run("xcodebuild", ["build-for-testing", "-project", join(IOS, "TDBiPhone.xcodeproj"), "-scheme", "TDBSafariTests", "-destination", `id=${udid},arch=arm64`, "-derivedDataPath", BUILD, "-quiet"], { maxBuffer: 64 << 20, timeout: 900_000 });
    }
    return join(BUILD, "Build", "Products", xctestrun());
}

/** Files Safari saved on the simulator since `since` (ms). */
function safariDownloads(udid, since) {
    const base = join(process.env.HOME, "Library", "Developer", "CoreSimulator", "Devices", udid, "data", "Containers", "Data", "Application");
    const found = [];
    const walk = (dir, depth) => {
        let entries = [];
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isDirectory() && depth < 6) walk(p, depth + 1);
            else if (e.isFile() && p.includes("/Library/Safari/Downloads/")) {
                const st = statSync(p);
                if (st.mtimeMs >= since && st.size > 10_000) found.push({ path: p, size: st.size });
            }
        }
    };
    walk(base, 0);
    return found.sort((a, b) => b.size - a.size);
}

async function main() {
    const edition = arg("edition", "dev");
    const only = arg("tools", null)?.split(",");
    const itemId = arg("item", "V1");
    const sim = arg("udid", null) ? { udid: arg("udid"), name: arg("udid") } : await bootedSimulator();
    const xctestrun = await ensureBuilt(sim.udid);
    const samples = JSON.parse(readFileSync(join(REPO, "samples", "core.json"), "utf8")).items;
    const item = samples.find((i) => i.id === itemId);
    if (!item) throw new Error(`sample ${itemId} not found in samples/core.json`);
    const refFile = join(REPO, "samples", "reference", `${item.id}.json`);
    const ref = existsSync(refFile) ? JSON.parse(readFileSync(refFile, "utf8")) : null;
    const outFile = join(REPO, "results", edition, "iphone.json");
    mkdirSync(dirname(outFile), { recursive: true });
    const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};

    for (const tool of await Promise.all(TOOLS.filter((t) => !only || only.includes(t.domain)).map(loadAdapter))) {
        await run("xcrun", ["simctl", "terminate", sim.udid, "com.apple.mobilesafari"]).catch(() => {});
        const since = Date.now() - 1000;
        const env = {
            ...process.env,
            TEST_RUNNER_TDB_TOOL_URL: tool.url,
            TEST_RUNNER_TDB_TIKTOK_URL: item.url,
            TEST_RUNNER_TDB_LABELS: tool.iphoneLabels ?? "no watermark|without watermark|HD|Download",
            TEST_RUNNER_TDB_SUBMIT: tool.iphoneSubmit ?? "Download|Submit|Start|Search|Get video|Go",
        };
        let out = "";
        try {
            const r = await run("xcodebuild", ["test-without-building", "-xctestrun", xctestrun, "-destination", `id=${sim.udid},arch=arm64`, "-only-testing:TDBSafariTests/SafariDownloadTests/testDownloadInSafari"], { env, maxBuffer: 64 << 20, timeout: 300_000 });
            out = r.stdout;
        } catch (e) {
            out = String(e.stdout ?? "") + String(e.stderr ?? "");
        }
        const kv = Object.fromEntries([...out.matchAll(/TDB_RESULT: (\w+)=(.*)/g)].map((m) => [m[1], m[2].trim()]));
        const files = safariDownloads(sim.udid, since);
        let file = null, saved = false, reason = kv.reason ?? null;
        if (files.length) {
            const v = await verifyVideo(files[0].path, ref, kv.control ?? "");
            file = { bytes: files[0].size, width: v.probe?.video?.width ?? null, height: v.probe?.video?.height ?? null, duration: v.probe?.duration ?? null };
            saved = v.ok;
            if (!v.ok) reason = `file saved but: ${v.reasons.join("; ")}`;
            for (const f of files) rmSync(f.path, { force: true });
        } else if (!reason) {
            reason = kv.prompt === "accepted" ? "accepted the download prompt but no file arrived" : "no download prompt and no file";
        }
        results[tool.domain] = { saved, reason, control: kv.control ?? null, prompt: kv.prompt ?? null, file, item: item.id, device: `${sim.name} (iOS Simulator)`, at: new Date().toISOString() };
        console.log(`${tool.domain.padEnd(18)} ${saved ? "saved" : "NOT saved"}${reason ? ` (${reason})` : ""}`);
        writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n");
    }
}

await main();
