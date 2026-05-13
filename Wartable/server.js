'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const crypto  = require('crypto');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Paths ────────────────────────────────────────────────────────────────────

// Warmachine App — dynamically resolves current user's home directory
const WM_APP_BASE   = path.join(os.homedir(), 'AppData', 'LocalLow', 'Privateer Press', 'Warmachine App');
const WM_MKIV_DIR   = path.join(WM_APP_BASE, 'public', 'mkiv-main');
const WM_DATA_FILE  = path.join(WM_MKIV_DIR, 'data general.json');
const WM_FORCES_DIR = WM_APP_BASE;   // force-*.json files live here

// Fallback data directories (lower priority than WM App)
const PACKAGE_DATA  = path.join(__dirname, 'node_modules', 'warmachine-data', 'data');
const LOCAL_DATA    = path.join(__dirname, 'data');

// Non-faction data files to exclude when listing faction files
const NON_FACTION = new Set(['abilities', 'keywords', 'spells', 'weapons', 'index', 'ammo']);

// ─── Decryption ───────────────────────────────────────────────────────────────
//
// File format:
//   bytes 0–31  : salt
//   bytes 32+   : AES-256-CFB ciphertext (PKCS7-padded plaintext)
//
// Key derivation:
//   PBKDF2(password, salt, { hash: SHA1, iterations: 50000, outputLen: 48 })
//   key = output[0:32]
//   IV  = output[32:48]

const WM_PASSWORD = 'dlse0seb';

function decryptWMBuffer(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 33) throw new Error('File too short to be a valid encrypted file');

  const salt       = buf.slice(0, 32);
  const ciphertext = buf.slice(32);

  const derived = crypto.pbkdf2Sync(WM_PASSWORD, salt, 50000, 48, 'sha1');
  const key     = derived.slice(0, 32);
  const iv      = derived.slice(32, 48);

  const decipher = crypto.createDecipheriv('aes-256-cfb', key, iv);
  decipher.setAutoPadding(false);

  let plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Strip PKCS7 padding (verify all padding bytes before removing)
  if (plaintext.length > 0) {
    const padLen = plaintext[plaintext.length - 1];
    if (padLen > 0 && padLen <= 16 && padLen <= plaintext.length) {
      const valid = [...Array(padLen)].every(
        (_, i) => plaintext[plaintext.length - padLen + i] === padLen
      );
      if (valid) plaintext = plaintext.slice(0, plaintext.length - padLen);
    }
  }

  return plaintext.toString('utf8');
}

// Read a file that may be either plain JSON or encrypted JSON.
// Returns the parsed object, or null on failure.
function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const buf  = fs.readFileSync(filePath);
    const text = buf.toString('utf8').trimStart();

    // If it starts with '{' or '[' it's plain JSON
    if (text[0] === '{' || text[0] === '[') {
      return JSON.parse(text);
    }

    // Otherwise try to decrypt
    const decrypted = decryptWMBuffer(buf);
    return JSON.parse(decrypted);
  } catch (e) {
    console.error(`[readJsonFile] ${path.basename(filePath)}: ${e.message}`);
    return null;
  }
}

// ─── WM App Data Cache ────────────────────────────────────────────────────────

let wmDataCache     = null;   // parsed JSON from data general.json
let wmDataLoaded    = false;  // attempted at least once

// GUID lookup indexes (built once when data is loaded)
let cardsByGuid      = {};   // guidStr → card object
let armiesByGuid     = {};   // guidStr → army object
let matchTypesByGuid = {};   // guidStr → matchType object

