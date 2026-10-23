// Records what a site does during a test (SPEC.md §5.2, §6.D, §6.E): tabs and
// windows it opens, navigations of its tab to other sites, permission
// requests, dialogs, and every network request classified as ad / tracker.
// Attach BEFORE opening the test page (init scripts apply to new pages only).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDomain } from "tldts";
import { classify } from "./lists.mjs";

// Runs in every frame before the site's code: reports permission requests
// that lead to notification prompts. It wraps, never blocks: the call goes
// through and is answered by the browser (Playwright denies by default).
const INIT = `(() => {
  const report = (kind) => { try { window.__tdbReport && window.__tdbReport(kind); } catch (e) {} };
  try {
    if (window.Notification && Notification.requestPermission) {
      const orig = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = function () { report("notification"); return orig.apply(null, arguments); };
    }
    if (window.PushManager && PushManager.prototype.subscribe) {
      const sub = PushManager.prototype.subscribe;
      PushManager.prototype.subscribe = function () { report("push"); return sub.apply(this, arguments); };
    }
  } catch (e) {}
})();`;

export const siteOf = (url) => {
    try {
        return getDomain(new URL(url).hostname) ?? new URL(url).hostname;
    } catch {
        return null;
    }
};

/**
 * Start recording on `context`. Returns the log; set `log.phase` as the test
 * moves on ("home", "submitted", "result", "downloading") so every event says
 * when it happened. `log.expectNavigation(true)` around our own page.goto().
 */
