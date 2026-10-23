// Unit tests for SPEC.md §7 (run: npm test). Every formula is checked against
// hand-computed values, including missing data and floors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reliability, quality, speed, ads, privacy, mobile, scoreTool, rank, median, markNotOffered, WEIGHTS } from "../src/scoring.mjs";

const ok = (kind, extra = {}) => ({ kind, outcome: "success", ...extra });
const fail = (kind) => ({ kind, outcome: "failure" });

test("weights add up to 100", () => {
    assert.equal(Object.values(WEIGHTS).reduce((s, w) => s + w, 0), 100);
});

test("median", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([]), null);
});

test("reliability: A1 counts positives, excludes blocked; A2 grades; A3 uptime; 0.6/0.1/0.3", () => {
    const records = [ok("video"), ok("video"), fail("video"), ok("photos"), { kind: "video", outcome: "blocked" }, { kind: "video", outcome: "ad-wall" },
        { kind: "negative", outcome: "success", negative: { grade: "clear" } }, { kind: "negative", outcome: "success", negative: { grade: "bad" } }];
    const r = reliability(records, { checks: 10, successes: 9 });
    assert.equal(r.a1, 75); // 3 of 4 (blocked and ad-wall excluded)
    assert.equal(r.a2, 50); // (100 + 0) / 2
    assert.equal(r.a3, 90);
    assert.equal(r.score, 0.6 * 75 + 0.1 * 50 + 0.3 * 90);
});

test("reliability: no uptime data → A1 and A2 re-weighted proportionally", () => {
    const r = reliability([ok("video"), fail("video"), { kind: "negative", outcome: "success", negative: { grade: "generic" } }], null);
    assert.equal(r.a3, null);
    assert.ok(Math.abs(r.score - (0.6 * 50 + 0.1 * 50) / 0.7) < 1e-9);
});

test("not offered: a task never offered becomes a missing feature and leaves A1; a task offered once does not", () => {
    const rs = [ok("video"), ok("video"),
        { kind: "mp3", outcome: "failure", notOffered: true }, { kind: "mp3", outcome: "failure", notOffered: true },
        { kind: "photos", outcome: "failure", notOffered: true }, ok("photos")];
    assert.deepEqual(markNotOffered(rs), ["mp3"]);
    assert.equal(reliability(rs).a1, 75); // video 2/2, photos 1/2; mp3 left out
});

test("quality: resolution ratio, label dishonesty −50, HEIC −25, downscaled photos 0", () => {
    const q = quality([
        ok("video", { file: { resolutionRatio: 1, labelDishonesty: [] } }),
        ok("video", { file: { resolutionRatio: 0.5, labelDishonesty: [] } }),
        ok("video", { file: { resolutionRatio: 1, labelDishonesty: ["HD label but 540p"] } }),
        ok("video", { file: { resolutionRatio: 1, labelDishonesty: [], watermarkConfirmed: true } }),
        ok("mp3", { file: { labelDishonesty: ['"MP3" label but aac'] } }),
        ok("photos", { file: { heicOnly: true, downscaled: 0 } }),
        ok("photos", { file: { heicOnly: false, downscaled: 2 } }),
        fail("video"),
    ]);
    assert.equal(q.items, 7);
    assert.equal(q.score, (100 + 50 + 50 + 50 + 50 + 75 + 0) / 7);
});

test("quality and speed rate downloads only, not should-fail items graded under A2", () => {
    // The harness records a should-fail item as outcome "success" with its grade in `negative`.
    const negative = { item: "N1", kind: "negative", task: "video", outcome: "success", negative: { grade: "clear" } };
    assert.deepEqual(quality([negative, negative, negative]), { score: null, items: 0 });
    assert.equal(quality([negative, ok("video", { file: { resolutionRatio: 0.5, labelDishonesty: [] } })]).score, 50);
    assert.equal(speed([negative]).score, null);
});

