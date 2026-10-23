// Browser tests for the tabs a site opens (run: npm test; needs Google Chrome). A tab opened only to
// download the requested file is the delivery (SPEC.md §6.D); any other tab the visitor didn't ask
// for is a pop-up, including an ad tab that pushes a download of something else.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, newContext } from "../src/browser.mjs";
import { observe } from "../src/observe.mjs";

const browser = await launchBrowser({ headless: true });
after(() => browser.close());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The next download in the context: Chrome reports it on the opener when the new tab closed itself.
const nextDownload = (context) => new Promise((resolve) => { for (const p of context.pages()) p.once("download", resolve); context.on("page", (p) => p.once("download", resolve)); });
const attachment = (name) => ({ status: 200, headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"` }, body: Buffer.alloc(2048) });

/** A tool page on tool.test with the given body, observed like a test run. */
async function toolPage(body) {
    const context = await newContext(browser);
    await context.route("https://tool.test/**", (route) => {
        const url = route.request().url();
        if (url.includes("/dl.php")) return route.fulfill(attachment("video.mp4"));
        return route.fulfill({ contentType: "text/html", body });
    });
    await context.route("https://ads.test/**", (route) => {
        if (route.request().url().endsWith("/setup")) return route.fulfill(attachment("setup.exe"));
        return route.fulfill({ contentType: "text/html", body: "<h1>Special offer</h1>" });
    });
    const log = await observe(context, { toolSite: "tool.test", engines: null, evidenceDir: null });
    const page = await context.newPage();
    await page.goto("https://tool.test/");
    log.phase = "downloading";
    return { context, page, log };
}

test("a tab opened only to download the file (target=_blank to an attachment) is the delivery, not a pop-up", async () => {
    const { context, page, log } = await toolPage(`<a id="go" href="https://tool.test/dl.php?v=abc" target="_blank">Download video</a>`);
    const download = nextDownload(context);
    await page.click("#go");
    assert.equal((await download).suggestedFilename(), "video.mp4");
    await sleep(4_500);
    assert.equal(log.newPages.length, 1);
    assert.equal(log.newPages[0].media, true);
    assert.equal(log.newPages[0].download, true);
    await context.close();
});

test("a tab to another site is a pop-up", async () => {
    const { context, page, log } = await toolPage(`<button id="go" onclick="window.open('https://ads.test/offer')">Download</button>`);
    await page.click("#go");
    await sleep(4_500);
    assert.equal(log.newPages.length, 1);
    assert.equal(log.newPages[0].media, false);
    await context.close();
});

test("an ad tab that pushes a download of something else is still a pop-up", async () => {
    const { context, page, log } = await toolPage(`<a id="go" href="https://ads.test/setup" target="_blank">Download</a>`);
    const download = nextDownload(context);
    await page.click("#go");
    assert.equal((await download).suggestedFilename(), "setup.exe");
    await sleep(4_500);
    assert.equal(log.newPages.length, 1);
    assert.equal(log.newPages[0].media, false);
    assert.equal(log.newPages[0].download, false);
    await context.close();
});
