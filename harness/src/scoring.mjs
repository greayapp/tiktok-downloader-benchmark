// Scoring (SPEC.md §7). Pure functions over result records, so every formula
// is unit-tested (test/scoring.test.mjs). Scores are 0–100; null = not measured.

export const WEIGHTS = { reliability: 30, ads: 20, quality: 15, speed: 15, privacy: 10, mobile: 10 };

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
export const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Weighted average over the parts that were measured (weights redistributed, SPEC.md §7 "Missing data"). */
function weighted(parts) {
    const present = parts.filter(([v]) => v !== null && v !== undefined && Number.isFinite(v));
    const total = present.reduce((s, [, w]) => s + w, 0);
    return total ? present.reduce((s, [v, w]) => s + v * w, 0) / total : null;
}

const POSITIVE = new Set(["video", "mp3", "photos", "variant"]);
/** What an item asks for: a variant (L1–L3) asks for what its original does. Records carry it as `task`. */
export const taskOf = (r) => r.task ?? (r.kind === "variant" ? (/^(V|L1|L2)/.test(String(r.item)) ? "video" : "photos") : r.kind);

/** A. Reliability = 0.6·A1 + 0.1·A2 + 0.3·A3. Blocked items are excluded from A1. */
export function reliability(records, uptime = null) {
    // Blocked (bot protection) and ad-wall items are left out: a visitor gets
    // through those; the ad wall is penalised under Ads instead.
    const positive = records.filter((r) => POSITIVE.has(r.kind) && !["blocked", "skipped", "ad-wall", "not-offered"].includes(r.outcome));
    const a1 = positive.length ? (100 * positive.filter((r) => r.outcome === "success").length) / positive.length : null;
    const grades = records.filter((r) => r.kind === "negative" && r.negative).map((r) => ({ clear: 100, generic: 50, bad: 0 })[r.negative.grade] ?? 0);
    const a2 = mean(grades);
    const a3 = uptime && uptime.checks > 0 ? (100 * uptime.successes) / uptime.checks : null;
    return { a1, a2, a3, score: weighted([[a1, 0.6], [a2, 0.1], [a3, 0.3]]) };
}

/**
 * A task the tool never offers (every one of its items ended with a result
 * that had no option for it) is a missing feature, not a failure: those items
 * become "not-offered" and leave A1 (SPEC.md §6.A1). Returns the tasks.
 */
export function markNotOffered(records) {
    const missing = [];
    for (const t of ["video", "mp3", "photos"]) {
        const rs = records.filter((r) => taskOf(r) === t && !["blocked", "skipped", "ad-wall"].includes(r.outcome));
        if (rs.length && rs.every((r) => r.outcome === "failure" && r.notOffered)) {
            for (const r of rs) r.outcome = "not-offered";
            missing.push(t);
        }
    }
    return missing;
}

/** B. Quality and honesty, over successful items. */
export function quality(records) {
    const scores = [];
    // Downloads only: a should-fail item that "succeeds" (graded under A2) delivered nothing to rate.
    for (const r of records.filter((x) => x.outcome === "success" && POSITIVE.has(x.kind))) {
        const dishonest = (r.file?.labelDishonesty?.length ?? 0) + (r.file?.watermarkConfirmed ? 1 : 0);
        const task = taskOf(r);
        if (task === "video") {
            const ratio = r.file?.resolutionRatio ?? 1;
            scores.push(clamp(100 * ratio - 50 * dishonest));
        } else if (task === "mp3") {
            scores.push(clamp(100 - 50 * dishonest));
        } else if (task === "photos") {
            if (r.file?.downscaled > 0) scores.push(0);
            else scores.push(clamp((r.file?.heicOnly ? 75 : 100) - 50 * dishonest));
        }
    }
    return { score: mean(scores), items: scores.length };
}

/**
 * C. Speed, over successful video items (SPEC.md §6.C):
 * - time to download: median from submitting the link to the file starting to arrive;
 *   4 s → 100, 30 s → 0, linear (70%);
 * - transfer rate: median over files of 5 MB or more, bytes ÷ (finished − started);
 *   ≥ 20 Mbit/s → 100, ≤ 2 Mbit/s → 0, linear (30%). The test line's bandwidth is recorded with
 *   each record (`lineMbps`) for reference.
 * Time to the finished file is reported, not scored: it depends on the file's size and the line.
 */
export function speed(records) {
    const ok = records.filter((r) => POSITIVE.has(r.kind) && taskOf(r) === "video" && r.outcome === "success");
    const starts = ok.map((r) => r.timings_ms?.to_download ?? r.timings_ms?.to_file).filter(Number.isFinite).map((ms) => ms / 1000);
    const files = ok.filter((r) => Number.isFinite(r.timings_ms?.to_file) && Number.isFinite(r.timings_ms?.to_download)).map((r) => r.timings_ms.to_file / 1000);
    const rates = ok.filter((r) => r.bytes >= 5e6 && r.timings_ms?.to_file > r.timings_ms?.to_download)
        .map((r) => (r.bytes * 8) / 1e6 / ((r.timings_ms.to_file - r.timings_ms.to_download) / 1000));
    const m = median(starts);
    const sorted = [...starts].sort((a, b) => a - b);
    const p90 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)] : null;
    const rate = median(rates);
    const startScore = m === null ? null : clamp(100 * (30 - m) / (30 - 4));
    const rateScore = rate === null ? null : clamp(100 * (rate - 2) / (20 - 2));
    const score = startScore === null ? null : rateScore === null ? startScore : 0.7 * startScore + 0.3 * rateScore;
    return { medianS: m, p90S: p90, medianFileS: median(files), medianMbps: rate, startScore, rateScore, score };
}