function loadWMData() {
  if (wmDataLoaded) return wmDataCache;
  wmDataLoaded = true;

  if (!fs.existsSync(WM_DATA_FILE)) {
    console.log(`  ℹ  Warmachine App data not found at:\n     ${WM_DATA_FILE}`);
    return null;
  }

  const data = readJsonFile(WM_DATA_FILE);
  if (data) {
    wmDataCache = data;
    console.log('  ✔  Warmachine App data decrypted and cached');

    // ── Build GUID indexes ────────────────────────────────────────────────
    cardsByGuid = {};
    for (const card of (data.cards || [])) {
      if (card && card.guidStr) cardsByGuid[card.guidStr] = card;
    }
    console.log(`  ✔  Cards indexed: ${Object.keys(cardsByGuid).length}`);

    // Armies — field name not confirmed; probe common candidates
    armiesByGuid = {};
    for (const key of ['armies', 'army', 'factions', 'faction']) {
      const arr = data[key];
      if (!Array.isArray(arr) || !arr.length) continue;
      for (const a of arr) {
        if (a && a.guidStr) armiesByGuid[a.guidStr] = a;
      }
      if (Object.keys(armiesByGuid).length) { console.log(`  ✔  Armies indexed from "${key}": ${Object.keys(armiesByGuid).length}`); break; }
    }

    // Match types — field name not confirmed; probe common candidates
    matchTypesByGuid = {};
    for (const key of ['matchTypes', 'match types', 'gametypes', 'game types', 'matchtype', 'modes']) {
      const arr = data[key];
      if (!Array.isArray(arr) || !arr.length) continue;
      for (const mt of arr) {
        if (mt && mt.guidStr) matchTypesByGuid[mt.guidStr] = mt;
      }
      if (Object.keys(matchTypesByGuid).length) { console.log(`  ✔  Match types indexed from "${key}": ${Object.keys(matchTypesByGuid).length}`); break; }
    }

    watchWMData();
  } else {
    console.error('  ✖  Failed to decrypt Warmachine App data');
  }
  return wmDataCache;
}

function watchWMData() {
  try {
    fs.watch(WM_DATA_FILE, { persistent: false }, (event) => {
      if (event === 'change' || event === 'rename') {
        wmDataCache      = null;
        wmDataLoaded     = false;
        cardsByGuid      = {};
        armiesByGuid     = {};
        matchTypesByGuid = {};
        console.log('  ↺  Warmachine App data changed — cache invalidated');
      }
    });
  } catch {
    // fs.watch not available (unlikely on Windows, but safe to ignore)
  }
}

// ─── WM Data Extraction ───────────────────────────────────────────────────────
//
// Confirmed shape of data general.json (decrypted):
//   {
//     "cards": [ ...cardObj ],
//     "abilities": { "abilityName": "description", ... },
//     "properties": { "weaponQualityName": "description", ... },
//     "spells": { "spellName": { "text": "...", "stats": {...} }, ... },
//     "command cards": [ ... ],
//     "rack": { ... }
//   }
//
// Each card:
//   { name, faction, type, portrait, cost, fa, keywords, armies,
//     spells, feat, health, rules, profiles, options }
//
// Each profile: { name, stats:{spd,str,mat,...}, weapons:[...], abilities:[...] }
// Each weapon:  { name, type, count, location, stats:{pow,...}, properties:[...] }
// Stats always use lowercase keys (spd, str, mat, rat, def, arm, cmd, pow, ...)

function wmGetAllUnits(data) {
  if (!data) return [];
  // Primary key confirmed from WM App data general.json
  if (Array.isArray(data['cards'])) return data['cards'];
  // Fallback probes for other potential formats
  for (const key of ['models', 'units', 'entries', 'items']) {
    if (Array.isArray(data[key])) return data[key];
  }
  // Flat object keyed by unit id
  const vals = Object.values(data);
  if (vals.length > 0 && vals.every(v => v && typeof v === 'object' && v.name)) {
    return Object.entries(data).map(([k, v]) => ({ id: k, ...v }));
  }
  return [];
}

