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
        requests: { total: 0, ad: 0, tracker: 0 },
        adDomains: new Set(),
        trackerDomains: new Set(),
        thirdPartyDomains: new Set(),
        expecting: false,
        expectNavigation(on) { this.expecting = on; },
    };
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

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
            let sourceUrl = "";
            try { sourceUrl = frame?.url() || ""; } catch { /* detached */ }
            const isMainFrame = req.isNavigationRequest() && !!frame && frame === log.mainPage?.mainFrame();
            const c = classify(engines, { url, sourceUrl: sourceUrl || `https://${toolSite}/`, resourceType: req.resourceType(), isMainFrame });
            if (c.ad) { log.requests.ad++; if (site) log.adDomains.add(site); }
            if (c.tracker) { log.requests.tracker++; if (site) log.trackerDomains.add(site); }
        } catch { /* ignore */ }
    });

    context.on("page", (p) => {
        if (!log.mainPage) {
            log.mainPage = p;
            attachMain(p);
            return;
        }
        // A tab or window the site opened.
        const entry = { t: Date.now(), phase: log.phase, url: p.url(), finalUrl: null, evidence: null };
        log.newPages.push(entry);
        p.on("dialog", (d) => d.dismiss().catch(() => {}));
        setTimeout(async () => {
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

    function attachMain(p) {
        p.on("framenavigated", (f) => {
            if (f !== p.mainFrame()) return;
            const url = f.url();
            const nav = { t: Date.now(), phase: log.phase, url, ours: log.expecting };
            log.navigations.push(nav);
            const site = siteOf(url);
            if (!log.expecting && site && site !== toolSite && !url.startsWith("about:")) log.offsiteNavigations.push(nav);
        });
        p.on("dialog", (d) => {
            log.dialogs.push({ t: Date.now(), phase: log.phase, type: d.type(), message: d.message().slice(0, 200) });
            d.dismiss().catch(() => {});
        });
    }
    return log;
}

/** Third-party cookies set so far (SPEC.md §6.E "cookies before interaction"). */
export async function thirdPartyCookies(context, toolSite) {
    const cookies = await context.cookies();
    return cookies.filter((c) => siteOf(`https://${c.domain.replace(/^\./, "")}/`) !== toolSite).map((c) => `${c.domain}:${c.name}`);
}

/** The log as plain JSON for a result record. */
export function snapshot(log) {
    return {
        newPages: log.newPages.map(({ t, phase, url, finalUrl, evidence }) => ({ t, phase, url, finalUrl, evidence })),
        offsiteNavigations: log.offsiteNavigations,
        permissions: log.permissions,
        dialogs: log.dialogs,
        requests: { ...log.requests },
        adDomains: [...log.adDomains].sort(),
        trackerDomains: [...log.trackerDomains].sort(),
        thirdPartyDomains: [...log.thirdPartyDomains].sort(),
    };
}
