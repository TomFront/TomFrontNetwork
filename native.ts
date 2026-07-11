/*
 * TomFrontNetwork native module
 *
 * Fetches the network manifest from the main (Node/Electron) process, which is
 * NOT subject to the renderer's Content-Security-Policy. This is why the plugin
 * can reach tomfront-socials.workers.dev even though a renderer-side fetch would
 * be blocked by Discord's CSP.
 */

import { IpcMainInvokeEvent } from "electron";

export async function fetchNetwork(_: IpcMainInvokeEvent, url: string): Promise<string | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
}
