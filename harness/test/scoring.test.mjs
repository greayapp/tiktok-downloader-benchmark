// Unit tests for SPEC.md §7 (run: npm test). Every formula is checked against
// hand-computed values, including missing data and floors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reliability, quality, speed, ads, privacy, mobile, scoreTool, rank, median, WEIGHTS } from "../src/scoring.mjs";

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

test("speed: median time to file, 4 s → 100, 30 s → 0, linear", () => {
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