/**
 * D. Ads and intrusiveness for one viewport. `b` = behaviour found for the tool
 * across the edition (each type counted once): { popups, offsiteRedirects,
 * betterAdsViolations: [types], notificationPrompt, deceptiveAd, forcedWait,
 * extraClicks (typical per download) }.
 */
export function ads(b) {
    if (!b) return { score: null, penalties: [] };
    const penalties = [];
    if (b.popups > 0) penalties.push(["pop-up or new tab", 30]);
    if (b.offsiteRedirects > 0) penalties.push(["redirect", 40]);
    if (b.adWall) penalties.push(["ad wall (watch an ad to continue)", 20]);
    else if (b.adGatedOption) penalties.push(["an option (e.g. HD) locked behind an ad", 10]);
    for (const v of new Set(b.betterAdsViolations ?? [])) penalties.push([`Better Ads: ${v}`, 20]);
    if (b.notificationPrompt) penalties.push(["notification prompt", 15]);
    if (b.deceptiveAd) penalties.push(["deceptive ad", 20]);
    if (b.forcedWait) penalties.push(["forced wait", 10]);
    if (b.extraClicks > 0) penalties.push([`${b.extraClicks} extra click(s)`, Math.min(20, 5 * b.extraClicks)]);
    return { score: clamp(100 - penalties.reduce((s, [, p]) => s + p, 0)), penalties };
}

/** E. Privacy and safety for one viewport. Unsafe tools are not ranked (handled by rank()). */
export function privacy(p) {
    if (!p) return { score: null, penalties: [] };
    const penalties = [];
    if (p.installPush) penalties.push(["install push", 30]);
    if (p.trackerDomains > 0) penalties.push([`${p.trackerDomains} tracker domain(s)`, Math.min(40, 5 * p.trackerDomains)]);
    if (p.cookiesBeforeInteraction > 0) penalties.push(["third-party cookies before any click", 10]);
    if (p.httpsProblem) penalties.push(["HTTPS problem", 50]);
    return { score: clamp(100 - penalties.reduce((s, [, x]) => s + x, 0)), penalties };
}

/**
 * F. Mobile experience, accessibility and friction (mobile viewport): the
 * average of accessibility, mobile usability, performance and friction.
 */
export function mobile(m) {
    if (!m) return { score: null, parts: {} };
    const usabilityPenalty =
        (m.horizontalScroll ? 25 : 0) +
        (m.inputFontPx !== null && m.inputFontPx !== undefined && m.inputFontPx < 16 ? 15 : 0) +
        (m.smallestTargetPx !== null && m.smallestTargetPx !== undefined ? (m.smallestTargetPx < 24 ? 20 : m.smallestTargetPx < 44 ? 10 : 0) : 0) +
        (m.adBetweenInputAndDownload ? 25 : 0);
    const usability = clamp(100 - usabilityPenalty);
    const frictionPenalty = (m.loginRequired ? 50 : 0) + (m.captcha ? 30 : 0) + (m.limitOrPaywall ? 30 : 0) + (m.iphoneSaveFails === true ? 20 : 0);
    const friction = clamp(100 - frictionPenalty);
    const parts = {
        accessibility: m.accessibility ?? null,
        usability,
        performance: m.goodVitals === null || m.goodVitals === undefined ? null : (100 * m.goodVitals) / 3,
        friction,
    };
    return { score: mean(Object.values(parts).filter((v) => v !== null)), parts };
}

/**
 * One tool's scores. `t` = { desktop: {records, ads, privacy}, mobile: {records,
 * ads, privacy, mobile}, uptime }. Categories A–E: 50/50 desktop/mobile; F: mobile.
 */
export function scoreTool(t) {
    const both = (fn, key) => {
        const d = fn(t.desktop?.[key] ?? null);
        const m = fn(t.mobile?.[key] ?? null);
        return { desktop: d, mobile: m, score: mean([d.score, m.score].filter((v) => v !== null && v !== undefined)) };
    };
    const rel = {
        desktop: reliability(t.desktop?.records ?? [], t.uptime),
        mobile: reliability(t.mobile?.records ?? [], t.uptime),
    };
    rel.score = mean([rel.desktop.score, rel.mobile.score].filter((v) => v !== null));
    const cats = {
        reliability: rel,
        quality: both((rs) => quality(rs ?? []), "records"),
        speed: both((rs) => speed(rs ?? []), "records"),
        ads: both(ads, "ads"),
        privacy: both(privacy, "privacy"),
        mobile: mobile(t.mobile?.mobile ?? null),
    };
    const overall = weighted(Object.entries(WEIGHTS).map(([k, w]) => [cats[k].score, w]));
    return { categories: cats, overall: overall === null ? null : Math.round(overall) };
}

/** Rank tools: unsafe ones are listed but not ranked; ties broken by Reliability (SPEC.md §7). */
export function rank(tools) {
    const ranked = tools
        .filter((t) => !t.unsafe && t.result.overall !== null)
        .sort((a, b) => b.result.overall - a.result.overall || (b.result.categories.reliability.score ?? 0) - (a.result.categories.reliability.score ?? 0));
    return ranked.map((t, i) => ({ ...t, rank: i + 1 })).concat(tools.filter((t) => t.unsafe || t.result.overall === null).map((t) => ({ ...t, rank: null })));
}
