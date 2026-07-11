# TomFrontNetwork

A [Vencord](https://vencord.dev) userplugin that visually badges servers in the **TomFront network** using Discord's own native rendering:

- **Partnered servers** show the Discord **Partnered** badge, and their owner gets the **Partnered Server Owner** badge on their profile.
- **Content-creator servers** show the **Verified** check.
- A server can be both **Verified & Partnered**.

The network list is fetched live from tomfront.com, so it stays up to date automatically.

> [!IMPORTANT]
> This plugin is **100% client-side and purely cosmetic**. It only changes what *you* see on *your* client — nothing is sent to Discord's servers, and it is **not** real Discord verification or partnership. It only badges servers you're a member of.

## Requirements

You need Vencord installed **from source** (userplugins are not supported by the normal one-click installer). If you haven't set that up yet, follow Vencord's guide:
https://docs.vencord.dev/installing/custom-plugins/

In short, you need: [Git](https://git-scm.com/), [Node.js](https://nodejs.org/), and [pnpm](https://pnpm.io/) (`npm i -g pnpm`), then a source clone of Vencord.

## Installation

From the root of your **Vencord source folder**, create the userplugins folder if needed and clone this repo into it:

```bash
# (only if it doesn't already exist)
mkdir -p src/userplugins

git clone https://github.com/YOUR_USERNAME/TomFrontNetwork.git src/userplugins/TomFrontNetwork
```

Then build and inject:

```bash
pnpm build
pnpm inject   # skip if Vencord is already injected into Discord
```

Finally:

1. **Fully quit and reopen Discord** (a `Ctrl+R` reload is **not** enough — this plugin has a native module that runs in the main process).
2. Open **User Settings → Vencord → Plugins**, search **TomFrontNetwork**, and enable it.

## Updating

```bash
cd src/userplugins/TomFrontNetwork
git pull
cd ../../..
pnpm build
```

Then fully restart Discord.

## Uninstalling

Disable the plugin in Vencord settings, delete the `src/userplugins/TomFrontNetwork` folder, run `pnpm build`, and restart Discord.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
