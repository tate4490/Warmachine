# Wartable Local — Warmachine MKIV Virtual Tabletop

Local replacement for wartable.online/modules/Warmachine.  
Full VTT board, multiplayer, army builder, dice roller, damage tracker.

---

## Prerequisites

- **Node.js v16+** — download from https://nodejs.org

---

## Setup

```bash
cd "C:\Users\karlh\Documents\Claude\Projects\Wartable"
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

To run on a different port:
```bash
PORT=8080 npm start
```

---

## Multiplayer

Both players open `http://localhost:PORT` on machines that can reach your computer.

1. Player 1 clicks **Create Room** → gets a 4-character code (e.g. `AB3X`)
2. Player 2 enters the code and clicks **Join**
3. All token moves, dice rolls, damage, and chat sync in real time

If both players are on the same machine (hot-seat), use **Play Solo** instead.

---

## Unit Data (optional)

The VTT board works fully without any unit data — you can add custom tokens by name.

For unit stats, card reference, and auto-deployment from the army builder, add data in one of two ways:

### Option A — warmachine-data npm package (MKIV Prime armies)

```bash
npm install warmachine-data
npm start   # restart after installing
```

Factions with a ✓ in the dropdown have data loaded. Currently covers MKIV Prime armies.  
See: https://github.com/kirkbushell/warmachine-data

### Option B — Your own JSON files (any faction, including Legacy)

Create a `data/` folder next to `server.js` and add files named by faction ID:

```
data/
  cygnar.json
  khador-legacy.json
  trollbloods.json
  ...
```

Each file should be an object keyed by unit ID:
```json
{
  "ironFangPikemen": {
    "name": "Iron Fang Pikemen",
    "type": "infantry",
    "stats": { "spd": 5, "str": 8, "mat": 7, "rat": 4, "def": 12, "arm": 16, "cmd": 9 },
    "cost": 11,
    "abilities": ["Shield Wall", "Black Dragon"]
  },
  "vlad1": {
    "name": "Vladimir Tzepesci",
    "type": "warcaster",
    "focus": 7,
    "stats": { "spd": 6, "str": 8, "mat": 7, "rat": 5, "def": 16, "arm": 16, "cmd": 9 },
    "cost": 18,
    "abilities": ["Blood of Kings", "Forced March", "Hand of Fate"]
  }
}
```

Local data takes priority over the npm package, so you can override any entry.

---

## Controls

| Action | Input |
|--------|-------|
| Move token | Drag |
| Select token | Click |
| Context menu | Right-click |
| Measure distance | **M** key or button, then click start/end |
| Zoom | Scroll wheel / **+** / **-** |
| Fit board | **0** key or ⊡ button |
| Pan | Middle-click drag |
| Delete selected | **Delete** key |
| Cancel / deselect | **Escape** |

---

## Features

- **Game board** — 48"×48" Warmachine table with 1" grid and 6" major divisions
- **Tokens** — draggable, faction-colored with correct base sizes (30/40/50/120mm)
- **Damage tracker** — click-to-fill boxes, configurable max; color shifts red as damage accumulates
- **Focus/Fury** — pip display with click or +/− buttons
- **Effects** — Knocked Down, Stationary, Blind, Fire, Corrosion, Disrupted; colored ring on token
- **Dice** — 1d6/2d6/3d6/4d6 presets plus custom NdX; full history; all rolls broadcast to opponent
- **Army builder** — browse faction units, deploy to board; custom token add for any name/base size
- **Card reference** — search all loaded units, view stats and abilities
- **Multiplayer** — real-time sync of token positions, damage, effects, dice, and chat via Socket.io
- **Chat** — in-game text chat in the bottom-right panel

---

## Notes on Legacy Data

The `warmachine-data` package currently covers **MKIV Prime armies only** (Khador Winter Korps, Storm Legion, Cryx Shadowflame Cadre, etc.). Legacy/Unlimited factions are not included in that package. Use Option B (local JSON files) to add Legacy units. Community-maintained Legacy data files, if you find them, can be dropped directly into `data/`.

The board, dice, and token features work fully regardless of whether unit data is installed.

---

## Troubleshooting

**"Cannot find module 'express'"** — run `npm install` first.

**Board is blank / tokens don't appear** — make sure Konva loaded. Check browser console for errors. The CDN URL is `https://unpkg.com/konva@9/konva.min.js` — you need an internet connection on first load, or replace it with a local copy.

**Multiplayer doesn't sync** — both players must reach the same server. If playing over a local network, use your LAN IP (e.g. `http://192.168.1.x:3000`) instead of `localhost`.
