// One test item, driven the way a visitor would (SPEC.md §5.2):
// open the home page, paste the link, submit, wait for the result, choose the
// control that matches the task, wait for the file, then verify it.
import { mkdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { controlHandle, evaluateStable, findLinkInput, findSubmit, listControls, TASK_LABELS } from "./generic.mjs";
import { verifyAudio, verifyImages, verifyVideo, watermarkCheck } from "./verify.mjs";

// SPEC.md §5.2: the result within 60 s; the file must start downloading within 60 s of the click
// and may then take its time (a 15-minute safety cap: a big original-quality file on the test line
// says nothing about the tool); should-fail items get 30 s.
export const LIMITS = { resultMs: 60_000, startMs: 60_000, fileMs: 900_000, negativeMs: 30_000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A page call that gives up after `ms` with `fallback` (a frozen page must not stall a run). */
const within = (promise, fallback, ms = 20_000) => Promise.race([promise.catch(() => fallback), sleep(ms).then(() => fallback)]);
const key = (c) => `${c.text}|${c.href ?? ""}`;
const ERROR_TEXT = /invalid|not found|unavailable|error|private|deleted|removed|doesn'?t exist|does not exist|couldn'?t|could not|can ?not|can'?t|unable|failed|unsupported|not supported|not (a )?valid|incorrect|wrong|issue with|problem with|oops|sorry|try again|check (the|your) (link|url)|please (check|enter|paste|use)|enter a valid|no (video|media)/i;
const SPECIFIC_ERROR = /private|deleted|removed|doesn'?t exist|does not exist|not found|unavailable|unsupported|not supported|invalid (link|url)|enter a valid|only tiktok|tiktok link/i;

/**
 * Click (desktop) or tap (mobile) at the element's on-screen centre, like a
 * person. Whatever is on top there receives it — including ad layers over the
 * page, which is exactly what a visitor experiences. Returns false if the
 * element has no box (hidden).
 */
export async function clickLikeUser(page, handle, mobile) {
    if (!handle) return false;
    // To the middle of the screen, as a person scrolls — not the edge, where
    // sticky bars and anchor ads sit.
    await within(handle.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" })), null);
    await new Promise((r) => setTimeout(r, 300));
    const box = await handle.boundingBox().catch(() => null);
    if (!box || box.width < 1 || box.height < 1) return false;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (mobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    return true;
}

/**
 * Close what a visitor would close to get on: a Google vignette (full-screen ad
 * between pages) or a modal, using only its own close control ("Close", "×",
 * "Skip", "Dismiss"). Never clicks the ad itself. True if something was closed.
 */
export async function closeOverlays(page, mobile) {
    // Google vignette / interstitial: its dismiss button lives in the ad frame.
    for (const frame of page.frames()) {
        const url = frame.url();
        if (!/googlesyndication|doubleclick|googleads|google_vignette|aswift/i.test(url) && !/aswift|google_ads_iframe/i.test(frame.name())) continue;
        const btn = await frame.$('#dismiss-button, [aria-label="Close ad"], [aria-label="Close"], #close-button').catch(() => null);
        if (btn && (await btn.isVisible().catch(() => false))) {
            const box = await btn.boundingBox().catch(() => null);
            if (box) {
                if (mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
                else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                return true;
            }
        }
    }
    // A modal on the page with an explicit close control (looked for within 20 s: a frozen page
    // must not stall the run).
    const close = await Promise.race([sleep(20_000).then(() => null), page.evaluateHandle(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
        const label = (el) => (el.innerText || el.getAttribute("aria-label") || el.title || "").trim();
        // Inside layered content (a fixed or positioned, stacked ancestor) — a
        // modal or overlay, not the page's own layout.
        const layered = (el) => {
            for (let a = el; a && a !== document.body; a = a.parentElement) {
                const cs = getComputedStyle(a);
                if (cs.position === "fixed" || cs.position === "sticky") return true;
                if (cs.position === "absolute" && Number(cs.zIndex) > 0) return true;
                if (a.getAttribute("role") === "dialog" || /modal|popup|overlay|dialog/i.test(String(a.className))) return true;
            }
            return false;
        };
        return [...document.querySelectorAll("button, [role=button], a, span, div")]
            .filter((el) => vis(el) && /^(close|×|✕|✖|x|skip|skip ad|dismiss|no,? thanks|not now)$/i.test(label(el)))
            .find(layered) ?? null;
    }).catch(() => null)]);
    const el = close?.asElement();
    if (el) {
        const box = await el.boundingBox().catch(() => null);
        if (box) {
            if (mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            return true;
        }
    }
    return false;
}

/** An ad wall: the site requires watching an ad (or similar) to continue (SPEC.md §6.D). */
// Walls: Google's offerwall ("view a short ad"), and rewarded ads (watch a video ad to earn the
// download), which show inside ad frames ("you will lose your reward", "reward in 15 s").
const WALL_TEXT = /unlock more content|view a short ad|watch (a|an|the|this) (short )?(ad|video) to (continue|unlock|get|earn)|take action to continue accessing|lose your reward|reward granted|reward in \d+ ?s(ec(ond)?s?)?\b/i;
export async function adWall(page) {
    const text = await within(page.evaluate(() => document.body.innerText.slice(0, 20000)), "");
    if (WALL_TEXT.test(text)) return true;
    if (await within(page.evaluate(() => !!document.querySelector(".fc-dialog-container, .fc-monetization-dialog, [class*='offerwall']")), false)) return true;
    for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const t = await within(f.evaluate(() => (document.body?.innerText ?? "").slice(0, 5000)), "");
        if (WALL_TEXT.test(t)) { page._tdbWallText = (t.match(WALL_TEXT) ?? [""])[0]; return true; }
    }
    return false;
}

/** Is the test machine itself online? (A failure while it isn't is not the tool's.) */
export async function online() {
    try {
        const r = await fetch("https://www.google.com/generate_204", { signal: AbortSignal.timeout(6000) });
        return r.status === 204 || r.ok;
    } catch {
        return false;
    }
}

/** Is the tab showing a bot-protection challenge (never solved — SPEC.md §5.4)? */
async function challenged(page) {
    const title = await page.title().catch(() => "");
    if (/just a moment|attention required|verify you are human|security check/i.test(title)) return true;
    // Only challenges a person would have to deal with: a visible widget. The
    // invisible reCAPTCHA badge many sites carry is not a challenge.
    return evaluateStable(page, () => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 60 && r.height > 60 && getComputedStyle(el).visibility !== "hidden"; };
        const widgets = [...document.querySelectorAll('#challenge-form, iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha/api2/anchor"]:not([src*="size=invisible"]), iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/anchor"]:not([src*="size=invisible"])')];
        return widgets.some(visible);
    }).catch(() => false);
}

/** Wait up to `ms` for a challenge to clear by itself; true if it is still there. */
async function stillChallenged(page, ms = 15_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (!(await challenged(page))) return false;
        await sleep(1000);
    }
    return true;
}

/** Options that only work after watching an ad: skipped, never used (SPEC.md §6.D). */
const AD_GATED = /watch\s*(an\s*)?ad|unlock|ad\s*required/i;

function pickControl(adapter, task, fresh) {
    const patterns = adapter.controls?.[task] ?? TASK_LABELS[task];
    const exclude = adapter.excludeControls ?? /share|copy|facebook|twitter|whatsapp|telegram|app store|google play|extension|another|again|try again|new video/i;
    const usable = fresh.filter((c) => !exclude.test(c.text) && !AD_GATED.test(c.text));
    // A link's own path can tell its file type (…/video.mp4); never its query
    // string, which often repeats the TikTok link (…?url=…/photo/…).
    // A link to the tool's own pages (…/photo/download#) says nothing about a file unless its path
    // ends in a file extension; a link elsewhere (a CDN) may name its file type in its path.
    const toolHost = (() => { try { return new URL(adapter.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const path = (href) => {
        try {
            const u = new URL(href);
            if (!/^https?:$/.test(u.protocol)) return "";
            const own = toolHost && u.hostname.replace(/^www\./, "").endsWith(toolHost);
            return own && !/\.(jpe?g|png|webp|heic|mp4|mp3|m4a|zip)$/i.test(u.pathname) ? "" : u.pathname;
        } catch { return ""; }
    };
    for (const re of patterns) {
        const hit = usable.find((c) => re.test(c.text) || (c.href && re.test(path(c.href))));
        if (hit) return hit;
    }
    return null;
}

/**
 * Collects every file that arrives (downloads in this tab or tabs it opens, and tabs that show the
 * file itself) until stop(); waitFor(n, ms) resolves true once n have arrived.
 */
function collectFiles(context, page) {
    const got = [];
    const onDownload = (d) => got.push({ kind: "download", download: d });
    // A tab showing a file counts once per file it shows: some sites open every photo in the same
    // (named) tab, one after another.
    const shown = new Set();
    const checkTab = async (p) => {
        const ct = await Promise.race([p.evaluate(() => document.contentType).catch(() => ""), sleep(5_000).then(() => "")]);
        const url = p.url();
        if (/^(video|audio|image)\//.test(ct) && !shown.has(url)) { shown.add(url); got.push({ kind: "media-tab", url, page: p, response: null }); }
    };
    const onPage = (p) => {
        p.on("download", onDownload);
        p.on("load", () => checkTab(p));
        p.waitForLoadState("domcontentloaded").then(() => checkTab(p)).catch(() => {});
    };
    page.on("download", onDownload);
    context.on("page", onPage);
    return {
        got,
        async waitFor(n, ms) {
            for (const until = Date.now() + ms; got.length < n && Date.now() < until; ) await sleep(250);
            return got.length >= n;
        },
        stop() { page.off("download", onDownload); context.off("page", onPage); },
    };
}

/** Wait for a download (this tab or any tab it opens) or a tab showing the media itself. */
function waitForFile(context, page, ms) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; cleanup(); resolve(v); } };
        const onDownload = (d) => finish({ kind: "download", download: d });
        const onPage = (p) => {
            p.on("download", onDownload);
            p.on("response", (res) => {
                const ct = res.headers()["content-type"] ?? "";
                if (res.request().isNavigationRequest() && /^(video|audio|image)\//.test(ct)) finish({ kind: "media-tab", url: res.url(), page: p, response: res });
            });
            // A tab opened already showing the file reports no response: ask the tab what it shows.
            p.waitForLoadState("domcontentloaded").then(async () => {
                const ct = await p.evaluate(() => document.contentType).catch(() => "");
                if (/^(video|audio|image)\//.test(ct)) finish({ kind: "media-tab", url: p.url(), page: p, response: null });
            }).catch(() => {});
        };
        const onMainResponse = (res) => {
            const ct = res.headers()["content-type"] ?? "";
            if (res.request().isNavigationRequest() && res.frame() === page.mainFrame() && /^(video|audio|image)\//.test(ct)) finish({ kind: "media-tab", url: res.url(), page, response: res });
        };
        page.on("download", onDownload);
        page.on("response", onMainResponse);
        context.on("page", onPage);
        const timer = setTimeout(() => finish(null), ms);
        function cleanup() {
            clearTimeout(timer);
            page.off("download", onDownload);
            page.off("response", onMainResponse);
            context.off("page", onPage);
        }
    });
}

async function saveFile(got, context, file) {
    if (got.kind === "download") {
        const cap = new Promise((_, reject) => setTimeout(() => reject(new Error(`the file did not finish within ${LIMITS.fileMs / 60_000} minutes`)), LIMITS.fileMs).unref());
        const failure = await Promise.race([got.download.failure(), cap]);
        if (failure) throw new Error(`download failed: ${failure}`);
        await got.download.saveAs(file);
        return { delivery: "download", name: got.download.suggestedFilename() };
    }
    // A tab showing the media: take the body Chrome received (its own DNS and
    // connection), else fetch the same URL with the context's cookies.

    const cap = new Promise((resolve) => setTimeout(() => resolve(null), LIMITS.fileMs).unref());
    const body = await Promise.race([got.response?.body().catch(() => null), cap]);
    if (body && body.length > 0) {
        await writeFile(file, body);
        return { delivery: "media-tab", name: null };
    }
    // The tab is still streaming the file; some servers allow one connection per link, so stop it
    // first, as "Save video as…" in a visitor's browser would fetch it again on its own.
    if (got.page && got.page !== context.pages()[0]) await got.page.close().catch(() => {});
    const res = await context.request.get(got.url, { timeout: LIMITS.fileMs });
    if (!res.ok()) throw new Error(`media tab returned ${res.status()}`);
    await writeFile(file, await res.body());
    return { delivery: "media-tab", name: null };
}

/** Mobile usability checks at the result state (SPEC.md §6.F). */
async function mobileChecks(page, inputSel, chosen) {
    return within(page.evaluate(({ chosenText }) => {
        const input = document.activeElement?.matches?.("input,textarea") ? document.activeElement : document.querySelector("input[type=url], input[type=text], input:not([type]), textarea");
        const box = (el) => (el ? el.getBoundingClientRect() : null);
        const inputBox = box(input);
        const fontPx = input ? parseFloat(getComputedStyle(input).fontSize) : null;
        const all = [...document.querySelectorAll("a, button, [role=button], input[type=submit]")];
        const control = all.find((el) => (el.innerText || el.value || "").replace(/\s+/g, " ").trim() === chosenText);
        const submit = input?.closest("form")?.querySelector("button, input[type=submit]") ?? null;
        const sizes = [input, submit, control].filter(Boolean).map((el) => { const r = el.getBoundingClientRect(); return Math.min(r.width, r.height); });
        const cb = box(control);
        let adBetween = false;
        if (inputBox && cb) {
            const top = inputBox.bottom + scrollY, bottom = cb.top + scrollY;
            const ads = [...document.querySelectorAll("iframe, ins.adsbygoogle, [id^=google_ads], [id*='-ad-'], [class*='adsbygoogle']")];
            adBetween = ads.some((el) => {
                const r = el.getBoundingClientRect();
                const y = r.top + scrollY;
                return r.width > 50 && r.height > 50 && y > top && y + r.height < bottom;
            });
        }
        return {
            horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1,
            inputFontPx: fontPx,
            smallestTargetPx: sizes.length ? Math.round(Math.min(...sizes)) : null,
            adBetweenInputAndDownload: adBetween,
        };
    }, { chosenText: chosen?.text ?? "" }), null);
}

/**
 * Run one item. `item` = { id, kind: video|mp3|photos|variant|negative, url, task? }.
 * Returns the result record (SPEC.md Appendix B) without behaviour totals,
 * which the run adds from the observer.
 */
export async function runItem({ context, page, log, adapter, item, ref, refMedia, dir, viewport, measureMobile = false }) {
    const task = item.task ?? (item.kind === "mp3" ? "mp3" : item.kind === "photos" ? "photos" : item.kind === "variant" ? (item.variantOf?.startsWith("P") ? "photos" : "video") : "video");
    const rec = { item: item.id, kind: item.kind, task, viewport, started: new Date().toISOString(), outcome: null, failure: null, retried: false, timings_ms: {}, clicks: 0, control_label: null, file: null, negative: null, evidence: [] };
    mkdirSync(dir, { recursive: true });
    const shot = async (name) => {
        const f = join(dir, `${item.id}-${viewport}-${name}.png`);
        await page.screenshot({ path: f, timeout: 10_000 }).catch(() => {});
        rec.evidence.push(f);
    };

    // 1. Home page.
    log.phase = "home";
    log.expectNavigation(true);
    try {
        await page.goto(adapter.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (e) {
        log.expectNavigation(false);
        if (!(await online())) return { ...rec, outcome: "skipped", failure: "the test machine was offline" };
        return { ...rec, outcome: "failure", failure: `home page did not load: ${e.message.split("\n")[0]}` };
    }
    // Let the page finish loading (some reload themselves once loaded); not timed: timings start at submit.
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await sleep(2500);
    log.expectNavigation(false);
    if (await challenged(page)) {
        if (await stillChallenged(page)) {
            await shot("blocked");
            return { ...rec, outcome: "blocked", failure: "bot-protection challenge (not solved, SPEC.md §5.4)" };
        }
    }

    // 2. Paste the link.
    const input = adapter.input ? await adapter.input(page) : await findLinkInput(page);
    if (!input) {
        await shot("no-input");
        return { ...rec, outcome: "failure", failure: "no link box found" };
    }
    const mobile = viewport === "mobile";
    const before = new Set((await listControls(page)).map(key));
    const textBefore = new Set((await within(page.evaluate(() => document.body.innerText), "")).split("\n").map((l) => l.trim()));
    await clickLikeUser(page, input, mobile);
    await sleep(800);
    // An ad layer may have taken that click (and opened a tab): the visitor
    // clicks the box again before pasting.
    await clickLikeUser(page, input, mobile).catch(() => {});
    await input.fill(item.url).catch(async () => { await input.type(item.url, { delay: 10 }); });

    // 3. Submit.
    log.phase = "submitted";
    const t0 = Date.now();
    const submitOnce = async () => {
        if (adapter.submit) return adapter.submit(page, input, mobile);
        const button = await findSubmit(page, input);
        if (!(await clickLikeUser(page, button, mobile))) await input.press("Enter");
    };
    await submitOnce();
    rec.clicks = 1;
    // If nothing happened but a tab opened (an ad took the click), submit again. Checked every
    // 250 ms, so the wait costs nothing when the page responds (the timings start at t0).
    for (let extra = 0; extra < 2; extra++) {
        let progressed = false;
        const end = Date.now() + 6000;
        while (Date.now() < end && !progressed) {
            await sleep(250);
            const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
            progressed = fresh.length > 0 || page.url() !== adapter.url;
        }
        const adTook = log.newPages.some((p) => p.t >= t0 - 500);
        if (progressed || !adTook) break;
        await submitOnce();
        rec.clicks++;
    }

    // Should-fail items: grade the response (SPEC.md §6.A2).
    if (item.kind === "negative") {
        const end = Date.now() + LIMITS.negativeMs;
        let grade = "bad";
        let message = null;
        while (Date.now() < end) {
            await sleep(1500);
            // An ad wall in the way is not the tool's answer to the link: recorded as such, not graded.
            if (await adWall(page)) {
                await shot("ad-wall");
                return { ...rec, outcome: "ad-wall", failure: "the site requires watching an ad to continue (not done: SPEC.md §6.D)" };
            }
            const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
            if (pickControl(adapter, "video", fresh) || pickControl(adapter, "mp3", fresh)) { grade = "bad"; message = "offered a download"; break; }
            // Only text that appeared after submitting, and not questions (FAQ
            // entries like "Can I download private videos?" aren't errors).
            const text = await within(page.evaluate(() => document.body.innerText), "");
            const dialog = log.dialogs.find((d) => d.t >= t0 && ERROR_TEXT.test(d.message));
            const m = dialog?.message ?? text.split("\n").map((l) => l.trim()).find((l) => l && !textBefore.has(l) && l.length < 200 && !l.endsWith("?") && ERROR_TEXT.test(l));
            if (m) { message = m; grade = SPECIFIC_ERROR.test(m) ? "clear" : "generic"; break; }
        }
        if (log.offsiteNavigations.some((n) => n.t >= t0)) { grade = "bad"; message = (message ? message + "; " : "") + "redirected away"; }
        await shot("negative");
        return { ...rec, outcome: "success", negative: { grade, message } };
    }

    // 4. Wait for the result.
    let chosen = null;
    let resultControls = [];
    const resultEnd = t0 + LIMITS.resultMs;
    while (Date.now() < resultEnd) {
        await sleep(250);
        if (await adWall(page)) {
            await shot("ad-wall");
            return { ...rec, outcome: "ad-wall", failure: "the site requires watching an ad to continue (not done: SPEC.md §6.D)" };
        }
        if (page.url().includes("#google_vignette") && (await closeOverlays(page, mobile))) rec.clicks++;
        if (adapter.ready && !(await adapter.ready(page, task))) continue;
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
        chosen = adapter.pick ? await adapter.pick(page, task, fresh) : pickControl(adapter, task, fresh);
        resultControls = fresh;
        if (chosen) break;
    }
    if (!chosen) {
        await shot("no-result");
        if (process.env.TDB_DUMP) await page.content().then((html) => writeFile(join(dir, `${item.id}-${viewport}-no-result.html`), html)).catch(() => {});
        if (await challenged(page)) return { ...rec, outcome: "blocked", failure: "bot-protection challenge after submit" };
        // A result with options for other tasks but none for this one: the tool
        // doesn't offer it (SPEC.md §6.A1 "not offered").
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
        const others = ["video", "mp3", "photos"].filter((t) => t !== task && pickControl(adapter, t, fresh));
        if (others.length) return { ...rec, outcome: "failure", notOffered: true, failure: `the result offers ${others.join(" and ")} but no ${task} option` };
        // Quote the site's own error, if it showed one after submitting (as for should-fail items).
        const text = await within(page.evaluate(() => document.body.innerText), "");
        const said = log.dialogs.find((d) => d.t >= t0 && ERROR_TEXT.test(d.message))?.message
            ?? text.split("\n").map((l) => l.trim()).find((l) => l && !textBefore.has(l) && l.length < 200 && !l.endsWith("?") && ERROR_TEXT.test(l));
        return { ...rec, outcome: "failure", failure: said ? `the site said: "${said.slice(0, 120)}"` : "no download control within 60 s", siteMessage: said ?? undefined };
    }
    rec.timings_ms.to_result = Date.now() - t0;
    rec.control_label = chosen.text || chosen.href;
    {
        // Was a better option for this task locked behind an ad?
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
        const patterns = adapter.controls?.[task] ?? TASK_LABELS[task];
        const gated = fresh.filter((c) => AD_GATED.test(c.text) && patterns.some((re) => re.test(c.text)));
        if (gated.length) rec.adGatedOptions = gated.map((c) => c.text);
    }
    await shot("result");
    // Adapter work: TDB_DUMP=1 keeps the result page's HTML next to its screenshots (runs-local/, never published).
    if (process.env.TDB_DUMP) await page.content().then((html) => writeFile(join(dir, `${item.id}-${viewport}-result.html`), html)).catch(() => {});
    if (measureMobile) rec.mobile = await mobileChecks(page, null, chosen);

    // 5. Click it and wait for the file. A click swallowed by an ad tab or an
    //    intermediate page is retried — each retry is an extra click.
    log.phase = "downloading";
    const ext = task === "mp3" ? "mp3" : task === "photos" ? "img" : "mp4";
    const files = [];
    // Clicks `first` (and what the page offers next) until a file starts, within LIMITS.startMs.
    const attemptDownload = async (first) => {
        let target = first;
        const startEnd = Date.now() + LIMITS.startMs;
        for (let attempt = 0; attempt < 4 && Date.now() < startEnd; attempt++) {
            // Found again by label and link at click time, never by position (SPEC.md §5.2: ads are never clicked).
            const handle = await controlHandle(page, target);
            if (!handle) break;
            const waiting = waitForFile(context, page, attempt === 0 ? 15_000 : 20_000);
            await clickLikeUser(page, handle, mobile);
            rec.clicks++;
            // A Google vignette that took the click is closed as soon as it shows, as a visitor would;
            // the file then gets 5 s before the control is clicked again (no harness patience in the timings).
            let settled = false, g = null, polls = 0;
            waiting.then((v) => { g = v; settled = true; });
            while (!settled) {
                await sleep(500);
                // An ad that must be watched to get the file is never waited out (SPEC.md §5.2).
                if (!settled && ++polls % 4 === 0 && (await adWall(page))) return "ad-wall";
                if (!settled && page.url().includes("#google_vignette")) {
                    if (await closeOverlays(page, mobile)) rec.clicks++;
                    g = await Promise.race([waiting, sleep(5_000).then(() => null)]);
                    settled = true;
                }
            }
            if (g) return g;
            // No file yet: an ad may be covering the page (a vignette or a modal) —
            // close it like a visitor; the download often continues by itself.
            if (await adWall(page)) return "ad-wall";
            if (await closeOverlays(page, mobile)) {
                rec.clicks++;
                g = await waitForFile(context, page, 5_000);
                if (g) return g;
            }
            // Otherwise the page may have moved to an intermediate step.
            await sleep(1500);
            const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
            target = (adapter.pick ? await adapter.pick(page, task, fresh) : pickControl(adapter, task, fresh)) ?? target;
        }
        return null;
    };
    let got = await attemptDownload(chosen);
    // "Download all" gave no file: a visitor saves the photos one by one instead (SPEC.md §5.2).
    if (!got && task === "photos" && /all|zip/i.test(chosen.text)) {
        const photoRe = (adapter.controls?.photos ?? TASK_LABELS.photos).slice(-1)[0];
        const pathOf = (href) => { try { const u = new URL(href); return /^https?:$/.test(u.protocol) ? u.pathname : ""; } catch { return ""; } };
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)) && !/all|zip/i.test(c.text));
        const single = fresh.find((c) => photoRe.test(c.text) || (c.href && photoRe.test(pathOf(c.href))));
        if (single) {
            rec.fallback = `"${chosen.text}" gave no file; saved the photos one by one`;
            chosen = single;
            got = await attemptDownload(single);
        }
    }
    // The chosen option needs an ad watched (e.g. a rewarded ad on HD): it is an option behind an ad.
    // Close the ad (never watched) and take the next option for the task; only if every option needs
    // the ad is it an ad wall (SPEC.md §6.D).
    while (got === "ad-wall") {
        await shot("ad-wall");
        rec.adGatedOptions = [...(rec.adGatedOptions ?? []), chosen.text];
        if (page._tdbWallText) rec.adWallText = page._tdbWallText;
        if (await closeOverlays(page, mobile)) rec.clicks++;
        await closeOverlays(page, mobile);
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)) && !rec.adGatedOptions.includes(c.text));
        const next = adapter.pick ? await adapter.pick(page, task, fresh) : pickControl(adapter, task, fresh);
        if (!next) return { ...rec, outcome: "ad-wall", failure: "the site requires watching an ad to continue (not done: SPEC.md §6.D)" };
        chosen = next;
        rec.control_label = next.text;
        got = await attemptDownload(next);
    }
    if (got) rec.timings_ms.to_download = Date.now() - t0;
    if (!got) {
        await shot("no-file");
        return { ...rec, outcome: "failure", failure: "no file started within 60 s of clicking the download control" };
    }
    try {
        const file = join(dir, `${item.id}-${viewport}.${ext === "img" ? "bin" : ext}`);
        const saved = await saveFile(got, context, file);
        rec.timings_ms.to_file = Date.now() - t0;
        rec.bytes = statSync(file).size;
        rec.delivery = saved.delivery;
        files.push(file);
    } catch (e) {
        if (!(await online())) return { ...rec, outcome: "skipped", failure: "the test machine was offline" };
        return { ...rec, outcome: "failure", failure: e.message.slice(0, 160) };
    }

    // Photo posts: collect the remaining images when each has its own control.
    if (task === "photos" && ref?.imageCount > 1 && !/all|zip/i.test(chosen.text)) {
        // The image controls as the result showed them, plus any shown since: some sites hide them
        // while a file downloads and show them again afterwards.
        const seen = new Map();
        for (const c of [...resultControls, ...(await listControls(page))]) if (!before.has(key(c)) && key(c) !== key(chosen)) seen.set(key(c), c);
        const more = [...seen.values()].filter((c) => (adapter.controls?.photos ?? TASK_LABELS.photos).some((re) => re.test(c.text)));
        let misses = 0;
        rec.perImage = { offered: more.length + 1, labels: [chosen.text, ...more.map((c) => c.text)].slice(0, 12) };
        // Every file that arrives during this step is kept, whichever click it answers: a late file
        // must not be credited to the next image, nor lost after the last click.
        const col = collectFiles(context, page);
        const targets = more.slice(0, ref.imageCount - 1);
        for (const c of targets) {
            // Found again by its label and link at click time, never by position; a visitor waits for
            // it to come back if the page hid it while the previous file downloaded.
            let handle = null;
            for (const until = Date.now() + 20_000; !handle && Date.now() < until; ) { handle = await controlHandle(page, c); if (!handle) await sleep(500); }
            if (!handle) { if (++misses >= 2) break; continue; }
            const had = col.got.length;
            await clickLikeUser(page, handle, mobile);
            let arrived = await col.waitFor(had + 1, 20_000);
            // An ad layer may have taken the click: close it and click this image again, like a visitor.
            if (!arrived && (await closeOverlays(page, mobile))) {
                rec.clicks++;
                const again = await controlHandle(page, c);
                if (again) { await clickLikeUser(page, again, mobile); rec.clicks++; }
                arrived = await col.waitFor(had + 1, 20_000);
            }
            if (!arrived) { if (++misses >= 2) break; continue; }
            misses = 0;
        }
        await col.waitFor(targets.length, 10_000); // stragglers
        col.stop();
        for (const g of col.got) {
            const f = join(dir, `${item.id}-${viewport}-${files.length + 1}.bin`);
            await saveFile(g, context, f).then(() => files.push(f)).catch(() => {});
        }
        rec.timings_ms.to_file = Date.now() - t0;
    }

    // 6. Verify.
    const label = rec.control_label ?? "";
    if (task === "video") {
        const v = await verifyVideo(files[0], ref, label);
        const wm = refMedia ? await watermarkCheck(files[0], refMedia.clean, refMedia.marked, ref?.duration) : { checked: false };
        rec.file = { ...v, watermark: wm };
        rec.outcome = v.ok ? "success" : "failure";
        if (!v.ok) rec.failure = v.reasons.join("; ");
    } else if (task === "mp3") {
        const a = await verifyAudio(files[0], ref, label);
        rec.file = a;
        rec.outcome = a.ok ? "success" : "failure";
        if (!a.ok) rec.failure = a.reasons.join("; ");
    } else {
        const im = await verifyImages(files, ref);
        rec.file = im;
        rec.outcome = im.ok ? "success" : "failure";
        if (!im.ok) rec.failure = im.reasons.join("; ");
    }
    rec.files = files;
    return rec;
}
