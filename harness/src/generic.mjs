// Generic, label-based ways to find a downloader's link box, its submit button
// and the download controls — the way a visitor reads the page (SPEC.md §5.2).
// Adapters use these unless a site needs something more specific.

/** The most likely "paste your link" box: a visible text/url input or textarea. */
export async function findLinkInput(page) {
    const handles = await page.$$("input[type=url], input[type=text], input[type=search], input:not([type]), textarea");
    let best = null;
    let bestScore = -1;
    for (const h of handles) {
        const info = await h.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            const visible = r.width > 40 && r.height > 10 && s.visibility !== "hidden" && s.display !== "none" && !el.disabled && !el.readOnly;
            const text = [el.placeholder, el.name, el.id, el.getAttribute("aria-label"), el.className].join(" ").toLowerCase();
            return { visible, text, area: r.width * r.height, top: r.top };
        }).catch(() => ({ visible: false }));
        if (!info.visible) continue;
        let score = 1;
        if (/paste|link|url/.test(info.text)) score += 10;
        if (/tiktok|video/.test(info.text)) score += 4;
        if (/search|email|newsletter|subscribe/.test(info.text)) score -= 8;
        score += Math.min(info.area / 20000, 3);
        if (info.top < 900) score += 2;
        if (score > bestScore) {
            bestScore = score;
            best = h;
        }
    }
    return best;
}

/** The submit button that belongs to the link box: same form first, else the nearest matching button. */
export async function findSubmit(page, input) {
    // In the link box's form: the best-labelled button, never a paste/clear helper.
    const inForm = await input.evaluateHandle((el) => {
        const form = el.closest("form");
        if (!form) return null;
        const label = (b) => (b.innerText || b.value || b.getAttribute("aria-label") || "").trim();
        const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const buttons = [...form.querySelectorAll("button, input[type=submit], input[type=button]")]
            .filter(vis)
            .filter((b) => !/paste|clear|reset|close/i.test(label(b)));
        const score = (b) => (/download|submit|go\b|start|get|fetch/i.test(label(b)) ? 10 : 0) + (b.type === "submit" ? 5 : 0);
        buttons.sort((x, y) => score(y) - score(x));
        return buttons[0] ?? null;
    });
    const formButton = inForm.asElement();
    if (formButton) return formButton;
    const handle = await page.evaluateHandle((inputEl) => {
        const ir = inputEl.getBoundingClientRect();
        const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
        const cands = [...document.querySelectorAll("button, input[type=submit], input[type=button], a[role=button], [role=button]")]
            .filter(vis)
            .filter((el) => /download|submit|go|start|get|search|fetch/i.test(el.innerText || el.value || el.getAttribute("aria-label") || ""));
        let best = null;
        let bestD = Infinity;
        for (const el of cands) {
            const r = el.getBoundingClientRect();
            const d = Math.hypot(r.left + r.width / 2 - (ir.left + ir.width / 2), r.top + r.height / 2 - (ir.top + ir.height / 2));
            if (d < bestD) { bestD = d; best = el; }
        }
        return bestD < 400 ? best : null;
    }, input);
    return handle.asElement();
}

/**
 * Visible download-like controls on the page, in document order, with their
 * label and link. Used to pick the control for a task (adapters may override).
 */
/** page.evaluate that survives the page navigating meanwhile (some sites reload after loading). */
export async function evaluateStable(page, fn, arg) {
    for (let i = 0; ; i++) {
        try {
            // A page that never answers (a frozen tab) is an error, not a wait forever.
            let timer;
            const r = await Promise.race([page.evaluate(fn, arg), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("the page didn't answer within 20 s")), 20_000); })]);
            clearTimeout(timer);
            return r;
        } catch (e) {
            if (i >= 3 || !/context was destroyed|Cannot find context|navigat/i.test(e.message)) throw e;
            await page.waitForLoadState("domcontentloaded").catch(() => {});
            await new Promise((r) => setTimeout(r, 500));
        }
    }
}

// The page's controls: links and buttons, plus small clickable elements (pointer cursor, no link or
// button inside) whose text names a download — some sites build their buttons from plain divs.
// The same function runs in listControls() and controlHandle(), so both see the same controls.
const CONTROLS_IN_PAGE = `() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
    const label = (el) => [...new Set([el.innerText, el.value, el.getAttribute("aria-label"), el.title].map((x) => (x || "").replace(/\\s+/g, " ").trim()).filter(Boolean))].join(" · ").slice(0, 100);
    const real = [...document.querySelectorAll("a, button, [role=button], input[type=button], input[type=submit]")];
    const inReal = (el) => real.some((r) => r.contains(el) || el.contains(r));
    const divs = [...document.querySelectorAll("div, span, li")].filter((el) => {
        const t = (el.innerText || "").trim();
        return t.length > 0 && t.length <= 40 && /download|save|mp3|mp4|\\bhd\\b|photo|image|audio/i.test(t)
            && getComputedStyle(el).cursor === "pointer" && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer") && !inReal(el);
    });
    return [...real, ...divs].filter(vis).map((el) => ({ el, text: label(el), href: el.href || null }));
}`;

// Evaluated as an expression (not eval inside the page), so a site's Content Security Policy can't block it.
export async function listControls(page) {
    return evaluateStable(page, `(${CONTROLS_IN_PAGE})().map(({ el, text, href }, index) => ({ index, text, href, download: el.hasAttribute ? el.hasAttribute("download") : false })).filter((c) => c.text || c.href)`);
}

/**
 * The live element for a control from listControls(), found in one step inside the page by the
 * same text and link — never by position: pages that insert or rotate elements (ad carousels)
 * shift positions between listing and clicking, and a stale position can land on an ad.
 * Returns null when no visible element matches.
 */
export async function controlHandle(page, c) {
    let timer;
    const h = await Promise.race([
        page.evaluateHandle(`(${CONTROLS_IN_PAGE})().find((x) => x.text === ${JSON.stringify(c.text)} && x.href === ${JSON.stringify(c.href ?? null)})?.el ?? null`).catch(() => null),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 20_000); }),
    ]);
    clearTimeout(timer);
    const el = h?.asElement() ?? null;
    if (!el) await h?.dispose().catch(() => {});
    return el;
}

/** Task → label patterns, most specific first (SPEC.md §5.2 step 4). */
export const TASK_LABELS = {
    video: [/hd.*(no|without)\s*water/i, /(no|without)\s*water.*hd/i, /\bhd\b/i, /(no|without)\s*watermark/i, /mp4/i, /download\s*(video|now)?$/i],
    mp3: [/mp3/i, /audio|music|sound/i],
    // Not "slide": a "Slideshow video" is a video made from the photos, not the photos.
    photos: [/download\s*all|all\s*(photos|images)|zip/i, /photo|image|jpe?g|picture/i],
};
