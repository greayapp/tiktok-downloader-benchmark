// The browser every test uses: the installed Google Chrome (stable), driven by
// Playwright, unmodified — no stealth tricks; it identifies as automated like any
// test browser (SPEC.md §5.1). A fresh context (profile) per tool per run.
import { chromium } from "playwright-core";

export const DESKTOP = {
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
};

/** Android Chrome emulation (SPEC.md §5.1): 390×844, touch, mobile user agent. */
export function mobileProfile(chromeMajor) {
    return {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`,
    };
}

/**
 * Launch Chrome. Headed by default (a normal window, placed off-screen so it
 * doesn't get in the way); `headless: true` for quick local checks only.
 */
export async function launchBrowser({ headless = false } = {}) {
    return chromium.launch({
        channel: "chrome",
        headless,
        args: ["--window-position=-2400,0", "--window-size=1400,900", "--no-default-browser-check", "--no-first-run"],
    });
}

export async function newContext(browser, { mobile = false } = {}) {
    const major = browser.version().split(".")[0];
    return browser.newContext({
        ...(mobile ? mobileProfile(major) : DESKTOP),
        acceptDownloads: true,
        locale: "en-US",
    });
}
