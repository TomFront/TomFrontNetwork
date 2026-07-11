/*
 * TomFrontNetwork, a Vencord userplugin
 * Copyright (c) 2026 tomfront
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * TomFrontNetwork — a Vencord userplugin
 *
 * Client-side, cosmetic "network" badges driven by tomfront.com. It fetches the
 * live network manifest (tomfront.com/network) and, using Discord's OWN native
 * rendering, makes:
 *   - Partnered servers  → read as Discord PARTNERED
 *   - Content-creator servers → read as VERIFIED
 *   - (a server can be both)
 *   - Each partnered server's OWNER → gets the real "Partnered Server Owner"
 *     profile badge (by their user ID), so it shows when you view their profile.
 *
 * It injects the real "VERIFIED" / "PARTNERED" feature strings into GuildStore,
 * GuildProfileStore and InviteStore (native header/tooltip/card/invite rendering),
 * and the genuine partner badge object into the relevant profiles' `badges` array.
 *
 * Everything is client-side and cosmetic — it only changes what YOU see on YOUR
 * client, and nothing is ever sent to Discord's servers. The manifest is managed
 * by the /website partners and /website contentcreators slash commands.
 *
 * NOTE: this is deliberately, transparently NOT real verification/partnership —
 * it just visually distinguishes servers in the TomFront network on your client.
 */

import definePlugin, { PluginNative } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { GuildStore, UserStore } from "@webpack/common";

// Fetch runs in the main process (see native.ts) so it isn't blocked by the
// renderer's Content-Security-Policy.
const Native = VencordNative.pluginHelpers.TomFrontNetwork as PluginNative<typeof import("./native")>;

const UserProfileStore = findStoreLazy("UserProfileStore");
const GuildProfileStore = findStoreLazy("GuildProfileStore");
const InviteStore = findStoreLazy("InviteStore");

const NETWORK_URL = "https://tomfront-socials.thomasimpact542.workers.dev/network";
const REFRESH_MS = 30 * 1000;          // background poll
const ACTIVITY_THROTTLE_MS = 8 * 1000; // min gap between activity-triggered refetches

// The real Discord "Partnered Server Owner" profile badge object. Discord builds
// the icon URL from the `icon` hash, so this is the genuine badge.
const PARTNER_BADGE = {
    id: "partner",
    description: "Partnered Server Owner",
    icon: "3f9748e53446a137a052f3454e2de41e",
    link: "https://discord.com/partners"
} as const;

const OUR_MARK = "__tfNetwork";

// ─── Live network data ────────────────────────────────────────────────────────

type Network = { partnered: string[]; verified: string[]; partnerOwners: string[]; };
let network: Network = { partnered: [], verified: [], partnerOwners: [] };
let refreshTimer: any = null;
let lastFetch = 0;

async function fetchNetwork() {
    lastFetch = Date.now();
    try {
        const text = await Native.fetchNetwork(NETWORK_URL);
        if (!text) return;
        const data = JSON.parse(text);
        network = {
            partnered: Array.isArray(data?.partnered) ? data.partnered.map(String) : [],
            verified: Array.isArray(data?.verified) ? data.verified.map(String) : [],
            partnerOwners: Array.isArray(data?.partnerOwners) ? data.partnerOwners.map(String) : []
        };
        sync();
    } catch { /* offline / blocked — keep last known data */ }
}

// Fires on store changes (navigating channels/DMs/profiles). Applies the current
// data immediately, and refetches (throttled) so a just-run slash command shows up
// within seconds as you move around — no Ctrl+R needed.
function onActivity() {
    sync();
    if (Date.now() - lastFetch > ACTIVITY_THROTTLE_MS) fetchNetwork();
}

// ─── Which network guilds are loaded in this client ───────────────────────────

// Feature strings this network wants for a given guild id.
function featuresForGuild(id: string): string[] {
    const f: string[] = [];
    if (network.partnered.includes(id)) f.push("PARTNERED");
    if (network.verified.includes(id)) f.push("VERIFIED");
    return f;
}

// Network guilds that actually exist in this client (you're a member of).
function networkGuilds(): { guild: any; features: string[]; }[] {
    const guilds = GuildStore.getGuilds() as Record<string, any>;
    const ids = new Set([...network.partnered, ...network.verified]);
    const result: { guild: any; features: string[]; }[] = [];
    for (const id of ids) {
        const guild = guilds[id];
        if (guild) result.push({ guild, features: featuresForGuild(id) });
    }
    return result;
}

// ─── Native-data injection ────────────────────────────────────────────────────

// Track exactly which feature strings WE added to each guild, so we never remove
// a server's genuine features.
const injectedFeatures = new Map<string, Set<string>>();

function syncGuildFeatures() {
    const wanted = new Map<string, Set<string>>();
    for (const { guild, features } of networkGuilds())
        wanted.set(guild.id, new Set(features));

    // Remove features we previously injected that are no longer wanted.
    for (const [id, mine] of [...injectedFeatures]) {
        const want = wanted.get(id) ?? new Set<string>();
        const guild = GuildStore.getGuild(id);
        for (const f of [...mine]) {
            if (!want.has(f)) {
                guild?.features?.delete?.(f);
                mine.delete(f);
            }
        }
        if (mine.size === 0) injectedFeatures.delete(id);
    }

    // Add wanted features, recording only the ones that weren't already there.
    for (const [id, features] of wanted) {
        const guild = GuildStore.getGuild(id);
        if (!guild?.features?.add) continue;
        let mine = injectedFeatures.get(id);
        for (const f of features) {
            if (!guild.features.has(f)) {
                guild.features.add(f);
                if (!mine) injectedFeatures.set(id, (mine = new Set()));
                mine.add(f);
            }
        }
    }
}

