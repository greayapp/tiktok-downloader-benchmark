// The tools in the current edition (SPEC.md Appendix A). An adapter only
// overrides what the generic, label-based flow (generic.mjs) gets wrong for
// that site; everything else is shared, so every tool is driven the same way.
export const TOOLS = [
    { name: "SnapTik", domain: "snaptik.app", url: "https://snaptik.app/en3" },
    { name: "SSSTik", domain: "ssstik.io", url: "https://ssstik.io/" },
    { name: "MusicalDown", domain: "musicaldown.com", url: "https://musicaldown.com/en" },
    { name: "TikMate", domain: "tikmate.app", url: "https://tikmate.app/" },
    { name: "SaveTik", domain: "savetik.co", url: "https://savetik.co/" },
    { name: "TTDownloader", domain: "ttdownloader.com", url: "https://ttdownloader.com/" },
    { name: "TikWM", domain: "tikwm.com", url: "https://tikwm.com/" },
    { name: "LoveTik", domain: "lovetik.com", url: "https://lovetik.com/" },
    { name: "TikTokio", domain: "tiktokio.com", url: "https://tiktokio.com/" },
    { name: "TikDown", domain: "tikdown.org", url: "https://tikdown.org/" },
    { name: "TikCD", domain: "tikcd.com", url: "https://tikcd.com/" },
    { name: "inDown", domain: "indown.io", url: "https://indown.io/en5" },
    { name: "TTSave", domain: "ttsave.net", url: "https://ttsave.net/" },
    { name: "GetTikVideo", domain: "gettikvideo.com", url: "https://gettikvideo.com/", operator: true },
];

/** The tool's entry merged with its adapter (src/adapters/<domain>.mjs), if any. */
export async function loadAdapter(tool) {
    try {
        const mod = await import(`./adapters/${tool.domain}.mjs`);
        return { ...tool, ...mod.default };
    } catch (e) {
        if (e.code === "ERR_MODULE_NOT_FOUND") return { ...tool };
        throw e;
    }
}
