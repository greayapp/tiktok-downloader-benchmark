// One test at a time on the test machine's line (SPEC.md §5.1): an edition run and the daily
// monitor each hold a lock file while they run, and neither runs while the other holds its lock.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache");
const file = (name) => join(DIR, `${name}.lock`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** The holder of `name`'s lock if a live process holds it, else null (a stale lock is ignored). */
export function heldBy(name) {
    if (!existsSync(file(name))) return null;
    try {
        const l = JSON.parse(readFileSync(file(name), "utf8"));
        return alive(l.pid) ? l : null;
    } catch { return null; }
}

/** Takes `name`'s lock for this process until it exits. */
export function take(name, info = {}) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file(name), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), ...info }));
    const release = () => { try { if (JSON.parse(readFileSync(file(name), "utf8")).pid === process.pid) rmSync(file(name)); } catch { /* gone */ } };
    process.on("exit", release);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { release(); process.exit(130); });
}