// Add feature strings to an object's plain-array `features`, replacing the array
// (rather than mutating) in case it's frozen.
function addArrayFeatures(obj: any, features: string[]) {
    if (!obj || !Array.isArray(obj.features)) return;
    const missing = features.filter(f => !obj.features.includes(f));
    if (missing.length) {
        try { obj.features = [...obj.features, ...missing]; } catch { /* not writable */ }
    }
}

// The "server profile" card reads GuildProfileStore, which has its OWN plain-array
// `features` — separate from the GuildStore record.
function syncGuildProfiles() {
    if (!GuildProfileStore?.getProfile) return;
    for (const { guild, features } of networkGuilds())
        addArrayFeatures(GuildProfileStore.getProfile(guild.id), features);
}

// The invite embed renders from resolved invites in InviteStore.
function syncInvites() {
    if (!InviteStore) return;
    const owned = networkGuilds();
    if (!owned.length) return;

    const patch = (inv: any, features: string[]) => {
        addArrayFeatures(inv?.guild, features);
        addArrayFeatures(inv?.profile, features);
    };

    for (const { guild, features } of owned) {
        const code = InviteStore.getInviteKeyForGuildId?.(guild.id);
        if (code) patch(InviteStore.getInvite?.(code), features);
    }

    const all = InviteStore.getInvites?.();
    if (all) {
        for (const inv of (Array.isArray(all) ? all : Object.values(all)) as any[]) {
            const match = owned.find(o => o.guild.id === inv?.guild?.id);
            if (match) patch(inv, match.features);
        }
    }
}

// Insert the partner badge into a profile's `badges` array (replacing it, since
// Discord freezes it), positioned right after Nitro/premium badges.
function injectPartnerBadge(profile: any) {
    if (!profile || !Array.isArray(profile.badges)) return;
    const badges: any[] = profile.badges;
    const hasReal = badges.some(b => b?.id === PARTNER_BADGE.id && !b?.[OUR_MARK]);
    const hasOurs = badges.some(b => b?.[OUR_MARK]);
    if (hasReal || hasOurs) return;

    let idx = 0;
    while (idx < badges.length && String(badges[idx]?.id).startsWith("premium")) idx++;
    const next = [...badges.slice(0, idx), { ...PARTNER_BADGE, [OUR_MARK]: true }, ...badges.slice(idx)];
    try { profile.badges = next; } catch { /* not writable in this build */ }
}

function removePartnerBadge(profile: any) {
    if (!profile || !Array.isArray(profile.badges)) return;
    if (profile.badges.some((b: any) => b?.[OUR_MARK])) {
        try { profile.badges = profile.badges.filter((b: any) => !b?.[OUR_MARK]); } catch { /* ignore */ }
    }
}

// Give every partnered-server owner (by user id) the native partner badge on
// whatever profiles are currently loaded. Always on — this is how the network
// distinguishes partnered server owners.
function syncProfileBadges() {
    if (!UserProfileStore?.getUserProfile) return;
    for (const userId of network.partnerOwners) injectPartnerBadge(UserProfileStore.getUserProfile(userId));
}

function sync() {
    syncGuildFeatures();
    syncGuildProfiles();
    syncInvites();
    syncProfileBadges();
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "TomFrontNetwork",
    description: "Visually badge servers in the TomFront network — partnered (+ owner badge) and content-creator (verified) — using Discord's own native rendering. Client-side & cosmetic; data from tomfront.com.",
    authors: [{ name: "tomfront", id: 175656408459640832n }],

    async start() {
        // Re-apply (and throttle-refetch) whenever relevant data is (re)loaded or updated.
        GuildStore.addChangeListener(onActivity);
        UserStore.addChangeListener(onActivity);
        UserProfileStore?.addChangeListener?.(onActivity);
        GuildProfileStore?.addChangeListener?.(onActivity);
        InviteStore?.addChangeListener?.(onActivity);

        await fetchNetwork();
        refreshTimer = setInterval(fetchNetwork, REFRESH_MS);
    },

    stop() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = null;

        GuildStore.removeChangeListener(onActivity);
        UserStore.removeChangeListener(onActivity);
        UserProfileStore?.removeChangeListener?.(onActivity);
        GuildProfileStore?.removeChangeListener?.(onActivity);
        InviteStore?.removeChangeListener?.(onActivity);

        // Remove the guild features we injected.
        for (const [id, mine] of injectedFeatures) {
            const guild = GuildStore.getGuild(id);
            for (const f of mine) guild?.features?.delete?.(f);
        }
        injectedFeatures.clear();

        // Remove any partner badges we injected into owner profiles.
        for (const userId of network.partnerOwners)
            removePartnerBadge(UserProfileStore?.getUserProfile?.(userId));
    }
});
