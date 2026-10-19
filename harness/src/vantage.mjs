// The test machine's vantage point (SPEC.md §5.1): its country and nearest
// Cloudflare location, and the download bandwidth, recorded at the start of
// each run. The IP address is never recorded.
//
// The tests must run on the residential connection. A run started elsewhere
// (a VPN left on after capturing references) is refused unless --any-vantage.

const EXPECTED = process.env.TDB_COUNTRY ?? "IN";

/** Country and Cloudflare location from Cloudflare's trace endpoint. */
export async function location() {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(10_000) });
    const kv = Object.fromEntries((await res.text()).split("\n").filter(Boolean).map((l) => l.split("=")));
    return { country: kv.loc ?? null, cloudflareColo: kv.colo ?? null };
}

/** Download speed in Mbit/s: 25 MB from Cloudflare's speed test, timed to the last byte. */
export async function bandwidth(bytes = 25_000_000) {
    const started = performance.now();
    const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}`, { signal: AbortSignal.timeout(120_000) });
    let got = 0;
    for await (const chunk of res.body) got += chunk.length;
    const seconds = (performance.now() - started) / 1000;
    return { mbps: Math.round((got * 8) / seconds / 1e5) / 10, bytes: got, seconds: Math.round(seconds * 10) / 10 };
}

/**
 * Records the vantage point; throws when the machine is not where the tests
 * must run from (`expected` country) unless `allowAny`.
 */
export async function checkVantage({ allowAny = false, measureBandwidth = true } = {}) {
    const loc = await location();
    if (!allowAny && loc.country !== EXPECTED) {
        throw new Error(`the test machine appears to be in ${loc.country}, not ${EXPECTED}: the tests run on the residential connection (is a VPN on?). Use --any-vantage to run anyway.`);
    }
    return { ...loc, expectedCountry: EXPECTED, bandwidth: measureBandwidth ? await bandwidth().catch((e) => ({ error: e.message })) : null, at: new Date().toISOString() };
}
