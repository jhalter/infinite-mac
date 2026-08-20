import {
    type EmulatorEthernetProvider,
    type EmulatorEthernetProviderDelegate,
} from "@/emulator/ui/ui";
import {createTcpBridgeNetwork} from "./tcp-bridge/tcp-bridge-network.mjs";

/**
 * Gives the emulated Mac a fake router (ARP/DHCP/DNS/ICMP) and terminates its
 * TCP connections in the page, bridging each one to a real server over a
 * WebSocket tunnel (used here to reach live Hotline servers and trackers).
 *
 * Configure the guest's TCP/IP (or MacTCP) control panel to use Ethernet with
 * DHCP, or manually: IP 192.168.86.100, mask 255.255.255.0, router and DNS
 * 192.168.86.1.
 */
export class HotlineEthernetProvider implements EmulatorEthernetProvider {
    #delegate?: EmulatorEthernetProviderDelegate;
    #macAddress?: string;
    #net: {handleGuestFrame: (frame: Uint8Array) => void};

    constructor() {
        this.#net = createTcpBridgeNetwork({
            sendToGuest: (frame: Uint8Array) => this.#delegate?.receive(frame),
            bridgeUrl: "wss://morphing.cloud/hotline-bridge/connect",
            log: (message: string) => console.log("[hotline]", message),
        });
    }

    description(): string {
        return "Hotline";
    }

    macAddress(): string | undefined {
        return this.#macAddress;
    }

    init(macAddress: string): void {
        this.#macAddress = macAddress;
    }

    send(destination: string, packet: Uint8Array): void {
        // All guest frames go to the in-page network stack, which answers as
        // the router and the whole fake internet. (destination is Infinite
        // Mac's routing hint; the stack routes by the frame contents.)
        this.#net.handleGuestFrame(packet);
    }

    setDelegate(delegate: EmulatorEthernetProviderDelegate): void {
        this.#delegate = delegate;
    }
}