function wmGetFactions(data) {
  if (!data) return [];
  const units = wmGetAllUnits(data);
  const seen  = new Map(); // slug-id → display name
  for (const u of units) {
    const rawName = u.faction;
    if (!rawName) continue;
    const id = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
    if (!seen.has(id)) seen.set(id, rawName);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function guessBaseSizeFromType(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('colossal') || t.includes('gargantuan')) return 'huge';
  if (t.includes('jack') || t.includes('beast'))          return 'large';
  if (t.includes('cavalry'))                               return 'large';
  if (t.includes('warcaster') || t.includes('warlock'))   return 'medium';
  return 'small';
}

function wmNormaliseUnit(raw) {
  if (!raw || !raw.name) return null;

  // Primary profile contains the main stat line and weapons
  const primaryProfile = Array.isArray(raw.profiles) && raw.profiles.length > 0
    ? raw.profiles[0] : null;

  // Stats: raw data uses lowercase keys (spd, str, mat, rat, def, arm, cmd, ...)
  const rawStats = (primaryProfile && primaryProfile.stats) || {};
  const stats = {};
  for (const [k, v] of Object.entries(rawStats)) {
    stats[k.toLowerCase()] = v;
  }

  // Abilities from card.rules (object: abilityName → description text)
  // plus any per-profile ability arrays
  const abilities = [];
  if (raw.rules && typeof raw.rules === 'object') {
    for (const name of Object.keys(raw.rules)) {
      abilities.push(name);
    }
  }
  if (primaryProfile && Array.isArray(primaryProfile.abilities)) {
    for (const ab of primaryProfile.abilities) {
      if (!abilities.includes(ab)) abilities.push(ab);
    }
  }

  // Weapons from primary profile — include properties and abilities
  const weapons = (primaryProfile && Array.isArray(primaryProfile.weapons))
    ? primaryProfile.weapons.map(w => ({
        name:       w.name     || '',
        type:       w.type     || 'Melee',
        count:      w.count    || '1',
        loc:        w.location || '',
        stats:      w.stats    || {},
        properties: Array.isArray(w.properties) ? w.properties : [],
        abilities:  Array.isArray(w.abilities)  ? w.abilities  : [],
      }))
    : [];

  // Focus / fury: check per-profile stats first, then card-level overrides
  const type      = (raw.type || '').toLowerCase();
  const focus     = stats.focus     != null ? stats.focus
                  : (type.includes('warcaster') && raw.focus != null ? raw.focus : null);
  const fury      = stats.fury      != null ? stats.fury
                  : (type.includes('warlock')   && raw.fury  != null ? raw.fury  : null);
  const threshold = stats.threshold != null ? stats.threshold : (raw.threshold ?? null);

  // Damage boxes: sum of health spiral row values
  let damageBoxes = null;
  if (raw.health && Array.isArray(raw.health.values) && raw.health.values.length > 0) {
    const total = raw.health.values.reduce((acc, v) => acc + (parseInt(v) || 0), 0);
    if (total > 0) damageBoxes = total;
  }

  // Faction: the raw value is a display name ("Khador"), slug it for use as an id
  const factionName = raw.faction || '';
  const factionId   = factionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');

  return {
    id:          raw.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name:        raw.name,
    faction:     factionId,
    factionName: factionName,
    type:        raw.type  || 'unit',
    baseSize:    guessBaseSizeFromType(raw.type),
    cost:        typeof raw.cost === 'number' ? raw.cost : (parseInt(raw.cost) || 0),
    fa:          raw.fa    != null ? String(raw.fa)   : null,
    focus,
    fury,
    threshold,
    damageBoxes,
    stats,
    abilities,
    weapons,
    rulesText: (raw.rules && typeof raw.rules === 'object') ? raw.rules : {},
    options:   Array.isArray(raw.options) ? raw.options : [],
    feat:      (raw.feat  && typeof raw.feat  === 'object') ? raw.feat  : null,
    editionID: raw.editionID || raw.editionId || raw.edition || null,
    arenaID:   raw.arenaID   || raw.arenaId   || raw.arena   || null,
    keywords:  Array.isArray(raw.keywords) ? raw.keywords : [],
    armies:    Array.isArray(raw.armies)   ? raw.armies   : [],
    portrait:  raw.portrait || null,
    guidStr:   raw.guidStr  || null,
  };
}

// ─── Fallback (npm package / local data/) ────────────────────────────────────

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listFactionFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !NON_FACTION.has(f.replace('.json', '')))
    .map(f => f.replace('.json', ''));
}

