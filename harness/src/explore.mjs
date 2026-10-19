// Explore a tool's flow before writing its adapter: open the home page, paste a
// TikTok link into the most likely input, submit, and record what appears
// (clickable controls, new tabs, navigations) plus screenshots.
//
//   node src/explore.mjs <domain|url> <tiktok link> [--mobile] [--out dir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser, newContext } from "./browser.mjs";
import { findLinkInput, findSubmit } from "./generic.mjs";

const [target, link] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const mobile = process.argv.includes("--mobile");
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? process.argv[outArg + 1] : "explore-out";
if (!target || !link) {
    console.error("usage: node src/explore.mjs <domain|url> <tiktok link> [--mobile] [--out dir]");
    process.exit(2);
}
// Never hang a batch: give up on this tool after 2.5 minutes.
setTimeout(() => { console.log(JSON.stringify({ tool: target, error: "explore timed out" })); process.exit(3); }, 150_000).unref();
const url = target.startsWith("http") ? target : `https://${target}/`;
const name = new URL(url).hostname.replace(/^www\./, "");
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const context = await newContext(browser, { mobile });
const events = [];
context.on("page", (p) => events.push({ t: Date.now(), kind: "new-page", url: p.url() }));
const page = await context.newPage();
page.on("framenavigated", (f) => { if (f === page.mainFrame()) events.push({ t: Date.now(), kind: "navigated", url: f.url() }); });
page.on("download", (d) => events.push({ t: Date.now(), kind: "download", url: d.url(), name: d.suggestedFilename() }));

const result = { tool: name, url, mobile, link, steps: [] };
try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(out, `${name}-${mobile ? "m" : "d"}-1-home.png`) });
    const input = await findLinkInput(page);
    result.input = input ? await input.evaluate((el) => ({ tag: el.tagName, id: el.id, name: el.name, placeholder: el.placeholder, type: el.type })) : null;
    if (!input) throw new Error("no link input found");
    await input.click();
    await input.fill(link);
    const submit = await findSubmit(page, input);
    result.submit = submit ? await submit.evaluate((el) => ({ tag: el.tagName, id: el.id, text: (el.innerText || el.value || "").trim().slice(0, 40) })) : null;
    const t0 = Date.now();
    if (submit) await submit.click({ timeout: 10_000 }).catch((e) => result.steps.push("submit click failed: " + e.message.slice(0, 80)));
    else await input.press("Enter");
    await page.waitForTimeout(20_000);
    result.waitedMs = Date.now() - t0;
    result.finalUrl = page.url();
    await page.screenshot({ path: join(out, `${name}-${mobile ? "m" : "d"}-2-result.png`), fullPage: true });
    result.controls = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
        return [...document.querySelectorAll("a, button, [role=button], input[type=button], input[type=submit]")]
            .filter(vis)
            .map((el) => ({ tag: el.tagName, text: (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60), href: el.href ? el.href.slice(0, 140) : null, download: el.hasAttribute("download"), id: el.id, cls: String(el.className).slice(0, 60) }))
            .filter((c) => /download|mp4|mp3|hd|watermark|video|audio|photo|image|save|slide|music/i.test(c.text + " " + (c.href || "")));
    });
} catch (e) {
    result.error = e.message.slice(0, 200);
    await page.screenshot({ path: join(out, `${name}-${mobile ? "m" : "d"}-error.png`) }).catch(() => {});
}
result.events = events;
writeFileSync(join(out, `${name}-${mobile ? "m" : "d"}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ tool: name, input: result.input?.placeholder ?? result.input, submit: result.submit?.text, controls: (result.controls || []).length, events: events.filter((e) => e.kind !== "navigated").length, error: result.error }));
await browser.close();