test("speed: records without a download-start time fall back to the time to file", () => {
    const rec = (s) => ok("video", { timings_ms: { to_file: s * 1000 } });
    assert.equal(speed([rec(2), rec(3), rec(4)]).score, 100);
    assert.equal(speed([rec(30), rec(40)]).score, 0);
    assert.equal(speed([rec(17)]).score, 50);
    assert.equal(speed([]).score, null);
});

test("ads: showing ads costs nothing; each harm type once; extra clicks capped at −20; floor 0", () => {
    assert.equal(ads({ popups: 0, offsiteRedirects: 0, extraClicks: 0 }).score, 100);
    assert.equal(ads({ popups: 3, offsiteRedirects: 0, extraClicks: 0 }).score, 70);
    assert.equal(ads({ popups: 1, offsiteRedirects: 2, betterAdsViolations: ["sticky", "sticky", "prestitial"], notificationPrompt: true, extraClicks: 9 }).score, 0);
    assert.equal(ads({ extraClicks: 9 }).score, 80);
    assert.equal(ads({ deceptiveAd: true, forcedWait: true }).score, 70);
    assert.equal(ads({ adWall: true }).score, 80);
    assert.equal(ads({ adGatedOption: true }).score, 90);
    assert.equal(ads({ adWall: true, adGatedOption: true }).score, 80); // the wall already covers it
    assert.equal(ads(null).score, null);
});

test("privacy: trackers −5 each (max −40), cookies −10, install push −30, HTTPS −50", () => {
    assert.equal(privacy({ trackerDomains: 3, cookiesBeforeInteraction: 0 }).score, 85);
    assert.equal(privacy({ trackerDomains: 20, cookiesBeforeInteraction: 2 }).score, 50);
    assert.equal(privacy({ installPush: true, trackerDomains: 0, httpsProblem: true }).score, 20);
});

test("mobile: average of accessibility, usability, performance, friction", () => {
    const m = mobile({ accessibility: 90, horizontalScroll: false, inputFontPx: 14, smallestTargetPx: 30, adBetweenInputAndDownload: false, goodVitals: 2, loginRequired: false, captcha: false, limitOrPaywall: false, iphoneSaveFails: null });
    assert.equal(m.parts.usability, 75); // −15 font, −10 targets under 44
    assert.ok(Math.abs(m.parts.performance - 66.6667) < 0.001);
    assert.equal(m.parts.friction, 100);
    assert.ok(Math.abs(m.score - (90 + 75 + 200 / 3 + 100) / 4) < 1e-9);
    const missing = mobile({ accessibility: null, goodVitals: null, horizontalScroll: true });
    assert.equal(missing.score, (75 + 100) / 2); // only usability and friction measured
});

test("scoreTool: A–E averaged desktop/mobile, F mobile, overall weighted and rounded", () => {
    const perfect = { records: [ok("video", { timings_ms: { to_file: 3000 }, file: { resolutionRatio: 1, labelDishonesty: [] } })], ads: { popups: 0, offsiteRedirects: 0, extraClicks: 0 }, privacy: { trackerDomains: 0, cookiesBeforeInteraction: 0 } };
    const t = scoreTool({
        desktop: perfect,
        mobile: { ...perfect, ads: { popups: 1, offsiteRedirects: 0, extraClicks: 0 }, mobile: { accessibility: 100, goodVitals: 3, horizontalScroll: false, inputFontPx: 16, smallestTargetPx: 48 } },
        uptime: null,
    });
    assert.equal(t.categories.ads.score, 85); // (100 + 70) / 2
    assert.equal(t.categories.mobile.score, 100);
    assert.equal(t.overall, Math.round((30 * 100 + 20 * 85 + 15 * 100 + 15 * 100 + 10 * 100 + 10 * 100) / 100));
});

test("rank: unsafe tools are listed, not ranked; ties broken by reliability", () => {
    const mk = (name, overall, rel, unsafe = false) => ({ name, unsafe, result: { overall, categories: { reliability: { score: rel } } } });
    const r = rank([mk("a", 80, 70), mk("b", 80, 90), mk("c", 95, 50, true), mk("d", 60, 99)]);
    assert.deepEqual(r.map((t) => [t.name, t.rank]), [["b", 1], ["a", 2], ["d", 3], ["c", null]]);
});

