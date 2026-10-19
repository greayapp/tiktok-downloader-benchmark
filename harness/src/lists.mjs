// EasyList (ads) and EasyPrivacy (trackers), matched with Ghostery's engine.
// Lists are cached under harness/.cache/lists and refreshed after 7 days; each
// run records the list versions it used (SPEC.md §6.D, §6.E).
import { FiltersEngine, Request } from "@ghostery/adblocker";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache", "lists");
const LISTS = {
    easylist: "https://easylist.to/easylist/easylist.txt",
    easyprivacy: "https://easylist.to/easylist/easyprivacy.txt",
};
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

async function loadList(name) {
    const file = join(CACHE, `${name}.txt`);
    const fresh = await stat(file).then((s) => Date.now() - s.mtimeMs < MAX_AGE_MS).catch(() => false);
    if (!fresh) {
        const res = await fetch(LISTS[name], { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        await mkdir(CACHE, { recursive: true });
        await writeFile(file, await res.text());
    }
    const text = await readFile(file, "utf8");
    const version = text.match(/^! Version:\s*(\S+)/m)?.[1] ?? "unknown";
    return { text, version };
}

/** Both engines, plus the list versions to record with a run. */
export async function loadEngines() {
    const [ads, trackers] = await Promise.all([loadList("easylist"), loadList("easyprivacy")]);
    return {
        ads: FiltersEngine.parse(ads.text),
        trackers: FiltersEngine.parse(trackers.text),
        versions: { easylist: ads.version, easyprivacy: trackers.version },
    };
}

// Playwright resource types → the adblocker's request types.
const TYPES = {
    document: "sub_frame", stylesheet: "stylesheet", image: "image", media: "media", font: "font",
    script: "script", xhr: "xmlhttprequest", fetch: "xmlhttprequest", websocket: "websocket",
    eventsource: "other", manifest: "other", texttrack: "media", ping: "ping", other: "other",
};

/** Is this request an ad and/or a tracker? `sourceUrl` is the page or frame that made it. */
export function classify(engines, { url, sourceUrl, resourceType, isMainFrame = false }) {
    const type = isMainFrame ? "main_frame" : TYPES[resourceType] ?? "other";
    const req = Request.fromRawDetails({ url, sourceUrl, type });
    return {
        ad: engines.ads.match(req).match === true,
        tracker: engines.trackers.match(req).match === true,
    };
}