// ─── API: Status ──────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  const data = loadWMData();
  res.json({
    wmAppFound:    fs.existsSync(WM_APP_BASE),
    wmDataFound:   fs.existsSync(WM_DATA_FILE),
    wmDataLoaded:  data !== null,
    packageData:   fs.existsSync(PACKAGE_DATA),
    localData:     fs.existsSync(LOCAL_DATA),
  });
});

// ─── API: WM App — factions ───────────────────────────────────────────────────

app.get('/api/wm-factions', (_req, res) => {
  const data     = loadWMData();
  const factions = wmGetFactions(data);
  res.json(factions);
});

// ─── API: WM App — units (all, or filtered by ?faction=id) ───────────────────

app.get('/api/wm-units', (req, res) => {
  const data  = loadWMData();
  if (!data) return res.json([]);

  let units = wmGetAllUnits(data).map(wmNormaliseUnit).filter(Boolean);

  const faction = req.query.faction;
  if (faction) {
    const fl = faction.toLowerCase();
    units = units.filter(u =>
      (u.faction || '').toLowerCase() === fl ||
      (u.faction || '').toLowerCase().includes(fl)
    );
  }

  // Filter by army name — fuzzy match in both directions (name vs card armies[])
  const armyName = req.query.armyName;
  if (armyName) {
    const al = armyName.toLowerCase().trim();
    units = units.filter(u =>
      Array.isArray(u.armies) && u.armies.some(a => {
        const an = (a || '').toLowerCase().trim();
        return an === al || an.includes(al) || al.includes(an);
      })
    );
  }

  // Filter by specific GUIDs (used for mercenary card lookup)
  const guids = req.query.guids;
  if (guids) {
    const guidSet = new Set(guids.split(',').map(s => s.trim()).filter(Boolean));
    units = units.filter(u => u.guidStr && guidSet.has(u.guidStr));
  }

  res.json(units);
});

// ─── API: WM App — armies ─────────────────────────────────────────────────────

app.get('/api/wm-armies', (_req, res) => {
  const data = loadWMData();
  if (!data) return res.json([]);

  for (const key of ['armies', 'army', 'factions', 'faction']) {
    const arr = data[key];
    if (!Array.isArray(arr) || !arr.length) continue;
    const armies = arr
      .filter(a => a && a.guidStr)
      .map(a => ({
        guidStr:         a.guidStr,
        name:            a.name || a.displayName || a.title || a.armyName || '',
        arena:           a.arena || a.mode || a.format
                         || (a.legacy === true ? 'Legacy' : a.legacy === false ? 'Prime' : ''),
        editionID:       a.editionID  || a.editionId  || null,
        arenaID:         a.arenaID    || a.arenaId    || null,
        includedCardIDs: Array.isArray(a.includedCardIDs) ? a.includedCardIDs
                       : Array.isArray(a.includedCardIds) ? a.includedCardIds
                       : Array.isArray(a.includedCards)   ? a.includedCards
                       : Array.isArray(a.mercenaries)     ? a.mercenaries
                       : [],
      }))
      .filter(a => a.name);
    if (armies.length) return res.json(armies);
  }
  res.json([]);
});

// ─── API: WM App — match types ────────────────────────────────────────────────