export async function observe(context, { toolSite, engines, evidenceDir }) {
    const log = {
        phase: "home",
        mainPage: null,
        newPages: [],
        navigations: [],
        offsiteNavigations: [],
        permissions: [],
        dialogs: [],
        nextIsMain: false,
        /** The next tab is a fresh main tab the harness opens (after a hang), not one the site opened. */
        expectMainPage() { this.nextIsMain = true; },
        requests: { total: 0, ad: 0, tracker: 0 },
        adDomains: new Set(),
        trackerDomains: new Set(),
        thirdPartyDomains: new Set(),
        expecting: false,
        expectNavigation(on) { this.expecting = on; },
    };
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
    // Addresses opened in a new tab, and deliveries downloaded through one before the tab was reported.
    const tabOpens = [];
    const tabDownloads = [];

    await context.exposeBinding("__tdbReport", ({ frame }, kind) => {
        log.permissions.push({ t: Date.now(), phase: log.phase, kind: String(kind), frame: frame?.url?.() ?? null });
    });
    await context.addInitScript(INIT);

    // Never let a recording problem stop a run: every handler is guarded.
    context.on("request", (req) => {
        try {
            const url = req.url();
            if (!/^https?:/.test(url)) return;
            log.requests.total++;
            const site = siteOf(url);
            if (site && site !== toolSite) log.thirdPartyDomains.add(site);
            // A navigation that opens a new tab has no frame yet: Playwright throws.
            let frame = null;
            try { frame = req.frame(); } catch { /* popup navigation */ }
            if (!frame && req.isNavigationRequest()) tabOpens.push({ url, t: Date.now() });
            let sourceUrl = "";
            try { sourceUrl = frame?.url() || ""; } catch { /* detached */ }
            const isMainFrame = req.isNavigationRequest() && !!frame && frame === log.mainPage?.mainFrame();
            const c = classify(engines, { url, sourceUrl: sourceUrl || `https://${toolSite}/`, resourceType: req.resourceType(), isMainFrame });
            if (c.ad) { log.requests.ad++; if (site) log.adDomains.add(site); }
            if (c.tracker) { log.requests.tracker++; if (site) log.trackerDomains.add(site); }
        } catch { /* ignore */ }
    });

    context.on("page", (p) => {
        if (!log.mainPage || log.nextIsMain) {
            log.nextIsMain = false;
            log.mainPage = p;
            attachMain(p);
            return;
        }
        // A tab or window the site opened.
        const entry = { t: Date.now(), phase: log.phase, url: p.url(), finalUrl: null, evidence: null, media: false, download: false, opened: [] };
        log.newPages.push(entry);
        // The addresses the tab opened, to match a download it started (see onDownload).
        if (/^https?:/.test(p.url())) entry.opened.push(p.url());
        const early = !/^https?:/.test(p.url()) && tabDownloads.find((x) => !x.used && Date.now() - x.t < 3_000);
        if (early) { early.used = true; entry.media = true; entry.download = true; }
        p.on("request", (req) => { try { if (req.isNavigationRequest()) entry.opened.push(req.url()); } catch { /* ignore */ } });
        p.on("dialog", (d) => d.dismiss().catch(() => {}));
        // A tab showing the file itself (a video, audio or image) is how the site delivers it: not a
        // pop-up, and left open while the flow saves it.
        p.on("response", (res) => {
            try {
                if (res.request().isNavigationRequest() && /^(video|audio|image)\//.test(res.headers()["content-type"] ?? "")) entry.media = true;
            } catch { /* ignore */ }
        });
        // So is a tab opened only to download the file (a link with target=_blank to an attachment:
        // the tab stays blank, Chrome downloads the file, and the tab closes). A download of anything
        // else (an ad tab pushing an installer) leaves it a pop-up.
        const gotDownload = new Promise((resolve) => { entry.downloaded = resolve; });
        p.on("download", onDownload);
        setTimeout(async () => {
            // A file tab may still be loading at 4 s (TikTok's media servers can be slow): its address
            // says what it is. (Files saved from such a tab are still verified as real media.)
            if (!entry.media) entry.media = isMediaUrl(p.url());
            if (!entry.media) entry.media = /^(video|audio|image)\//.test(await Promise.race([p.evaluate(() => document.contentType).catch(() => ""), new Promise((r) => setTimeout(() => r(""), 3000))]));
            // A blank tab or one on the tool's own site may be waiting for its server to send the file:
            // give the download time to start before judging the tab (closing it would stop the file).
            if (!entry.media && !p.isClosed() && (!/^https?:/.test(p.url()) || siteOf(p.url()) === toolSite)) {
                await Promise.race([gotDownload, new Promise((r) => p.once("close", r)), new Promise((r) => setTimeout(r, DOWNLOAD_TAB_WAIT_MS))]);
            }
            if (entry.media) { entry.finalUrl = p.url(); return; }
            try {
                entry.finalUrl = p.url();
                if (evidenceDir) {
                    const file = join(evidenceDir, `newtab-${log.newPages.length}-${Date.now()}.png`);
                    await p.screenshot({ path: file, timeout: 5_000 });
                    entry.evidence = file;
                }
            } catch { /* closed already */ }
            await p.close().catch(() => {});
        }, 4_000);
    });

    // Chrome reports a download on the tab that started it, or on its opener when that tab closed
    // itself (the usual case for a target=_blank link to an attachment): it is matched to the new
    // tab by the address the tab opened.
    // Chrome reports the download before it reports the tab, which then has no address yet: such a
    // download is kept for a moment and given to the blank tab that appears.
    function onDownload(d) {
        try {
            const url = d.url();
            const delivery = isDeliveryDownload(d, toolSite);
            const viaTab = tabOpens.some((x) => x.url === url && Date.now() - x.t < 60_000);
            const entry = [...log.newPages].reverse().find((e) => e.opened.includes(url))
                ?? (viaTab ? [...log.newPages].reverse().find((e) => !e.media && !e.opened.length && Date.now() - e.t < 3_000) : null);
            if (entry) {
                if (delivery) { entry.media = true; entry.download = true; }
                entry.downloaded();
            } else if (viaTab && delivery) tabDownloads.push({ url, t: Date.now(), used: false });
        } catch { /* ignore */ }
    }

    function attachMain(p) {
        p.on("download", onDownload);
        p.on("framenavigated", (f) => {
            if (f !== p.mainFrame()) return;
            const url = f.url();
            const nav = { t: Date.now(), phase: log.phase, url, ours: log.expecting };
            log.navigations.push(nav);
            const site = siteOf(url);
            // Only another web site counts: Chrome's own error page (a load that failed) is not a redirect.
            if (!log.expecting && site && site !== toolSite && /^https?:/.test(url)) log.offsiteNavigations.push(nav);
        });
        p.on("dialog", (d) => {
            log.dialogs.push({ t: Date.now(), phase: log.phase, type: d.type(), message: d.message().slice(0, 200) });
            d.dismiss().catch(() => {});
        });
    }
    return log;
}

/** How long a blank or own-site tab may wait for its download to start before it is judged. */
const DOWNLOAD_TAB_WAIT_MS = 20_000;

/** A download that delivers what was asked for: a media or ZIP file, or a file from the tool's own site. */
export function isDeliveryDownload(download, toolSite) {
    const url = download.url();
    return isMediaUrl(url) || siteOf(url) === toolSite || /\.(mp4|m4a|mp3|mov|webm|jpe?g|png|webp|heic|gif|zip)$/i.test(download.suggestedFilename() ?? "");
}

/** A URL that is a media file itself: a file extension, or TikTok's media servers. */
export function isMediaUrl(url) {
    try {
        const u = new URL(url);
        return /\.(jpe?g|png|webp|heic|gif|mp4|m4a|mp3|mov)$/i.test(u.pathname) || /(^|\.)(tiktokcdn(-[a-z]+)?\.com|tiktokcdn\.com|muscdn\.com|byteoversea\.com|tiktokv\.com|ibyteimg\.com)$/i.test(u.hostname);
    } catch { return false; }
}

/** Third-party cookies set so far (SPEC.md §6.E "cookies before interaction"). */
export async function thirdPartyCookies(context, toolSite) {
    const cookies = await context.cookies();
    return cookies.filter((c) => siteOf(`https://${c.domain.replace(/^\./, "")}/`) !== toolSite).map((c) => `${c.domain}:${c.name}`);
}

/** The log as plain JSON for a result record. */
export function snapshot(log) {
    return {
        newPages: log.newPages.map(({ t, phase, url, finalUrl, evidence, media, download }) => ({ t, phase, url, finalUrl, evidence, media, download })),
        offsiteNavigations: log.offsiteNavigations,
        permissions: log.permissions,
        dialogs: log.dialogs,
        requests: { ...log.requests },
        adDomains: [...log.adDomains].sort(),
        trackerDomains: [...log.trackerDomains].sort(),
        thirdPartyDomains: [...log.thirdPartyDomains].sort(),
    };
}
