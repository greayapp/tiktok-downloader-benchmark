// One test item, driven the way a visitor would (SPEC.md §5.2):
// open the home page, paste the link, submit, wait for the result, choose the
// control that matches the task, wait for the file, then verify it.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { findLinkInput, findSubmit, listControls, TASK_LABELS } from "./generic.mjs";
import { verifyAudio, verifyImages, verifyVideo, watermarkCheck } from "./verify.mjs";

export const LIMITS = { resultMs: 60_000, fileMs: 120_000, negativeMs: 30_000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (c) => `${c.text}|${c.href ?? ""}`;
const ERROR_TEXT = /invalid|not found|unavailable|error|private|deleted|removed|doesn'?t exist|does not exist|couldn'?t|could not|failed|unsupported|not supported|wrong|check (the|your) (link|url)|enter a valid|no (video|media)/i;
const SPECIFIC_ERROR = /private|deleted|removed|doesn'?t exist|does not exist|not found|unavailable|unsupported|not supported|invalid (link|url)|enter a valid|only tiktok|tiktok link/i;

/**
 * Click (desktop) or tap (mobile) at the element's on-screen centre, like a
 * person. Whatever is on top there receives it — including ad layers over the
 * page, which is exactly what a visitor experiences. Returns false if the
 * element has no box (hidden).
 */
export async function clickLikeUser(page, handle, mobile) {
    if (!handle) return false;
    await handle.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
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
    // A modal on the page with an explicit close control.
    const close = await page.evaluateHandle(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
        const label = (el) => (el.innerText || el.getAttribute("aria-label") || el.title || "").trim();
        return [...document.querySelectorAll("button, [role=button], a, span, div")]
            .filter((el) => vis(el) && /^(close|×|✕|x|skip|skip ad|dismiss|no,? thanks|not now)$/i.test(label(el)))
            .find((el) => { const z = Number(getComputedStyle(el.closest("[style*='z-index'], [class*='modal'], [class*='popup'], [role=dialog]") ?? el).zIndex); return Number.isFinite(z) || el.closest("[role=dialog], [class*='modal'], [class*='popup'], [class*='overlay']"); }) ?? null;
    }).catch(() => null);
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
export async function adWall(page) {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 20000)).catch(() => "");
    if (/unlock more content|view a short ad|watch (a|an) (short )?ad to (continue|unlock)|take action to continue accessing/i.test(text)) return true;
    return page.evaluate(() => !!document.querySelector(".fc-dialog-container, .fc-monetization-dialog, [class*='offerwall']")).catch(() => false);
}