app.get('/api/wm-matchtypes', (_req, res) => {
  const data = loadWMData();
  if (!data) return res.json([]);

  for (const key of ['matchTypes', 'match types', 'gametypes', 'game types', 'matchtype', 'modes']) {
    const arr = data[key];
    if (!Array.isArray(arr) || !arr.length) continue;
    const types = arr
      .filter(mt => mt && mt.guidStr)
      .map(mt => ({
        guidStr:    mt.guidStr,
        name:       mt.name || mt.displayName || mt.title || mt.modeName || '',
        pointLimit: mt.pointLimit || mt.points || mt.pointValue || mt.limit || null,
      }))
      .filter(mt => mt.name);
    if (types.length) return res.json(types);
  }
  res.json([]);
});

// ─── API: WM App — single card by GUID ───────────────────────────────────────

app.get('/api/wm-card/:guidStr', (req, res) => {
  const data = loadWMData();
  if (!data) return res.status(503).json({ error: 'WM data not loaded' });

  // Sanitise: GUIDs are hex digits + hyphens only
  const guidStr = req.params.guidStr.replace(/[^a-f0-9\-]/gi, '');
  const card = cardsByGuid[guidStr];
  if (!card) return res.status(404).json({ error: `Card not found: ${guidStr}` });
  res.json(card);
});

// ─── API: Fallback factions (npm package / local data/) ──────────────────────

app.get('/api/factions', (_req, res) => {
  const factions = new Set([...listFactionFiles(PACKAGE_DATA), ...listFactionFiles(LOCAL_DATA)]);
  res.json([...factions].sort());
});

// ─── API: Fallback units ──────────────────────────────────────────────────────

app.get('/api/units/:faction', (req, res) => {
  const faction = req.params.faction.replace(/[^a-z0-9_-]/gi, '');
  const data    = readJsonSafe(path.join(LOCAL_DATA,   `${faction}.json`))
               || readJsonSafe(path.join(PACKAGE_DATA, `${faction}.json`));
  if (data) res.json(data);
  else res.status(404).json({ error: `No data for faction "${faction}"` });
});

// ─── API: Force files ─────────────────────────────────────────────────────────

