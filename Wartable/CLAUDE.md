# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
npm start          # production — node server.js
npm run dev        # development — node --watch server.js (auto-restarts on save)
```

No build step, no transpilation, no test suite. Server runs on port 3000 by default (`PORT` env var overrides).

---

## Project Purpose

Local replacement for wartable.online/modules/Warmachine — a Warmachine MKIV virtual tabletop. Reads game data directly from the user's locally-installed Warmachine App (encrypted JSON), serves it via Express, and provides a browser-based VTT with real-time multiplayer via Socket.io.

---

## Planned Page Architecture (in-progress migration)

The app is being split from a single `index.html` into separate pages. Each page gets its own JS file to keep sessions manageable.

| Route | File | Purpose |
|-------|------|---------|
| `/` | `index.html` + `js/home.js` | Home — Play / Build a Force / Cards / Library |
| `/game.html` | `js/game.js` | VTT board, tokens, dice, chat, army deploy |
| `/forces.html` | `js/forces.js` | Force list + force builder |
| `/cards.html` | `js/cards.js` | Full card reference browser (read-only) |
| `/library.html` | `js/library.js` | Publications browser |

State is passed lobby → game via URL params: `?room=AB3X&player=0&name=Andrew`.

**Current state:** The app still lives in the original `public/index.html` + `public/js/app.js`. The multi-page split has been planned but not yet implemented. Start there.

---

## Data Source: Warmachine App

All game data comes from the user's locally-installed Warmachine App.

```
C:\Users\<user>\AppData\LocalLow\Privateer Press\Warmachine App\
  public\mkiv-main\
    data general.json       ← MAIN DATA FILE (encrypted)
    data library.json       ← Publications/rules documents (encrypted)
  force-{name}-{guid}.json  ← Saved force lists (plain JSON)
