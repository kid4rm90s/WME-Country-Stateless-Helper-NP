# WME Country Stateless Helper NP

A [Waze Map Editor](https://www.waze.com/editor/) userscript that automatically detects when a Nepali city is assigned to a segment or venue and strips any auto-added state (e.g. Uttar Pradesh). Nepal has not any states configured in WME yet — this script prevents cross-border state/country ID conflicts from occurring.

## Features

- **Automatic State Stripping** — Detects incorrect state assignments on segments and venues with Nepali cities and resets them to the "no-state" default.
- **Real-time Interception** — Fixes addresses as soon as WME (or another script) applies a state, before the change is saved.
- **Save-time Cleanup** — Also checks and corrects addresses when objects are committed to the server.
- **Undo/Redo Safe** — Briefly suspends correction after undo so the undo stack works naturally.
- **Future-proof** — If Nepal ever gains states in WME, the script automatically detects this and stops interfering.
- **Visual Feedback** — Uses [WazeToastr](https://greasyfork.org/scripts/560385) for toast notifications on key actions.

## Installation

### Prerequisites

- [Tampermonkey](https://www.tampermonkey.net/) browser extension (Chrome, Firefox, Edge, etc.)

### Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Click the install link: **[Install Script](https://raw.githubusercontent.com/kid4rm90s/WME-Country-Stateless-Helper-NP/main/WME-Country-Stateless-Helper-NP.user.js)**
3. Tampermonkey will open the installation page — click **Install**.
4. Open the [Waze Map Editor](https://www.waze.com/editor/) and the script will activate automatically.

### Auto-Update

The script uses `@downloadURL` and `@updateURL` pointing to this repository, so Tampermonkey will automatically update when new versions are released.

## Usage

1. Open the [Waze Map Editor](https://www.waze.com/editor/) and center the map on Nepal.
2. The script activates automatically and displays a toast: *"Active — monitoring Nepal (ID X). Stateless mode: stripping auto-added states."*
3. When you assign a Nepali city to a segment or venue, any state automatically applied by WME is immediately stripped and reset to the "no-state" default.
4. Toast notifications inform you when corrections are made or saved.

### Debug Mode

To enable debug console logging, set `debug: true` in the `CONFIG` object inside the script:

```javascript
const CONFIG = {
  debug: true,
};
```

## Why This Exists

WME can sometimes auto-apply a state (like Uttar Pradesh, India) to segments and venues that have a Nepali city, especially in border areas. Since Nepal does not have states defined yet in WME, this creates incorrect address data that can cause issues downstream. This script automatically corrects those assignments.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.9 | 2026-07-21 | Integrated WazeToastr notifications; moved script update monitor into wme-ready |
| 2.0.8 | 2026-07-21 | Fixed no-state ID resolution |
| 2.0.7 | — | Initial SDK migration, undo/redo safety |

## Dependencies

- [WME SDK](https://www.waze.com/editor/sdk/) — Waze Map Editor SDK (injected by WME at runtime)
- [WazeToastr](https://greasyfork.org/scripts/560385) — Toast notification library (loaded via `@require`)

## Support

- **Issues:** [GitHub Issues](https://github.com/kid4rm90s/WME-Country-Stateless-Helper-NP/issues)

## License

[MIT](LICENSE)
