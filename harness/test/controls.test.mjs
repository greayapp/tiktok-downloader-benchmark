// Browser tests for finding controls (run: npm test; needs Google Chrome). The click target is
// matched by label and link at click time, never by position: an ad list that inserts elements
// ahead of the button must not turn a click into an ad click.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, newContext } from "../src/browser.mjs";
import { controlHandle, listControls } from "../src/generic.mjs";

const browser = await launchBrowser({ headless: true });
after(() => browser.close());

test("a control is found by label and link even after elements are inserted before it", async () => {
    const page = await (await newContext(browser)).newPage();
    await page.setContent(`<div id="ads"></div><a href="https://tool.test/file.mp4">Download (No Watermark)</a>`);
    const [control] = (await listControls(page)).filter((c) => /No Watermark/.test(c.text));
    // An ad carousel adds links ahead of the button between listing and clicking.
    await page.evaluate(() => { for (let i = 0; i < 5; i++) document.getElementById("ads").insertAdjacentHTML("beforeend", `<a href="https://ads.test/${i}">Make money ${i}</a>`); });
    const handle = await controlHandle(page, control);
    assert.equal(await handle.evaluate((el) => el.href), "https://tool.test/file.mp4");
});

test("a control that is gone resolves to nothing (never to whatever took its place)", async () => {
    const page = await (await newContext(browser)).newPage();
    await page.setContent(`<a href="https://tool.test/a.mp4">Download</a>`);
    const [control] = await listControls(page);
    await page.setContent(`<a href="https://ads.test/x">Download</a>`);
    assert.equal(await controlHandle(page, control), null);
});

test("clickable divs that name a download are controls; plain text and their inner spans are not", async () => {
    const page = await (await newContext(browser)).newPage();
    await page.setContent(`<div style="cursor:pointer"><span>Save Photo 1</span></div><div style="cursor:pointer">About us</div><p>Download text</p>`);
    const texts = (await listControls(page)).map((c) => c.text);
    assert.deepEqual(texts, ["Save Photo 1"]);
});

test("works on a page whose Content Security Policy forbids scripts", async () => {
    const page = await (await newContext(browser)).newPage();
    await page.route("https://csp.test/", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/html", "content-security-policy": "script-src 'none'" }, body: `<a href="https://tool.test/v.mp4">Download HD</a>` }));
    await page.goto("https://csp.test/");
    const [control] = await listControls(page);
    assert.equal(control.text, "Download HD");
    assert.ok(await controlHandle(page, control));
});
