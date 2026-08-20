// Minimal stand-ins for the v86 internals fake_network.js imports, so the
// vendored file runs standalone. Set globalThis.TCP_BRIDGE_DEBUG = true to see
// the stack's debug logging.

export const LOG_FETCH = "net";

// Hex formatter (v86's h()): used only in debug log messages.
export function h(n, len = 1) {
    return "0x" + (n >>> 0).toString(16).padStart(len, "0");
}

export function dbg_assert(cond, msg) {
    if (!cond) console.warn("netstack assert failed:", msg ?? "");
}

export function dbg_log(msg, _level) {
    if (globalThis.TCP_BRIDGE_DEBUG) console.log("[netstack]", msg);
}