```

Path is resolved dynamically via `os.homedir()` — never hardcode `karlh`.

### Decryption

All JSON files from the WM App may be encrypted. The same algorithm applies to all of them:

```
salt       = file bytes [0:32]
ciphertext = file bytes [32:]
derived    = PBKDF2(password='dlse0seb', salt, { hash: SHA1, iterations: 50000, outputLen: 48 })
key        = derived[0:32]   → AES-256-CFB
IV         = derived[32:48]
padding    = PKCS7 (verify before stripping)
```

Server function `readJsonFile(filePath)` handles both plain and encrypted files transparently. Force files (`force-*.json`) happen to be plain JSON and do not require decryption.

---

## data general.json — Confirmed Structure

After decryption, the top-level keys include:

```json
{
  "cards": [ ...cardObj ],
  "abilities": { "abilityName": "rules text", ... },
  "properties": { "weaponQualityName": "description", ... },
  "spells": { "spellName": { "text": "...", "stats": { ... } }, ... },
  "command cards": [ ...commandCardObj ],
  "rack": { ... }
}
```

**Also expected** (needed but not yet confirmed field names — probe at runtime):
- Armies collection: each army has a `guidStr`, display name, arena (Prime/Legacy)
- Match types: each has a `guidStr`, name (e.g. "Recon Mission"), point limit (e.g. 30)
- Cards: each has a `guidStr` matching `_cardId` values in force files

### Card object shape

```json
{
  "name": "Skin & Moans",
  "faction": "Grymkin",
  "type": "heavy warbeast",
  "portrait": "path/to/image",
  "cost": 12,
  "fa": "2",
  "keywords": ["Undead", "Grymkin"],
  "armies": ["Grymkin"],
  "spells": [...],
  "feat": { "Feat Name": "rules text" },
  "health": { "type": "spiral", "names": [...], "values": [6, 6, 6, ...] },
  "rules": { "abilityName": "full rules text", ... },
  "profiles": [
    {
      "name": "chassis",
      "stats": { "spd": 5, "str": 11, "mat": 7, "rat": 4, "def": 12, "arm": 18 },
      "weapons": [
        {
          "name": "Smite",
          "type": "Melee",
          "count": "1",
          "location": "Right",
          "stats": { "pow": 6 },
          "properties": ["Magical Weapon"]
        }
      ],
      "abilities": ["Aggression Dial"],
      "icons": [...]
    }
  ],
  "options": [...],
  "guidStr": "cb5187d1-adb7-4d58-b1c0-32adc877ffc9"
}
```

**Stat keys are lowercase** (`spd`, `str`, `mat`, `rat`, `def`, `arm`, `cmd`, `pow`, `rng`, `rof`, `aoe`). The Card Generator converts them to uppercase for display — keep them lowercase in our normaliser.

**Focus/fury/essence** come from profile stats or are inferred from unit type. Grymkin use Fury; the third mechanic (Essence) is used by one faction. All three are treated the same way in the UI (pip display).

**Damage boxes** = sum of `health.values` array (spiral rows).

**Base size** is inferred from `type` — not stored explicitly. Rule: colossal/gargantuan → huge (120mm); warjack/warbeast/cavalry → large (50mm); warcaster/warlock → medium (40mm); everything else → small (30mm). Base size is also the availability filter: 120mm bases excluded at < 75 pts.

---

## Force File Structure

Filename: `force-{_forceName}-{guidStr}.json`

```json
{
  "_forceName": "Command Starter",
  "_armyId": "cf86daa5-...",
  "_matchTypeId": "df967fd0-...",
  "guidStr": "4ba5f867-...",
  "_forceCards": [
    {
      "_cardId": "cb5187d1-...",
      "_attachedForceCardIds": ["2bc58942-..."],
      "_cardOption1Ids": [], "_cardOption2Ids": [],
      "guidStr": "f5cdfed0-..."
    }
  ],
  "_commandCardIds": ["a3c05ce1-...", ...],
  "isTempForce": false,
  "_isOppForce": false
}
```

All meaningful fields are GUIDs that require lookup in `data general.json`. There is **no point total, army name, or leader stored directly** — all must be computed:
- **Army name**: look up `_armyId` in armies index
- **Match type / points**: look up `_matchTypeId` in matchTypes index
- **Leader**: the card in `_forceCards` whose type is warcaster/warlock/caster (0 PC)
- **Point total**: sum of `cost` for all non-leader cards
- **Creation date**: filesystem `mtime`

The warcaster/warlock is free (not counted in point total). Its warjack/warbeast appears in `_attachedForceCardIds`.

### Force list sort options

Forces list supports these sort orders (all require resolved metadata):
- Date created (filesystem mtime)
- Army name → points low-to-high
- Army name → points high-to-low
- Leader name → points low-to-high
- Leader name → points high-to-low
- Points low-to-high → army name
- Points high-to-low → army name

Sorts with army or leader as primary sort **roll up** into collapsible groups. A "Collapse All" button toggles all groups.

---

## Server — Key Indexes (to build at startup)

`server.js` currently caches `data general.json` as a raw object. It needs three lookup indexes built once at load:

```javascript
cardsByGuid      // guidStr → card object
armiesByGuid     // guidStr → army object  
matchTypesByGuid // guidStr → matchType object
```

These power force file resolution without re-scanning the full data on every request.

---

## Server API (current endpoints)

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | WM App found/loaded flags, fallback data flags |
| `GET /api/wm-factions` | Array of `{ id, name }` derived from cards array |
| `GET /api/wm-units?faction=<slug>` | Normalised unit array, optionally filtered by faction slug |
| `GET /api/factions` | Fallback: faction IDs from npm package / local `data/` |
| `GET /api/units/:faction` | Fallback: keyed unit object from npm package / local `data/` |
| `GET /api/forces` | Array of `{ filename, name }` for all `force-*.json` files |
| `GET /api/force/:filename` | Parsed force file JSON (sanitised filename) |

**Needed new endpoints** for force builder:
- `GET /api/wm-armies` — armies list with guidStr, name, arena (Prime/Legacy)
- `GET /api/wm-matchtypes` — match types with guidStr, name, pointLimit
- `GET /api/wm-card/:guidStr` — single card with full detail including rules text
- `POST /api/force` — save new/updated force file to WM App folder
- `DELETE /api/force/:filename` — delete a force file

---

## Frontend Architecture (current single-page)

`public/js/app.js` — ~1100 lines, ES module, runs everything. Key sections:

- **Constants**: `BOARD_INCHES=48`, `PX_PER_INCH=14`, `BASE_RADIUS` (inches), `FACTIONS` map (9 MKIV + 14 Legacy with color + legacy flag)
- **Board**: Konva.js stage with gridLayer / tokenLayer / uiLayer. 48"×48" board. Zoom via `stage.scale`, pan via middle-click drag.
- **Tokens**: Konva Groups — shadow circle + base circle + damage overlay + effect ring + name text + player dot. `konvaTokens` map (id → Group).
- **Selection**: clicking a token thickens its stroke (strokeWidth 2→4), populates right panel.
- **Army builder**: `loadFactionList()` checks `/api/status`, builds faction dropdown. `loadFactionUnits(factionId)` tries WM data then fallback. `normalizeWMUnits()` maps server response to frontend unit shape.
- **Force files**: `loadForcesList()` + `loadForce()` + `extractForceUnits()` — currently only deploys tokens, does not resolve full card details.
- **Faction matching**: `findFactionKey(wmId, wmName)` fuzzy-matches WM faction slugs back to the `FACTIONS` color map.
- **Multiplayer**: Socket.io events — `createRoom`, `joinRoom`, `gameAction` (addToken/moveToken/updateToken/removeToken/clearBoard/endTurn), `rollDice`, `chatMessage`.
- **Dice**: server-side rolls in multiplayer; local rolls in solo mode.

### Unit data shape (frontend normalised)

```javascript
{
  id, key, name,
  faction,        // slug e.g. "khador"
  factionLabel,   // display name e.g. "Winter Korps (Khador)"
  factionColor,   // hex from FACTIONS map
  type,           // "warcaster", "heavy warjack", "infantry unit", etc.
  stats,          // { spd, str, mat, rat, def, arm, cmd, ... } lowercase
  focus,          // number or null
  fury,           // number or null
  threshold,      // number or null (Hordes)
  cost,           // point cost (number)
  damageBoxes,    // total damage capacity or null
  abilities,      // string[] — names only in current impl
  weapons,        // array of { name, type, count, loc, stats }
  keywords,       // string[]
  armies,         // string[] — army names this unit belongs to
  portrait,       // relative path string or null
  baseSize,       // "small" | "medium" | "large" | "huge"
}
```

---

## Related Project: Card Generator

Located at `C:\Users\karlh\Documents\Claude\Projects\Card Generator\`

A separate card-creation tool that also reads `data general.json`. Its `js/app.js` contains `parseJsonSimple()` — the reference implementation for parsing WM App card data. Key functions to understand before building the Cards or Library pages:

- `parseJsonSimple(data, jsonKey)` — parses the `cards` array into fully resolved card objects with faction backgrounds, icons, profiles, weapons, options
- `parseJsonDocument(data, jsonKey)` — renders publication JSON (Library page format)
- `decryptJsonFile()` — browser-side decryption using CryptoJS (same algorithm as server.js `decryptWMBuffer`)
- `addProfiles()` / `addStats()` / `addProfileWeapons()` — profile/weapon normalisation

The Card Generator uses its own `.ssccjson` card format for saved cards and has portrait images and faction background images that are candidates for use in Wartable's card display.

---

## Session Log

### Session 1–2
- Built full single-page VTT: `server.js`, `public/index.html`, `public/css/style.css`, `public/js/app.js`
- Features: 48×48" Konva board, draggable tokens, zoom/pan, damage tracker, focus/fury pips, effects, dice, chat, multiplayer via Socket.io rooms

### Session 3
- Rewrote `server.js`: WM App decryption (PBKDF2-SHA1 + AES-256-CFB), dynamic user path via `os.homedir()`, force file loading, flexible data extractors
- Updated `app.js`: WM data consumption, force file list + loading, faction fuzzy-matching

### Session 4
- Read Card Generator source (`cards.js`, `loader.js`, `app.js`) — confirmed data shapes
- Updated `server.js` WM extractors to use confirmed `data general.json` structure (`cards` array, `rules` object for abilities, `profiles[0].stats` for stats)
- Updated `app.js` `normalizeWMUnits`, added `findFactionKey`, added `fury`/`threshold`/`armies`/`portrait` fields, `damageBoxes` from health spiral sum
- Confirmed force file structure from sample: all fields are GUIDs, army/leader/points must be resolved from main data
- Decided on multi-page architecture; designed page split
- Confirmed game types defined in `data general.json`; base size is the only availability filter; mercs filter desired; essence is third caster mechanic (one faction); publications in `data library.json` alongside `data general.json`

### Session 5
- Created `public/home.html` + `public/js/home.js` — landing page with 4 navigation tiles (Play, Build a Force, Cards, Library). Play tile expands inline form with Solo / Create Room / Join Room. Other tiles show "coming soon". No socket in home.js — all socket setup in game.js.
- Created `public/game.html` + `public/js/game.js` — game page reads state from URL params (`?mode=solo|multiplayer&name=...&room=...`). Waiting banner shown when creating a room. Home link in top bar. Socket auto-creates or joins room on connect.
- Updated `server.js`: added `cardsByGuid`, `armiesByGuid`, `matchTypesByGuid` GUID indexes built at startup; added `/api/wm-armies`, `/api/wm-matchtypes`, `/api/wm-card/:guidStr` endpoints. Field name probing for armies/matchtypes (not confirmed in data yet).
- Old `public/index.html` + `public/js/app.js` kept untouched.

**URL convention for game.html:**
- Solo:        `/game.html?mode=solo&name=Andrew`
- Create room: `/game.html?mode=multiplayer&name=Andrew`
- Join room:   `/game.html?mode=multiplayer&name=Andrew&room=AB3X`

### Session 6
- Built `public/forces.html` + `public/js/forces.js` — full force list + builder.
  - List view: force cards with resolved army, leader, points, match type; sort dropdown (date, army, leader, points); group headers for army/leader sorts; collapse-all toggle.
  - Builder view: panel layout — left unit browser (army select, match type select, type filter pills, search, scrollable unit list) + right force roster (setup info, roster entries, points progress bar, save/delete).
  - New force or edit existing force both open builder with state pre-populated.
  - Saves/deletes via `POST /api/force` and `DELETE /api/force/:filename`.
- Updated `server.js`:
  - `resolveForce(filePath)` — resolves army name, match type, leader card, point total from a force file using GUID indexes.
  - `GET /api/forces-resolved` — returns fully resolved force summaries for the list view.
  - `POST /api/force` — saves/overwrites a force file; auto-generates filename if not provided.
  - `DELETE /api/force/:filename` — deletes a force file.
  - Added `guidStr` to `wmNormaliseUnit` output.
  - Added `?armyName=` filter to `/api/wm-units`.
- Enabled "Build a Force" tile on `home.html` (removed `disabled` class and "Soon" badge); `home.js` navigates to `/forces.html` on click.

### Session 7
- Overhauled `public/forces.html` + `public/js/forces.js` — builder UI redesign.
  - **Edition filter**: MKIV / Legacy radio buttons; "Include Legends" checkbox (MKIV only); "Show Mercenaries" checkbox. Army dropdown filters by selected edition using army `arena` field.
  - **Categorized browser**: pre-expanded collapsible sections — Leader(s), Cohort (Warjacks/Warbeasts), Units, Solos, Command Attachments, Battle Engines, Other, Mercenaries. Section labels adapt to army type (Warcasters/Warlocks, Warjacks/Warbeasts).
  - **Card detail panel**: center column appears when a unit is clicked. Shows full stat bar (SPD/STR/MAT/RAT/DEF/ARM/CMD + FOC/FRY/THR), HP total, base size, weapons with stats + properties, abilities with rule text, feat, options, keywords. "Add to Force" button in footer.
  - **Roster**: same category breakdown as browser (Leader, Cohort, Units, Solos, CAs, BEs).
  - **3-column layout**: browser (260px) | card detail (320px, hidden until unit selected) | roster (flex).
- Updated `server.js`:
  - `wmNormaliseUnit`: added `rulesText` (full rules object), `editionID`, `arenaID`, `fa`, `options`, `feat`; weapon `properties` and `abilities` arrays now included.
  - `/api/wm-armies`: added `editionID`, `arenaID`, `includedCardIDs` (probes multiple field name variants).
  - `/api/wm-units`: added `?guids=guid1,guid2,...` filter for mercenary card lookup.
  - Dropped `_raw` from `wmNormaliseUnit` return (all needed fields now explicit).

### Session 7 (continued) — Browser fixes
- Overhauled unit browser to load all units eagerly at builder open (no longer gated by army selection).
- Filtering is now entirely client-side: edition filter cross-references army `arena` against loaded armies; army select narrows further with fuzzy name matching (both directions) to handle naming differences between the armies API and card `armies[]` entries.
- Match type select moved from browser config to roster setup panel — it sets the point limit but does not filter the unit list.
- Server-side `armyName` filter updated to fuzzy (`includes` both ways) for API compatibility.
- Search and category sections now work immediately on load without requiring army selection first.

---

## Next Session: Start Here

**Goal:** Test the forces builder end-to-end, then begin the Cards page.

1. **Test the forces builder**: open builder, verify all units appear in categories immediately. Select MKIV/Legacy radios and verify the army dropdown and unit list filter correctly. Select an army and verify the list narrows. Search, add units, set leader, save. Edit and delete.
2. **Probe the actual `data general.json` keys** for armies and match types: start the server, hit `/api/wm-armies` and `/api/wm-matchtypes`, check the server logs for which probing key matched. Put confirmed keys first in the probing arrays in `server.js`.
3. **Swap `index.html`** → replace its content with `home.html` so `/` serves the new home page.
4. **Begin `public/cards.html` + `public/js/cards.js`** — read-only card reference browser. Filterable by faction, army, type, keyword. Card detail panel on click. Reference the Card Generator `parseJsonSimple()` for field normalisation.

**Remaining planned pages:**
- `cards.html` / `cards.js` — read-only card reference browser
- `library.html` / `library.js` — publications browser (reads `data library.json`)
