// In-page network for a browser client that needs raw TCP: a fake router (vendored v86
// fake_network.js) gives the emulated machine DHCP/ARP/DNS/ICMP for free and terminates its
// TCP connections in JavaScript, splicing each one to a WebSocket-to-TCP bridge Worker.
//
// Hostnames the guest looks up are resolved to fake IPs from a private pool and mapped back
// to the hostname, so the bridge dials the real host by name; a connection to a literal IP
// (e.g. a server address the guest already knows) is bridged by IP.
//
// The same module serves the Node test harness and the Infinite Mac EmulatorEthernetProvider;
// only the frame-delivery callback differs.

import {
    create_eth_encoder_buf,
    handle_fake_networking,
} from "./fake_network.js";

export const ROUTER_IP = [192, 168, 86, 1];
export const GUEST_IP = [192, 168, 86, 100];
// The Infinite Mac guest driver (ether_js.cpp) drops unicast frames whose destination MAC
// does not start with 0xb2, so the router's MAC must.
export const ROUTER_MAC = [0xb2, 0x0b, 0x1e, 0xc0, 0x01, 0x01];

// Resolved hostnames get a fake IP from this /24 (off the guest subnet, so the guest routes
// them via our gateway), mapped back to the hostname for the bridge.
export const DNS_POOL_PREFIX = [192, 168, 88];

/**
 * @param {Object} options
 * @param {(frame: Uint8Array) => void} options.sendToGuest - deliver a frame to the guest NIC.
 *        MUST NOT synchronously feed a response frame back into handleGuestFrame: the stack
 *        calls this mid-pump and reentry corrupts TCP connection state. Infinite Mac's
 *        ring-buffer delivery is naturally asynchronous; tests must queueMicrotask.
 * @param {string} options.bridgeUrl - WebSocket-to-TCP bridge base URL (the stack appends
 *        ?host=&port= per connection).
 * @param {(msg: string) => void} [options.log]
 */
export function createTcpBridgeNetwork({sendToGuest, bridgeUrl, log = () => {}}) {
    // Dynamic DNS: hostname <-> assigned fake IP (dotted string).
    const hostToIp = new Map();
    const ipToHost = new Map();
    let nextOctet = 1;

    function resolveHost(name) {
        let dotted = hostToIp.get(name);
        if (!dotted) {
            if (nextOctet > 254) return null; // pool exhausted
            dotted = [...DNS_POOL_PREFIX, nextOctet++].join(".");
            hostToIp.set(name, dotted);
            ipToHost.set(dotted, name);
        }
        return dotted.split(".").map(Number);
    }

    const adapter = {
        router_mac: Uint8Array.from(ROUTER_MAC),
        router_ip: Uint8Array.from(ROUTER_IP),
        vm_ip: Uint8Array.from(GUEST_IP),
        masquerade: true,
        dns_method: "static",
        tcp_conn: {},
        eth_encoder_buf: create_eth_encoder_buf(),
        // v86 bus stub; fake_network only uses pair.send as a notification.
        bus: {register() {}, send() {}, pair: {send() {}}},
        // make_packet returns a subarray of the shared encoder buffer: copy before
        // handing the frame to (possibly asynchronous) delivery.
        receive: (frame) => sendToGuest(frame.slice()),
        dns_resolve: (labels) => {
            const name = labels.filter(Boolean).join(".").toLowerCase();
            const ip = resolveHost(name);
            log(`dns ${name} -> ${ip ? ip.join(".") : "pool exhausted"}`);
            return ip;
        },
        on_tcp_connection: (conn, packet) => {
            const dest = Array.from(packet.ipv4.dest).join(".");
            const port = packet.tcp.dport;
            // A DNS-resolved hostname (bridge by name) or a raw IP literal (bridge by IP).
            const host = ipToHost.get(dest) ?? dest;
            log(`tcp ${dest}:${port} -> bridge ${host}:${port}`);
            acceptBridge(conn, packet, host, port);
        },
    };

    function acceptBridge(conn, packet, host, port) {
        conn.accept(packet);
        const ws = new WebSocket(
            `${bridgeUrl}?host=${encodeURIComponent(host)}&port=${port}`
        );
        ws.binaryType = "arraybuffer";
        const pending = [];
        ws.onopen = () => {
            for (const chunk of pending) ws.send(chunk);
            pending.length = 0;
        };
        ws.onmessage = (event) => conn.write(new Uint8Array(event.data));
        ws.onclose = () => conn.close();
        ws.onerror = () => conn.close();
        conn.on("data", (data) => {
            if (ws.readyState === WebSocket.CONNECTING) pending.push(data.slice());
            else if (ws.readyState === WebSocket.OPEN) ws.send(data.slice());
        });
        const closeWS = () => {
            if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        };
        conn.on("shutdown", closeWS);
        conn.on("close", closeWS);
    }

    return {
        adapter,
        handleGuestFrame: (frame) => handle_fake_networking(frame, adapter),
    };
}