app.get('/api/forces', (_req, res) => {
  if (!fs.existsSync(WM_FORCES_DIR)) return res.json([]);
  try {
    const files = fs.readdirSync(WM_FORCES_DIR)
      .filter(f => f.toLowerCase().startsWith('force-') && f.toLowerCase().endsWith('.json'))
      .sort();
    res.json(files.map(f => ({
      filename: f,
      name:     f.replace(/^force-/i, '').replace(/\.json$/i, ''),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/force/:filename', (req, res) => {
  // Sanitise — only allow force-*.json
  const raw = req.params.filename;
  if (!/^force-.+\.json$/i.test(raw)) {
    return res.status(400).json({ error: 'Invalid force filename' });
  }
  const filePath = path.join(WM_FORCES_DIR, raw);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const data = readJsonFile(filePath);
  if (data) res.json(data);
  else res.status(500).json({ error: 'Could not read force file' });
});

// ─── Force Resolution Helper ──────────────────────────────────────────────────

function resolveForce(filePath) {
  let data;
  try { data = readJsonFile(filePath); } catch { return null; }
  if (!data) return null;

  let stat;
  try { stat = fs.statSync(filePath); } catch { stat = { mtime: new Date(0) }; }

  loadWMData(); // ensure GUID indexes are populated

  const army = armiesByGuid[data._armyId]     || null;
  const mt   = matchTypesByGuid[data._matchTypeId] || null;

  const CASTER_TYPES = ['warcaster', 'warlock', 'caster'];

  // Resolve every force card into { _cardId, _forceCardGuid, _attachedForceCardIds, name, type, cost }
  const allCards = (data._forceCards || []).map(fc => {
    const card = cardsByGuid[fc._cardId];
    return {
      _cardId:               fc._cardId              || '',
      _forceCardGuid:        fc.guidStr              || '',
      _attachedForceCardIds: fc._attachedForceCardIds || [],
      name:  card?.name || '(unknown)',
      type:  card?.type || '',
      cost:  typeof card?.cost === 'number' ? card.cost : (parseInt(card?.cost) || 0),
    };
  });

  const leader      = allCards.find(c => CASTER_TYPES.some(t => (c.type || '').toLowerCase().includes(t))) || null;
  const cards       = leader ? allCards.filter(c => c !== leader) : allCards;
  const pointTotal  = cards.reduce((s, c) => s + (c.cost || 0), 0);

  return {
    filename:    path.basename(filePath),
    forceName:   data._forceName   || '',
    guidStr:     data.guidStr      || null,
    armyId:      data._armyId      || null,
    matchTypeId: data._matchTypeId || null,
    army: army ? {
      guidStr: army.guidStr,
      name:    army.name || army.displayName || army.armyName || '',
      arena:   army.arena || army.mode || '',
    } : null,
    matchType: mt ? {
      guidStr:    mt.guidStr,
      name:       mt.name || mt.displayName || mt.modeName || '',
      pointLimit: mt.pointLimit || mt.points || mt.limit || null,
    } : null,
    leader,
    cards,
    pointTotal,
    mtime: stat.mtime.toISOString(),
  };
}

// ─── API: Resolved force list ─────────────────────────────────────────────────

app.get('/api/forces-resolved', (_req, res) => {
  if (!fs.existsSync(WM_FORCES_DIR)) return res.json([]);
  try {
    const files = fs.readdirSync(WM_FORCES_DIR)
      .filter(f => f.toLowerCase().startsWith('force-') && f.toLowerCase().endsWith('.json'))
      .sort();
    const resolved = files.map(f => resolveForce(path.join(WM_FORCES_DIR, f))).filter(Boolean);
    res.json(resolved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Save force (create or overwrite) ────────────────────────────────────

app.post('/api/force', (req, res) => {
  const { filename, force } = req.body;
  if (!force || typeof force !== 'object') {
    return res.status(400).json({ error: 'Invalid force data' });
  }

  // Assign a guidStr if new
  if (!force.guidStr) force.guidStr = crypto.randomUUID();

  // Derive a safe filename when not provided (new force)
  const safeName = (force._forceName || 'Unnamed')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
  const targetFile = filename || `force-${safeName}-${force.guidStr}.json`;

  if (!/^force-.+\.json$/i.test(targetFile)) {
    return res.status(400).json({ error: 'Invalid force filename' });
  }

  const filePath = path.join(WM_FORCES_DIR, targetFile);
  try {
    fs.writeFileSync(filePath, JSON.stringify(force, null, 2), 'utf8');
    res.json({ filename: targetFile, guidStr: force.guidStr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Delete force ────────────────────────────────────────────────────────

app.delete('/api/force/:filename', (req, res) => {
  const raw = req.params.filename;
  if (!/^force-.+\.json$/i.test(raw)) {
    return res.status(400).json({ error: 'Invalid force filename' });
  }
  const filePath = path.join(WM_FORCES_DIR, raw);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Room Management ──────────────────────────────────────────────────────────

const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeRoom(code) {
  return {
    code,
    created: Date.now(),
    players: [],
    state: { round: 1, activePlayer: 0, tokens: [], rolls: [] },
  };
}

setInterval(() => {
  const cutoff = Date.now() - 86_400_000;
  for (const [code, room] of rooms) {
    if (room.players.length === 0 && room.created < cutoff) rooms.delete(code);
  }
}, 3_600_000);

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', socket => {
  let roomCode    = null;
  let playerIndex = -1;

  function broadcast(event, data) { socket.to(roomCode).emit(event, data); }

  socket.on('createRoom', ({ playerName }) => {
    const code = genCode();
    const room = makeRoom(code);
    room.players.push({ id: socket.id, name: playerName, index: 0 });
    rooms.set(code, room);
    socket.join(code);
    roomCode    = code;
    playerIndex = 0;
    socket.emit('roomCreated', { code, playerIndex: 0 });
    socket.emit('stateSync', room.state);
    console.log(`Room ${code} created by "${playerName}"`);
  });

  socket.on('joinRoom', ({ roomCode: code, playerName }) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) { socket.emit('serverError', { message: `Room "${code}" not found.` }); return; }
    if (room.players.length >= 2) { socket.emit('serverError', { message: 'Room is full.' }); return; }
    const idx = room.players.length;
    room.players.push({ id: socket.id, name: playerName, index: idx });
    socket.join(code.toUpperCase());
    roomCode    = code.toUpperCase();
    playerIndex = idx;
    socket.emit('roomJoined', { code: roomCode, playerIndex: idx });
    socket.emit('stateSync', room.state);
    broadcast('playerJoined', {
      name: playerName, index: idx,
      players: room.players.map(p => ({ name: p.name, index: p.index })),
    });
    console.log(`"${playerName}" joined room ${roomCode}`);
  });

  socket.on('gameAction', ({ action, data }) => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const st = room.state;
    switch (action) {
      case 'addToken':    if (!st.tokens.find(t => t.id === data.id)) st.tokens.push(data); break;
      case 'moveToken': { const t = st.tokens.find(t => t.id === data.id); if (t) { t.x = data.x; t.y = data.y; } break; }
      case 'updateToken': { const i = st.tokens.findIndex(t => t.id === data.id); if (i >= 0) st.tokens[i] = { ...st.tokens[i], ...data }; break; }
      case 'removeToken': st.tokens = st.tokens.filter(t => t.id !== data.id); break;
      case 'clearBoard':  st.tokens = []; break;
      case 'endTurn':     st.activePlayer = 1 - st.activePlayer; if (st.activePlayer === 0) st.round++; break;
    }
    broadcast('stateSync', st);
  });

  socket.on('rollDice', ({ dice, label }) => {
    if (!roomCode) return;
    const room    = rooms.get(roomCode);
    if (!room) return;
    const results = dice.map(sides => Math.floor(Math.random() * sides) + 1);
    const total   = results.reduce((a, b) => a + b, 0);
    const player  = room.players.find(p => p.id === socket.id);
    const roll = { id: Date.now(), player: player?.name ?? 'Player', dice, results, total, label: label || '', timestamp: new Date().toLocaleTimeString() };
    room.state.rolls = [roll, ...room.state.rolls].slice(0, 30);
    io.to(roomCode).emit('diceResult', roll);
  });

  socket.on('chatMessage', ({ text }) => {
    if (!roomCode || !text?.trim()) return;
    const room   = rooms.get(roomCode);
    const player = room?.players.find(p => p.id === socket.id);
    io.to(roomCode).emit('chatMessage', { name: player?.name ?? 'Unknown', text: text.trim().slice(0, 300), timestamp: new Date().toLocaleTimeString() });
  });

  socket.on('disconnect', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    broadcast('playerLeft', { index: playerIndex });
    console.log(`Player ${playerIndex} left room ${roomCode}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n' + '═'.repeat(56));
  console.log(`  ⚔  Wartable Local  —  http://localhost:${PORT}`);
  console.log('═'.repeat(56));
  console.log(`  User:    ${os.userInfo().username}`);
  console.log(`  WM path: ${WM_APP_BASE}`);

  // Eagerly load WM data on startup
  loadWMData();

  if (!fs.existsSync(WM_APP_BASE)) {
    console.log('  ✖  Warmachine App folder not found — unit data unavailable');
    console.log('     Expected:', WM_APP_BASE);
  }

  const hasFallback = fs.existsSync(PACKAGE_DATA) || fs.existsSync(LOCAL_DATA);
  if (!wmDataCache && hasFallback) {
    console.log('  ✔  Fallback unit data available (npm package / data/)');
  }

  console.log('═'.repeat(56) + '\n');
});
