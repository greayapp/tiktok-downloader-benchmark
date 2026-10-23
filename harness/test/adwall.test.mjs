// Browser tests for recognising ad walls (run: npm test; needs Google Chrome). A wall the harness
// can't read must not turn into "no download control": the visitor sees the wall (SPEC.md §6.D).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, newContext } from "../src/browser.mjs";
import { adWall } from "../src/flow.mjs";

const browser = await launchBrowser({ headless: true });
after(() => browser.close());
const page = async (html) => { const p = await (await newContext(browser)).newPage(); await p.setContent(html); return p; };
const WALL = `<h1>Unlock more content</h1><p>Take action to continue accessing the content on this site</p><button>View a short ad</button>`;

test("Google's offerwall on the page is a wall", async () => {
    assert.equal(await adWall(await page(`<div class="fc-monetization-dialog">${WALL}</div>`)), true);
});

test("a wall inside an open shadow root is a wall", async () => {
    const p = await page(`<div id="host"></div><script>document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = ${JSON.stringify(WALL)};</script>`);
    assert.equal(await adWall(p), true);
});

test("a wall inside a closed shadow root is found by the thorough check", async () => {
    const p = await page(`<div id="host"></div><script>document.getElementById("host").attachShadow({ mode: "closed" }).innerHTML = ${JSON.stringify(WALL)};</script>`);
    assert.equal(await adWall(p, { thorough: true }), true);
});

test("a wall inside a frame is a wall (quick and thorough)", async () => {
    const html = `<iframe srcdoc="${WALL.replace(/"/g, "&quot;")}"></iframe>`;
    assert.equal(await adWall(await page(html)), true);
    assert.equal(await adWall(await page(html), { thorough: true }), true);
});

test("an ordinary page with ads is not a wall", async () => {
    const p = await page(`<h1>TikTok Downloader</h1><input placeholder="Paste link"><button>Download</button><iframe srcdoc="<p>Ad · Learn more</p>"></iframe>`);
    assert.equal(await adWall(p), false);
    assert.equal(await adWall(p, { thorough: true }), false);
});