test("variants are scored as the task they ask for (L1/L2 video, L3 photos)", async () => {
    const { taskOf } = await import("../src/scoring.mjs");
    assert.equal(taskOf({ kind: "variant", item: "L3", task: "photos" }), "photos");
    assert.equal(taskOf({ kind: "variant", item: "L1" }), "video");
    assert.equal(taskOf({ kind: "variant", item: "L3" }), "photos");
    // A photos variant has no resolution ratio and no video timing: it must not count as a video.
    const s = speed([{ kind: "variant", item: "L3", task: "photos", outcome: "success", timings_ms: { to_file: 30_000 } }, { kind: "video", outcome: "success", timings_ms: { to_file: 4_000 } }]);
    assert.equal(s.medianS, 4);
    // A tool without photo support: the photo variant leaves A1 along with the photo posts.
    const rs = [{ kind: "photos", item: "P1", outcome: "failure", notOffered: true }, { kind: "variant", item: "L3", task: "photos", outcome: "failure", notOffered: true }, { kind: "variant", item: "L1", task: "video", outcome: "success" }];
    assert.deepEqual(markNotOffered(rs), ["photos"]);
    assert.equal(rs[1].outcome, "not-offered");
});

test("uptime: offline days are no data; blocked, ad walls and never-offered tasks leave the checks", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { rebuildUptime } = await import("../src/monitor.mjs");
    const dir = mkdtempSync(join(tmpdir(), "tdb-uptime-"));
    const l = (date, tool, item, outcome, extra = {}) => JSON.stringify({ date, tool, item, outcome, ...extra });
    writeFileSync(join(dir, "2026-10.jsonl"), [
        l("2026-10-20", "a", "V1", "success"), l("2026-10-20", "a", "P1", "failure", { notOffered: true }),
        l("2026-10-21", "a", "V2", "failure"), l("2026-10-21", "a", "P2", "failure", { notOffered: true }),
        l("2026-10-22", "a", "V3", "skipped"), l("2026-10-22", "a", "P3", "skipped"),
        l("2026-10-20", "b", "V1", "blocked"), l("2026-10-20", "b", "P1", "ad-wall"),
        l("2026-10-21", "b", "V2", "success"), l("2026-10-21", "b", "P2", "failure"),
    ].join("\n") + "\n");
    const u = rebuildUptime(dir)["2026q4"];
    assert.deepEqual(u.a, { checks: 2, successes: 1, blocked: 0, adWall: 0, notOffered: ["photos"], days: 2 });
    assert.deepEqual(u.b, { checks: 2, successes: 1, blocked: 1, adWall: 1, notOffered: [], days: 2 });
});

test("speed: 70% time to download start (4 s → 100, 30 s → 0), 30% transfer rate on files ≥ 5 MB (2 → 0, 20 Mbit/s → 100)", () => {
    const v = (start, file, bytes) => ({ kind: "video", outcome: "success", bytes, timings_ms: { to_download: start * 1000, to_file: file * 1000 } });
    // Starts at 4 s (100). 10 MB in 8 s = 10 Mbit/s → (10 − 2) / 18 = 44.4.
    const s = speed([v(4, 12, 10e6), v(4, 12, 10e6), v(4, 4.1, 1e6)]);
    assert.equal(s.medianS, 4);
    assert.ok(Math.abs(s.medianMbps - 10) < 1e-9);
    assert.ok(Math.abs(s.score - (0.7 * 100 + 0.3 * (100 * 8 / 18))) < 1e-9);
    // A big original-quality file that takes long on the test line costs nothing in the start time.
    const big = speed([v(5.3, 120, 716e6)]);
    assert.equal(big.medianS, 5.3);
    assert.ok(big.medianMbps > 49 && big.medianMbps < 51);
    // Small files only: no rate, the start time alone.
    const small = speed([v(17, 18, 2e6)]);
    assert.equal(small.rateScore, null);
    assert.equal(small.score, 50);
});