/** Is the tab showing a bot-protection challenge (never solved — SPEC.md §5.4)? */
async function challenged(page) {
    const title = await page.title().catch(() => "");
    if (/just a moment|attention required|verify you are human|security check/i.test(title)) return true;
    // Only challenges a person would have to deal with: a visible widget. The
    // invisible reCAPTCHA badge many sites carry is not a challenge.
    return page.evaluate(() => {
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

function pickControl(adapter, task, fresh) {
    const patterns = adapter.controls?.[task] ?? TASK_LABELS[task];
    const exclude = adapter.excludeControls ?? /share|copy|facebook|twitter|whatsapp|telegram|app store|google play|extension/i;
    const usable = fresh.filter((c) => !exclude.test(c.text));
    for (const re of patterns) {
        const hit = usable.find((c) => re.test(c.text) || (c.href && re.test(c.href) && !/^javascript:/i.test(c.href)));
        if (hit) return hit;
    }
    return null;
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
                if (res.request().isNavigationRequest() && /^(video|audio|image)\//.test(ct)) finish({ kind: "media-tab", url: res.url(), page: p });
            });
        };
        const onMainResponse = (res) => {
            const ct = res.headers()["content-type"] ?? "";
            if (res.request().isNavigationRequest() && res.frame() === page.mainFrame() && /^(video|audio|image)\//.test(ct)) finish({ kind: "media-tab", url: res.url(), page });
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
        const failure = await got.download.failure();
        if (failure) throw new Error(`download failed: ${failure}`);
        await got.download.saveAs(file);
        return { delivery: "download", name: got.download.suggestedFilename() };
    }
    // A tab showing the media: fetch the same URL with the context's cookies.
    const res = await context.request.get(got.url, { timeout: 120_000 });
    if (!res.ok()) throw new Error(`media tab returned ${res.status()}`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, await res.body());
    return { delivery: "media-tab", name: null };
}

/** Mobile usability checks at the result state (SPEC.md §6.F). */
async function mobileChecks(page, inputSel, chosen) {
    return page.evaluate(({ chosenText }) => {
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
    }, { chosenText: chosen?.text ?? "" }).catch(() => null);
}

/**
 * Run one item. `item` = { id, kind: video|mp3|photos|variant|negative, url, task? }.
 * Returns the result record (SPEC.md Appendix B) without behaviour totals,
 * which the run adds from the observer.
 */
export async function runItem({ context, page, log, adapter, item, ref, refMedia, dir, viewport, measureMobile = false }) {
    const task = item.task ?? (item.kind === "mp3" ? "mp3" : item.kind === "photos" ? "photos" : item.kind === "variant" ? (item.variantOf?.startsWith("P") ? "photos" : "video") : "video");
    const rec = { item: item.id, kind: item.kind, viewport, started: new Date().toISOString(), outcome: null, failure: null, retried: false, timings_ms: {}, clicks: 0, control_label: null, file: null, negative: null, evidence: [] };
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
        return { ...rec, outcome: "failure", failure: `home page did not load: ${e.message.split("\n")[0]}` };
    }
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
    const textBefore = new Set((await page.evaluate(() => document.body.innerText).catch(() => "")).split("\n").map((l) => l.trim()));
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
    // If nothing happened but a tab opened (an ad took the click), submit again.
    for (let extra = 0; extra < 2; extra++) {
        await sleep(6000);
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
        const progressed = fresh.length > 0 || page.url() !== adapter.url;
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
            const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
            if (pickControl(adapter, "video", fresh) || pickControl(adapter, "mp3", fresh)) { grade = "bad"; message = "offered a download"; break; }
            // Only text that appeared after submitting, and not questions (FAQ
            // entries like "Can I download private videos?" aren't errors).
            const text = await page.evaluate(() => document.body.innerText).catch(() => "");
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
    const resultEnd = t0 + LIMITS.resultMs;
    while (Date.now() < resultEnd) {
        await sleep(1000);
        if (await adWall(page)) {
            await shot("ad-wall");
            return { ...rec, outcome: "ad-wall", failure: "the site requires watching an ad to continue (not done: SPEC.md §6.D)" };
        }
        if (page.url().includes("#google_vignette") && (await closeOverlays(page, mobile))) rec.clicks++;
        if (adapter.ready && !(await adapter.ready(page, task))) continue;
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
        chosen = adapter.pick ? await adapter.pick(page, task, fresh) : pickControl(adapter, task, fresh);
        if (chosen) break;
    }
    if (!chosen) {
        await shot("no-result");
        if (await challenged(page)) return { ...rec, outcome: "blocked", failure: "bot-protection challenge after submit" };
        return { ...rec, outcome: "failure", failure: "no download control within 60 s" };
    }
    rec.timings_ms.to_result = Date.now() - t0;
    rec.control_label = chosen.text || chosen.href;
    await shot("result");
    if (measureMobile) rec.mobile = await mobileChecks(page, null, chosen);

    // 5. Click it and wait for the file. A click swallowed by an ad tab or an
    //    intermediate page is retried — each retry is an extra click.
    log.phase = "downloading";
    const ext = task === "mp3" ? "mp3" : task === "photos" ? "img" : "mp4";
    const files = [];
    let got = null;
    let target = chosen;
    for (let attempt = 0; attempt < 4 && !got; attempt++) {
        const handle = await page.$$("a, button, [role=button], input[type=button], input[type=submit]").then((all) => all[target.index]).catch(() => null);
        const waiting = waitForFile(context, page, attempt === 0 ? 15_000 : 20_000);
        await clickLikeUser(page, handle, mobile);
        rec.clicks++;
        got = await waiting;
        if (got) break;
        // No file yet: an ad may be covering the page (a vignette or a modal) —
        // close it like a visitor; the download often continues by itself.
        if (await adWall(page)) {
            await shot("ad-wall");
            return { ...rec, outcome: "ad-wall", failure: "the site requires watching an ad to continue (not done: SPEC.md §6.D)" };
        }
        if (await closeOverlays(page, mobile)) {
            rec.clicks++;
            got = await waitForFile(context, page, 15_000);
            if (got) break;
        }
        // Otherwise the page may have moved to an intermediate step.
        await sleep(1500);
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)));
        target = (adapter.pick ? await adapter.pick(page, task, fresh) : pickControl(adapter, task, fresh)) ?? target;
    }
    if (!got) {
        await shot("no-file");
        return { ...rec, outcome: "failure", failure: "no file after clicking the download control" };
    }
    try {
        const file = join(dir, `${item.id}-${viewport}.${ext === "img" ? "bin" : ext}`);
        const saved = await saveFile(got, context, file);
        rec.timings_ms.to_file = Date.now() - t0;
        rec.delivery = saved.delivery;
        files.push(file);
    } catch (e) {
        return { ...rec, outcome: "failure", failure: e.message.slice(0, 160) };
    }

    // Photo posts: collect the remaining images when each has its own control.
    if (task === "photos" && ref?.imageCount > 1 && !/all|zip/i.test(chosen.text)) {
        const fresh = (await listControls(page)).filter((c) => !before.has(key(c)) && c.index !== chosen.index);
        const more = fresh.filter((c) => (adapter.controls?.photos ?? TASK_LABELS.photos).some((re) => re.test(c.text)));
        for (const c of more.slice(0, ref.imageCount - 1)) {
            const handle = await page.$$("a, button, [role=button], input[type=button], input[type=submit]").then((all) => all[c.index]).catch(() => null);
            const waiting = waitForFile(context, page, 20_000);
            await clickLikeUser(page, handle, mobile);
            const g = await waiting;
            if (!g) break;
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
