// ═══════════════════════════════════════════════════════════════════════════
//  Wartable Local — Frontend App
//  Warmachine MKIV Virtual Tabletop
// ═══════════════════════════════════════════════════════════════════════════

// ─── Constants ──────────────────────────────────────────────────────────────
const BOARD_INCHES = 48;
const PX_PER_INCH  = 14;       // base px scale (before Konva stage zoom)

// Base radius in inches (half the diameter)
const BASE_RADIUS = { small: 0.59, medium: 0.787, large: 0.984, huge: 2.362 };

// MKIV + Legacy faction registry
const FACTIONS = {
  // ── MKIV Prime Armies ────────────────────────────────────────────────
  'cygnar':        { label: 'Storm Legion (Cygnar)',           color: '#1a5fb4', legacy: false },
  'khador':        { label: 'Winter Korps (Khador)',           color: '#c01c28', legacy: false },
  'cryx':          { label: 'Shadowflame Cadre (Cryx)',        color: '#1c7d4d', legacy: false },
  'menoth':        { label: 'Templars of Menoth',              color: '#c49a00', legacy: false },
  'orgoth':        { label: 'Orgoth Sea Raiders',              color: '#7a1a1a', legacy: false },
  'brineblood':    { label: 'Brineblood Marauders',            color: '#0b4f6c', legacy: false },
  'dusk':          { label: 'Dusk House Kallyss',              color: '#6c2b9a', legacy: false },
  'khymaera':      { label: 'Khymaera',                        color: '#3d1a6e', legacy: false },
  'aeternus':      { label: 'Aeternus Continuum',              color: '#4a4a4a', legacy: false },
  // ── Legacy / Unlimited ───────────────────────────────────────────────
  'cygnar-legacy': { label: 'Cygnar (Legacy)',                 color: '#3d6ebc', legacy: true  },
  'khador-legacy': { label: 'Khador (Legacy)',                 color: '#e74c3c', legacy: true  },
  'cryx-legacy':   { label: 'Cryx (Legacy)',                   color: '#1abc9c', legacy: true  },
  'menoth-legacy': { label: 'Menoth (Legacy)',                 color: '#f0c040', legacy: true  },
  'retribution':   { label: 'Retribution of Scyrah',           color: '#5d9dc9', legacy: true  },
  'trollbloods':   { label: 'Trollbloods',                     color: '#5d8aa8', legacy: true  },
  'circle':        { label: 'Circle Orboros',                  color: '#2d7a2d', legacy: true  },
  'legion':        { label: 'Legion of Everblight',            color: '#8b1010', legacy: true  },
  'skorne':        { label: 'Skorne',                          color: '#9c3220', legacy: true  },
  'convergence':   { label: 'Convergence of Cyriss',           color: '#c07a2a', legacy: true  },
  'crucible':      { label: 'Crucible Guard',                  color: '#c4a200', legacy: true  },
  'infernals':     { label: 'Infernals',                       color: '#6c2480', legacy: true  },
  'grymkin':       { label: 'Grymkin',                         color: '#5a7a20', legacy: true  },
  'mercenaries':   { label: 'Mercenaries',                     color: '#8a7a2a', legacy: true  },
};

const EFFECT_COLORS = {
  fire:       '#f97316',
  corrosion:  '#4ade80',
  knockdown:  '#f59e0b',
  stationary: '#818cf8',
  blind:      '#9ca3af',
  disrupted:  '#60a5fa',
};

const PLAYER_STROKE = ['#e0e0ff', '#fde68a']; // P1 white-ish, P2 gold

// ─── App State ──────────────────────────────────────────────────────────────
const state = {
  mode:          'lobby',   // 'lobby' | 'solo' | 'multiplayer'
  playerName:    '',
  playerIndex:   0,
  roomCode:      null,
  game: {
    round:        1,
    activePlayer: 0,
    tokens:       [],
    rolls:        [],
  },
};

// Konva handles
let stage, gridLayer, tokenLayer, uiLayer;
let boardOffsetX = 0, boardOffsetY = 0;

// Token map: id → Konva.Group
const konvaTokens = {};

// Selected token
let selectedId    = null;

// Measurement tool
let measuring      = false;
let measureStart   = null;
let measureKLine   = null;
let measureKText   = null;

// Socket
let socket = null;

// Faction unit data cache: factionId → { unitId: unitData }
const factionCache = {};

// All units flattened for card search
let allUnitsFlat = [];

// Currently right-clicked token
let ctxTokenId = null;

// ─── Utility ────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function factionMeta(factionId) {
  return FACTIONS[factionId] || { label: factionId, color: '#888888', legacy: false };
}

// Map a WM App faction slug/name back to a FACTIONS key for color/legacy data.
// WM factions are human-readable ("Khador", "Storm Legion") slugged to IDs.
function findFactionKey(wmId, wmName) {
  if (FACTIONS[wmId]) return wmId;
  const lowerName = (wmName || wmId).toLowerCase();
  for (const [key, meta] of Object.entries(FACTIONS)) {
    const lowerLabel = meta.label.toLowerCase();
    // Direct key or label match
    if (lowerLabel === lowerName) return key;
    // e.g. wmName "Khador" is contained in "Winter Korps (Khador)"
    if (lowerLabel.includes(lowerName)) return key;
    // e.g. faction key "cygnar" is in wmName "storm legion cygnar"
    if (lowerName.includes(key)) return key;
  }
  return null;
}

// Convert board inches → Konva pixel coordinates
function ix(inchX) { return boardOffsetX + inchX * PX_PER_INCH; }
function iy(inchY) { return boardOffsetY + inchY * PX_PER_INCH; }

// Convert Konva pixel coordinates → board inches
function xi(px)    { return (px - boardOffsetX) / PX_PER_INCH; }
function yi(py)    { return (py - boardOffsetY) / PX_PER_INCH; }

// Get pointer position in Konva (unscaled) space
function boardPointer() {
  const raw = stage.getPointerPosition();
  if (!raw) return null;
  const t = stage.getAbsoluteTransform().copy().invert();
  return t.point(raw);
}

// ─── Socket.io ──────────────────────────────────────────────────────────────
function initSocket() {
  socket = io();

  socket.on('roomCreated', ({ code, playerIndex }) => {
    state.roomCode    = code;
    state.playerIndex = playerIndex;
    state.mode        = 'multiplayer';
    showRoomCode(code);
    enterGame();
  });

  socket.on('roomJoined', ({ code, playerIndex }) => {
    state.roomCode    = code;
    state.playerIndex = playerIndex;
    state.mode        = 'multiplayer';
    enterGame();
  });

  socket.on('stateSync', remoteState => {
    applyRemoteState(remoteState);
  });

  socket.on('diceResult', roll => {
    appendDiceHistory(roll);
    animateDiceResult(roll);
  });

  socket.on('playerJoined', ({ name }) => {
    appendChat(null, `${name} joined the room`, true);
  });

  socket.on('playerLeft', () => {
    appendChat(null, 'Opponent disconnected', true);
  });

  socket.on('chatMessage', ({ name, text, timestamp }) => {
    appendChat(name, text, false, timestamp);
  });

  socket.on('serverError', ({ message }) => {
    showLobbyError(message);
  });
}

function sendAction(action, data) {
  if (state.mode === 'multiplayer' && socket) {
    socket.emit('gameAction', { action, data });
  }
}

function sendRoll(dice, label) {
  if (state.mode === 'multiplayer' && socket) {
    socket.emit('rollDice', { dice, label });
  } else {
    // Solo: roll locally
    const results = dice.map(sides => Math.floor(Math.random() * sides) + 1);
    const total   = results.reduce((a, b) => a + b, 0);
    const roll = {
      id: Date.now(),
      player: state.playerName || 'Player',
      dice, results, total, label,
      timestamp: new Date().toLocaleTimeString(),
    };
    appendDiceHistory(roll);
    animateDiceResult(roll);
  }
}

// ─── Lobby ──────────────────────────────────────────────────────────────────
function initLobby() {
  const nameInput = document.getElementById('player-name');

  document.getElementById('solo-btn').addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Player';
    state.playerName  = name;
    state.playerIndex = 0;
    state.mode        = 'solo';
    enterGame();
  });

  document.getElementById('create-room-btn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    state.playerName = name;
    socket.emit('createRoom', { playerName: name });
  });

  document.getElementById('join-room-btn').addEventListener('click', joinRoom);
  document.getElementById('room-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoom();
  });

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('solo-btn').click();
  });
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) { document.getElementById('player-name').focus(); return; }
  if (!code) { document.getElementById('room-code-input').focus(); return; }
  state.playerName = name;
  socket.emit('joinRoom', { roomCode: code, playerName: name });
}

function showLobbyError(msg) {
  const el = document.getElementById('lobby-status');
  el.textContent = msg;
  el.className   = 'lobby-status error';
  el.hidden      = false;
}

function showRoomCode(code) {
  const el = document.getElementById('lobby-room-code');
  el.innerHTML = `
    <div class="code">${code}</div>
    <p>Share this code — waiting for opponent…</p>`;
  el.hidden = false;
}

// ─── Game Entry ─────────────────────────────────────────────────────────────
function enterGame() {
  document.getElementById('lobby-screen').hidden = true;
  document.getElementById('game-screen').hidden  = false;

  updateTopBar();
  initBoard();
  initPanels();
  loadFactionList();

  if (state.mode === 'solo') {
    appendChat(null, 'Solo mode — board ready.', true);
  }
}

function updateTopBar() {
  const rBadge = document.getElementById('room-badge');
  const pBadge = document.getElementById('player-badge');

  if (state.roomCode) {
    rBadge.textContent = `Room: ${state.roomCode}`;
    rBadge.hidden      = false;
  } else {
    rBadge.hidden = true;
  }

  pBadge.textContent  = state.playerName || 'Player';
  pBadge.className    = `badge badge-player${state.playerIndex === 1 ? ' p2' : ''}`;

  document.getElementById('round-display').textContent = state.game.round;
  updateActiveLabel();
}

function updateActiveLabel() {
  const label  = document.getElementById('active-player-label');
  const active = state.game.activePlayer;
  label.textContent = active === state.playerIndex ? '⚡ Your Turn' : `Player ${active + 1}'s turn`;
}

// ─── Konva Board ────────────────────────────────────────────────────────────
function initBoard() {
  const container = document.getElementById('board-container');
  const W = container.clientWidth;
  const H = container.clientHeight;

  const boardPx = BOARD_INCHES * PX_PER_INCH;
  boardOffsetX  = (W - boardPx) / 2;
  boardOffsetY  = (H - boardPx) / 2;

  stage = new Konva.Stage({ container: 'board', width: W, height: H });

  gridLayer  = new Konva.Layer();
  tokenLayer = new Konva.Layer();
  uiLayer    = new Konva.Layer();
  stage.add(gridLayer, tokenLayer, uiLayer);

  drawGrid();
  setupBoardEvents();

  // Resize handler
  window.addEventListener('resize', () => {
    const W2 = container.clientWidth;
    const H2 = container.clientHeight;
    stage.width(W2);
    stage.height(H2);
    boardOffsetX = (W2 - boardPx) / 2;
    boardOffsetY = (H2 - boardPx) / 2;
    gridLayer.destroyChildren();
    drawGrid();
    redrawAllTokenPositions();
    stage.batchDraw();
  });
}

function drawGrid() {
  const boardPx = BOARD_INCHES * PX_PER_INCH;

  // Board background
  gridLayer.add(new Konva.Rect({
    x: boardOffsetX, y: boardOffsetY,
    width: boardPx, height: boardPx,
    fill: '#1e3a1e',
    stroke: '#4a7a4a',
    strokeWidth: 2,
  }));

  // Grid lines
  for (let i = 0; i <= BOARD_INCHES; i++) {
    const major  = i % 6 === 0;
    const color  = major ? '#3a5a3a' : '#2a4a2a';
    const lw     = major ? 0.6 : 0.3;
    const px     = boardOffsetX + i * PX_PER_INCH;
    const py     = boardOffsetY + i * PX_PER_INCH;

    gridLayer.add(new Konva.Line({
      points: [px, boardOffsetY, px, boardOffsetY + boardPx],
      stroke: color, strokeWidth: lw, listening: false,
    }));
    gridLayer.add(new Konva.Line({
      points: [boardOffsetX, py, boardOffsetX + boardPx, py],
      stroke: color, strokeWidth: lw, listening: false,
    }));

    // Label every 6 inches
    if (major && i > 0 && i < BOARD_INCHES) {
      gridLayer.add(new Konva.Text({
        x: px + 2, y: boardOffsetY + 2,
        text: `${i}"`, fontSize: 8, fill: '#4a6a4a', listening: false,
      }));
    }
  }

  gridLayer.batchDraw();
}

function setupBoardEvents() {
  // Zoom with wheel
  stage.on('wheel', e => {
    e.evt.preventDefault();
    const by      = e.evt.deltaY < 0 ? 1.12 : 1 / 1.12;
    const oldScale = stage.scaleX();
    const newScale = clamp(oldScale * by, 0.25, 6);
    const pointer  = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
    stage.batchDraw();
  });

  // Pan with middle mouse / space+drag
  let panning = false, panLast = null;
  stage.on('mousedown', e => {
    if (e.evt.button === 1) { panning = true; panLast = stage.getPointerPosition(); e.evt.preventDefault(); }
  });
  stage.on('mousemove', () => {
    if (!panning) {
      // Show coordinates
      const p = boardPointer();
      if (p) {
        const inchX = xi(p.x), inchY = yi(p.y);
        if (inchX >= 0 && inchX <= BOARD_INCHES && inchY >= 0 && inchY <= BOARD_INCHES) {
          document.getElementById('coord-display').textContent =
            `${inchX.toFixed(1)}", ${inchY.toFixed(1)}"`;
        }
      }
      return;
    }
    const pos = stage.getPointerPosition();
    stage.x(stage.x() + pos.x - panLast.x);
    stage.y(stage.y() + pos.y - panLast.y);
    panLast = pos;
    stage.batchDraw();
  });
  stage.on('mouseup',   () => { panning = false; });
  stage.on('mouseleave',() => { panning = false; });

  // Board click for measurement / deselect
  stage.on('click', e => {
    if (e.target !== stage && e.target.getLayer() !== gridLayer) return;

    const p = boardPointer();
    if (!p) return;
    const inchX = xi(p.x), inchY = yi(p.y);

    if (measuring) {
      if (!measureStart) {
        measureStart = { x: inchX, y: inchY };
        startMeasureLine(p.x, p.y);
      } else {
        const dist = Math.hypot(inchX - measureStart.x, inchY - measureStart.y);
        document.getElementById('measure-display').textContent = dist.toFixed(2) + '"';
        measureStart = null;
        clearMeasureLine();
      }
    } else {
      // Deselect
      selectToken(null);
    }
  });

  // Measurement mouse move
  stage.on('mousemove', () => {
    if (!measuring || !measureStart) return;
    const p = boardPointer();
    if (!p) return;
    updateMeasureLine(p.x, p.y);
  });

  // Zoom buttons
  document.getElementById('zoom-in-btn').addEventListener('click',  () => stageZoom(1.3));
  document.getElementById('zoom-out-btn').addEventListener('click', () => stageZoom(1 / 1.3));
  document.getElementById('zoom-fit-btn').addEventListener('click', fitBoard);

  // Measure button
  document.getElementById('measure-btn').addEventListener('click', toggleMeasure);

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'm' || e.key === 'M') toggleMeasure();
    if (e.key === 'Escape') { clearMeasureLine(); toggleMeasure(false); selectToken(null); }
    if (e.key === 'Delete' && selectedId) removeToken(selectedId);
    if (e.key === '+' || e.key === '=') stageZoom(1.2);
    if (e.key === '-') stageZoom(1 / 1.2);
    if (e.key === '0') fitBoard();
  });

  // Hide context menu on outside click
  document.addEventListener('click', () => hideCtxMenu());
  document.addEventListener('contextmenu', e => {
    if (!document.getElementById('ctx-menu').contains(e.target)) hideCtxMenu();
  });
}

function stageZoom(factor) {
  const center  = { x: stage.width() / 2, y: stage.height() / 2 };
  const oldScale = stage.scaleX();
  const newScale = clamp(oldScale * factor, 0.25, 6);
  const pointTo  = { x: (center.x - stage.x()) / oldScale, y: (center.y - stage.y()) / oldScale };
  stage.scale({ x: newScale, y: newScale });
  stage.position({ x: center.x - pointTo.x * newScale, y: center.y - pointTo.y * newScale });
  stage.batchDraw();
}

function fitBoard() {
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });
  stage.batchDraw();
}

function redrawAllTokenPositions() {
  for (const token of state.game.tokens) {
    const g = konvaTokens[token.id];
    if (g) { g.x(ix(token.x)); g.y(iy(token.y)); }
  }
  tokenLayer.batchDraw();
}

// ─── Measurement ────────────────────────────────────────────────────────────
function toggleMeasure(force) {
  measuring = force !== undefined ? force : !measuring;
  document.getElementById('measure-btn').classList.toggle('active', measuring);
  if (!measuring) {
    measureStart = null;
    clearMeasureLine();
    document.getElementById('measure-display').textContent = '';
  }
  stage.container().style.cursor = measuring ? 'crosshair' : 'default';
}

function startMeasureLine(px, py) {
  measureKLine = new Konva.Line({
    points: [px, py, px, py],
    stroke: '#f59e0b', strokeWidth: 2, dash: [4, 4], listening: false,
  });
  measureKText = new Konva.Text({
    x: px + 8, y: py - 18,
    text: '0.00"', fontSize: 13, fill: '#f59e0b', fontStyle: 'bold', listening: false,
  });
  uiLayer.add(measureKLine, measureKText);
  uiLayer.batchDraw();
}

function updateMeasureLine(px, py) {
  if (!measureKLine || !measureStart) return;
  const sx = ix(measureStart.x), sy = iy(measureStart.y);
  measureKLine.points([sx, sy, px, py]);
  const dist = Math.hypot(xi(px) - measureStart.x, yi(py) - measureStart.y);
  measureKText.x(px + 8);
  measureKText.y(py - 18);
  measureKText.text(dist.toFixed(2) + '"');
  document.getElementById('measure-display').textContent = dist.toFixed(2) + '"';
  uiLayer.batchDraw();
}

function clearMeasureLine() {
  if (measureKLine) { measureKLine.destroy(); measureKLine = null; }
  if (measureKText) { measureKText.destroy(); measureKText = null; }
  uiLayer.batchDraw();
}

// ─── Tokens ─────────────────────────────────────────────────────────────────
function createToken(opts) {
  // opts: { name, faction, baseSize, playerIndex, unitData? }
  const playerIdx = opts.playerIndex ?? state.playerIndex;
  const token = {
    id:          uid(),
    name:        opts.name,
    faction:     opts.faction || 'mercenaries',
    baseSize:    opts.baseSize || 'medium',
    playerIndex: playerIdx,
    x:           playerIdx === 0 ? 4 + Math.random() * 8 : BOARD_INCHES - 12 + Math.random() * 8,
    y:           playerIdx === 0 ? BOARD_INCHES - 8 : 4,
    damage:      { total: opts.unitData?.damageBoxes || defaultDamage(opts.unitData), filled: [] },
    focus:       (opts.unitData?.focus || opts.unitData?.fury)
                   ? { cur: opts.unitData.focus || opts.unitData.fury,
                       max: opts.unitData.focus || opts.unitData.fury,
                       isFury: !!opts.unitData?.fury }
                   : null,
    effects:     [],
    alive:       true,
  };

  // Clamp to board
  const r = BASE_RADIUS[token.baseSize];
  token.x = clamp(token.x, r, BOARD_INCHES - r);
  token.y = clamp(token.y, r, BOARD_INCHES - r);

  state.game.tokens.push(token);
  renderToken(token);
  sendAction('addToken', token);
  return token;
}

function defaultDamage(unitData) {
  if (!unitData) return 20;
  const type = (unitData.type || '').toLowerCase();
  if (type.includes('colossal') || type.includes('gargantuan')) return 50;
  if (type.includes('jack') || type.includes('beast'))          return 28;
  if (type.includes('warcaster') || type.includes('warlock'))   return 18;
  if (type.includes('solo'))                                     return 8;
  if (type.includes('cavalry'))                                  return 5;
  return 5;
}

function renderToken(token) {
  const meta       = factionMeta(token.faction);
  const baseRad    = BASE_RADIUS[token.baseSize] * PX_PER_INCH;
  const strokeCol  = PLAYER_STROKE[token.playerIndex] ?? '#ffffff';

  const group = new Konva.Group({
    x: ix(token.x), y: iy(token.y),
    draggable: !measuring,
    id: token.id,
  });

  // Drop shadow
  group.add(new Konva.Circle({
    radius: baseRad + 2, fill: 'rgba(0,0,0,0.45)',
    offsetX: -2, offsetY: 3, listening: false,
  }));

  // Base
  const base = new Konva.Circle({
    radius: baseRad, fill: meta.color,
    stroke: strokeCol, strokeWidth: 2,
  });
  group.add(base);

  // Damage tint overlay (updates with damage)
  group.add(new Konva.Circle({
    radius: baseRad, fill: 'rgba(220,38,38,0)', name: 'damage-overlay', listening: false,
  }));

  // Effect ring
  group.add(new Konva.Circle({
    radius: baseRad + 4, fill: 'transparent',
    stroke: 'transparent', strokeWidth: 3,
    name: 'effect-ring', listening: false,
  }));

  // Name text
  const maxFontSize = Math.max(7, baseRad * 0.65);
  const label = new Konva.Text({
    text: abbreviate(token.name, baseRad),
    fontSize: maxFontSize,
    fill: '#ffffff',
    align: 'center', verticalAlign: 'middle',
    width: baseRad * 2, height: baseRad * 2,
    offsetX: baseRad, offsetY: baseRad,
    wrap: 'word', fontStyle: 'bold',
    listening: false,
  });
  group.add(label);

  // Player index dot (top-right of token)
  group.add(new Konva.Circle({
    x: baseRad * 0.6, y: -baseRad * 0.6,
    radius: Math.max(3, baseRad * 0.18),
    fill: strokeCol, listening: false,
  }));

  // Events
  group.on('dragend', () => onTokenDragEnd(token, group));

  group.on('click tap', e => {
    e.cancelBubble = true;
    selectToken(token.id);
  });

  group.on('contextmenu', e => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    showCtxMenu(e.evt.clientX, e.evt.clientY, token.id);
  });

  group.on('mouseover', () => {
    if (!measuring) stage.container().style.cursor = 'grab';
  });
  group.on('mouseout', () => {
    if (!measuring) stage.container().style.cursor = 'default';
  });
  group.on('dragstart', () => {
    stage.container().style.cursor = 'grabbing';
  });

  tokenLayer.add(group);
  tokenLayer.batchDraw();
  konvaTokens[token.id] = group;
}

function abbreviate(name, radius) {
  const maxChars = Math.floor(radius / 3.5);
  if (name.length <= maxChars) return name;
  const words = name.split(/\s+/);
  if (words.length > 1) {
    // Try initials
    const initials = words.map(w => w[0].toUpperCase()).join('');
    if (initials.length <= maxChars) return initials;
  }
  return name.slice(0, maxChars - 1) + '…';
}

function onTokenDragEnd(token, group) {
  stage.container().style.cursor = 'grab';
  const r = BASE_RADIUS[token.baseSize];
  const newX = clamp(xi(group.x()), r, BOARD_INCHES - r);
  const newY = clamp(yi(group.y()), r, BOARD_INCHES - r);

  group.x(ix(newX));
  group.y(iy(newY));

  const t = state.game.tokens.find(t => t.id === token.id);
  if (t) { t.x = newX; t.y = newY; }

  sendAction('moveToken', { id: token.id, x: newX, y: newY });
  tokenLayer.batchDraw();
}

function removeToken(id) {
  const g = konvaTokens[id];
  if (g) { g.destroy(); delete konvaTokens[id]; }
  state.game.tokens = state.game.tokens.filter(t => t.id !== id);
  tokenLayer.batchDraw();
  sendAction('removeToken', { id });
  if (selectedId === id) selectToken(null);
}

function updateTokenVisuals(token) {
  const g = konvaTokens[token.id];
  if (!g) return;

  // Damage tint
  const overlay = g.findOne('.damage-overlay');
  if (overlay && token.damage.total > 0) {
    const pct = token.damage.filled.length / token.damage.total;
    const a   = pct < 0.25 ? 0 : pct < 0.5 ? 0.12 : pct < 0.75 ? 0.28 : 0.45;
    overlay.fill(`rgba(220,38,38,${a})`);
  }

  // Effect ring
  const ring = g.findOne('.effect-ring');
  if (ring) {
    const fx = token.effects || [];
    if (fx.length === 0) {
      ring.stroke('transparent');
    } else {
      ring.stroke(EFFECT_COLORS[fx[0]] || '#ffffff');
    }
  }

  tokenLayer.batchDraw();
}

// ─── Selection ───────────────────────────────────────────────────────────────
function selectToken(id) {
  // Unhighlight previous
  if (selectedId && konvaTokens[selectedId]) {
    const prev = konvaTokens[selectedId].findOne('Circle[name!="damage-overlay"][name!="effect-ring"]');
    // Reset stroke width on base circle
    const prevGroup = konvaTokens[selectedId];
    const prevBase  = prevGroup.getChildren()[1]; // base circle (index 1, after shadow)
    if (prevBase) prevBase.strokeWidth(2);
  }

  selectedId = id;

  if (id) {
    const g = konvaTokens[id];
    if (g) {
      const base = g.getChildren()[1];
      if (base) base.strokeWidth(4);
      tokenLayer.batchDraw();
    }
  }

  updateRightPanel();
}

// ─── Right Panel ─────────────────────────────────────────────────────────────
function updateRightPanel() {
  const token = selectedId ? state.game.tokens.find(t => t.id === selectedId) : null;

  document.getElementById('selected-none').hidden     = !!token;
  document.getElementById('selected-info').hidden     = !token;
  document.getElementById('focus-section').hidden     = !token?.focus;
  document.getElementById('effects-section').hidden   = !token;
  document.getElementById('damage-section').hidden    = !token;
  document.getElementById('token-actions-section').hidden = !token;

  if (!token) return;

  document.getElementById('selected-name').textContent    = token.name;
  document.getElementById('selected-faction').textContent = factionMeta(token.faction).label;

  // Stats (from cached unit data)
  const unitData = getTokenUnitData(token);
  renderStatGrid(unitData);
  renderAbilities(unitData);

  // Focus/Fury
  if (token.focus) {
    document.getElementById('focus-label').textContent =
      (token.focus.isFury || unitData?.type?.toLowerCase().includes('lock')) ? 'Fury' : 'Focus';
    renderFocusPips(token.focus.cur, token.focus.max);
  }

  // Effects
  syncEffectButtons(token.effects || []);

  // Damage
  renderDamageBoxes(token);
}

function getTokenUnitData(token) {
  // Fast global lookup first (covers WM data + all loaded factions)
  const byName = unitsByName[token.name.toLowerCase()];
  if (byName) return byName;
  // Fall back to per-faction cache
  const cache = factionCache[token.faction];
  return cache?._byName?.[token.name.toLowerCase()] || null;
}

function renderStatGrid(unitData) {
  const grid = document.getElementById('stat-grid');
  grid.innerHTML = '';
  if (!unitData?.stats) return;
  const stats = unitData.stats;
  const keys  = ['spd','str','mat','rat','def','arm','cmd','focus','fury','threshold','damage'];
  for (const key of keys) {
    if (stats[key] === undefined && unitData[key] === undefined) continue;
    const val = stats[key] ?? unitData[key];
    if (val === undefined) continue;
    const cell = document.createElement('div');
    cell.className = 'stat-cell';
    cell.innerHTML = `<span class="stat-key">${key.toUpperCase()}</span><span class="stat-val">${val}</span>`;
    grid.appendChild(cell);
  }
}

function renderAbilities(unitData) {
  const list = document.getElementById('abilities-list');
  list.innerHTML = '';
  if (!unitData?.abilities?.length) return;
  const wrap = document.createElement('div');
  for (const ab of unitData.abilities.slice(0, 12)) {
    const tag = document.createElement('span');
    tag.className = 'ability-tag';
    tag.textContent = typeof ab === 'string' ? ab : (ab.name || ab);
    wrap.appendChild(tag);
  }
  list.appendChild(wrap);
}

function renderFocusPips(cur, max) {
  document.getElementById('focus-cur').textContent = cur;
  document.getElementById('focus-max').textContent = max;
  const pips = document.getElementById('focus-pips');
  pips.innerHTML = '';
  for (let i = 1; i <= max; i++) {
    const pip = document.createElement('div');
    pip.className = 'focus-pip' + (i <= cur ? ' filled' : '');
    pip.addEventListener('click', () => {
      const token = state.game.tokens.find(t => t.id === selectedId);
      if (!token?.focus) return;
      token.focus.cur = i === token.focus.cur ? i - 1 : i;
      token.focus.cur = clamp(token.focus.cur, 0, token.focus.max);
      sendAction('updateToken', { id: token.id, focus: token.focus });
      renderFocusPips(token.focus.cur, token.focus.max);
    });
    pips.appendChild(pip);
  }
}

function syncEffectButtons(effects) {
  document.querySelectorAll('.eff-btn').forEach(btn => {
    btn.classList.toggle('active', effects.includes(btn.dataset.effect));
  });
}

function renderDamageBoxes(token) {
  const grid   = document.getElementById('damage-box-grid');
  const frac   = document.getElementById('damage-fraction');
  const maxInp = document.getElementById('damage-max-input');

  const total  = token.damage.total || 20;
  const filled = new Set(token.damage.filled || []);

  maxInp.value = total;
  frac.textContent = `${filled.size} / ${total}`;

  grid.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const box = document.createElement('div');
    box.className = 'damage-box' + (filled.has(i) ? ' filled' : '');
    box.addEventListener('click', () => toggleDamageBox(token, i));
    grid.appendChild(box);
  }
}

function toggleDamageBox(token, idx) {
  const filled = new Set(token.damage.filled);
  if (filled.has(idx)) filled.delete(idx);
  else filled.add(idx);
  token.damage.filled = [...filled];
  renderDamageBoxes(token);
  updateTokenVisuals(token);
  sendAction('updateToken', { id: token.id, damage: token.damage });
  document.getElementById('damage-fraction').textContent =
    `${token.damage.filled.length} / ${token.damage.total}`;
}

// ─── Remote State Sync ───────────────────────────────────────────────────────
function applyRemoteState(remoteState) {
  // Update round/turn
  state.game.round        = remoteState.round;
  state.game.activePlayer = remoteState.activePlayer;
  document.getElementById('round-display').textContent = state.game.round;
  updateActiveLabel();

  // Sync tokens: add new, update existing, remove deleted
  const remoteIds = new Set(remoteState.tokens.map(t => t.id));

  // Remove tokens not in remote state
  for (const id of Object.keys(konvaTokens)) {
    if (!remoteIds.has(id)) {
      konvaTokens[id].destroy();
      delete konvaTokens[id];
    }
  }
  state.game.tokens = state.game.tokens.filter(t => remoteIds.has(t.id));

  // Add / update
  for (const rt of remoteState.tokens) {
    const existing = state.game.tokens.find(t => t.id === rt.id);
    if (existing) {
      // Update position
      Object.assign(existing, rt);
      const g = konvaTokens[rt.id];
      if (g) { g.x(ix(rt.x)); g.y(iy(rt.y)); }
      updateTokenVisuals(existing);
    } else {
      // New token from remote
      state.game.tokens.push(rt);
      renderToken(rt);
    }
  }

  tokenLayer.batchDraw();
  if (selectedId) updateRightPanel();
}

// ─── Panels Init ─────────────────────────────────────────────────────────────
function initPanels() {
  // Tab switching
  document.querySelectorAll('.ptab').forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${name}`).classList.add('active');
    });
  });

  // Focus +/-
  document.getElementById('focus-plus').addEventListener('click', () => {
    const token = state.game.tokens.find(t => t.id === selectedId);
    if (!token?.focus) return;
    token.focus.cur = Math.min(token.focus.cur + 1, token.focus.max);
    sendAction('updateToken', { id: token.id, focus: token.focus });
    renderFocusPips(token.focus.cur, token.focus.max);
  });
  document.getElementById('focus-minus').addEventListener('click', () => {
    const token = state.game.tokens.find(t => t.id === selectedId);
    if (!token?.focus) return;
    token.focus.cur = Math.max(0, token.focus.cur - 1);
    sendAction('updateToken', { id: token.id, focus: token.focus });
    renderFocusPips(token.focus.cur, token.focus.max);
  });

  // Effect buttons
  document.querySelectorAll('.eff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const token = state.game.tokens.find(t => t.id === selectedId);
      if (!token) return;
      const fx  = btn.dataset.effect;
      const arr = token.effects || [];
      if (arr.includes(fx)) token.effects = arr.filter(e => e !== fx);
      else                   token.effects = [...arr, fx];
      syncEffectButtons(token.effects);
      updateTokenVisuals(token);
      sendAction('updateToken', { id: token.id, effects: token.effects });
    });
  });

  // Damage reset
  document.getElementById('damage-reset-btn').addEventListener('click', () => {
    const token = state.game.tokens.find(t => t.id === selectedId);
    if (!token) return;
    token.damage.filled = [];
    renderDamageBoxes(token);
    updateTokenVisuals(token);
    sendAction('updateToken', { id: token.id, damage: token.damage });
  });

  // Damage max change
  document.getElementById('damage-max-apply').addEventListener('click', () => {
    const token = state.game.tokens.find(t => t.id === selectedId);
    if (!token) return;
    const val = parseInt(document.getElementById('damage-max-input').value) || 20;
    token.damage.total  = clamp(val, 1, 60);
    token.damage.filled = token.damage.filled.filter(i => i < token.damage.total);
    renderDamageBoxes(token);
    sendAction('updateToken', { id: token.id, damage: token.damage });
  });

  // Remove token button
  document.getElementById('remove-token-btn').addEventListener('click', () => {
    if (selectedId) removeToken(selectedId);
  });

  // End Turn
  document.getElementById('end-turn-btn').addEventListener('click', () => {
    state.game.activePlayer = 1 - state.game.activePlayer;
    if (state.game.activePlayer === 0) state.game.round += 1;
    document.getElementById('round-display').textContent = state.game.round;
    updateActiveLabel();
    sendAction('endTurn', {});
    appendChat(null, `${state.playerName} ended their turn (Round ${state.game.round})`, true);
  });

  // Clear Board
  document.getElementById('clear-board-btn').addEventListener('click', () => {
    if (!confirm('Remove all tokens from the board?')) return;
    for (const id of Object.keys(konvaTokens)) {
      konvaTokens[id].destroy();
      delete konvaTokens[id];
    }
    state.game.tokens = [];
    tokenLayer.batchDraw();
    sendAction('clearBoard', {});
    selectToken(null);
  });

  // Custom token
  document.getElementById('add-custom-btn').addEventListener('click', () => {
    const name = document.getElementById('custom-unit-name').value.trim();
    if (!name) { document.getElementById('custom-unit-name').focus(); return; }
    const baseSize    = document.getElementById('custom-base-size').value;
    const playerIndex = parseInt(document.getElementById('custom-player').value);
    const faction     = document.getElementById('faction-select').value || 'mercenaries';
    createToken({ name, baseSize, playerIndex, faction });
    document.getElementById('custom-unit-name').value = '';
  });

  // Context menu actions
  document.getElementById('ctx-select').addEventListener('click', () => {
    selectToken(ctxTokenId); hideCtxMenu();
  });
  document.getElementById('ctx-damage-menu').addEventListener('click', () => {
    selectToken(ctxTokenId);
    document.getElementById('damage-section').hidden = false;
    hideCtxMenu();
  });
  document.getElementById('ctx-remove').addEventListener('click', () => {
    removeToken(ctxTokenId); hideCtxMenu();
  });

  // Dice
  document.querySelectorAll('.dice-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const [count, sides] = btn.dataset.dice.split('d').map(Number);
      rollDice(Array(count).fill(sides), btn.dataset.dice);
    });
  });
  document.getElementById('custom-dice-roll-btn').addEventListener('click', () => {
    const count = parseInt(document.getElementById('custom-dice-count').value) || 2;
    const sides = parseInt(document.getElementById('custom-dice-sides').value) || 6;
    rollDice(Array(clamp(count, 1, 10)).fill(clamp(sides, 2, 100)), `${count}d${sides}`);
  });

  // Chat
  document.getElementById('chat-send-btn').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });

  // Card search
  document.getElementById('card-search').addEventListener('input', e => {
    renderCardSearch(e.target.value.trim().toLowerCase());
  });
  document.getElementById('unit-search').addEventListener('input', e => {
    filterUnitList(e.target.value.trim().toLowerCase());
  });
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function showCtxMenu(clientX, clientY, tokenId) {
  ctxTokenId = tokenId;
  const menu = document.getElementById('ctx-menu');
  menu.style.left = clientX + 'px';
  menu.style.top  = clientY + 'px';
  menu.hidden     = false;
}
function hideCtxMenu() {
  document.getElementById('ctx-menu').hidden = true;
  ctxTokenId = null;
}

// ─── Army Builder ─────────────────────────────────────────────────────────────

// Global name-keyed lookup across all loaded units (for token stat display)
const unitsByName = {};

async function loadFactionList() {
  const sel = document.getElementById('faction-select');

  // ── Check server status ──────────────────────────────────────────────────
  let status = {};
  try { status = await (await fetch('/api/status')).json(); } catch { /* offline */ }

  const hasWM      = status.wmDataLoaded;
  const hasFallback= status.packageData || status.localData;

  // ── Populate dropdown ────────────────────────────────────────────────────
  if (hasWM) {
    // Prefer factions extracted from the actual WM App data
    try {
      const wmFactions = await (await fetch('/api/wm-factions')).json();

      // Build optgroups from WM data, merging with our known color/label map
      const mkiv = [], legacy = [], other = [];
      for (const f of wmFactions) {
        const id   = f.id   || f;
        const name = f.name || f;
        const fkey  = findFactionKey(id, name);
        const known = fkey ? FACTIONS[fkey] : null;
        const entry = { id, name: known?.label || name };
        if (known && !known.legacy) mkiv.push(entry);
        else if (known && known.legacy) legacy.push(entry);
        else other.push(entry);
      }

      const addGroup = (label, entries) => {
        if (!entries.length) return;
        const og = document.createElement('optgroup');
        og.label = label;
        for (const e of entries) {
          const opt = document.createElement('option');
          opt.value       = e.id;
          opt.textContent = e.name + ' ✓';
          og.appendChild(opt);
        }
        sel.appendChild(og);
      };

      addGroup('MKIV Prime Armies',   mkiv);
      addGroup('Legacy / Unlimited',  legacy);
      addGroup('Other',               other);

      // Also add any hardcoded factions not in the WM data
      const wmIds = new Set(wmFactions.map(f => f.id || f));
      const missing = Object.entries(FACTIONS).filter(([id]) => !wmIds.has(id));
      if (missing.length) {
        const og = document.createElement('optgroup');
        og.label = 'No data available';
        for (const [id, meta] of missing) {
          const opt = document.createElement('option');
          opt.value       = id;
          opt.textContent = meta.label;
          og.appendChild(opt);
        }
        sel.appendChild(og);
      }

    } catch {
      // WM factions call failed — fall through to hardcoded list
      addHardcodedFactions(sel);
    }

    document.getElementById('data-warning').hidden = true;

  } else {
    // No WM data — show hardcoded faction list
    addHardcodedFactions(sel);

    if (hasFallback) {
      // Mark which factions have fallback data
      try {
        const facList = await (await fetch('/api/factions')).json();
        for (const opt of sel.options) {
          if (facList.includes(opt.value)) opt.textContent += ' ✓';
        }
        document.getElementById('data-warning').hidden = true;
      } catch { /* ignore */ }
    } else {
      document.getElementById('data-warning').hidden = false;
    }
  }

  sel.addEventListener('change', () => loadFactionUnits(sel.value));

  // Also kick off force file list
  loadForcesList();
}

function addHardcodedFactions(sel) {
  const groups = {
    prime:  Object.entries(FACTIONS).filter(([,v]) => !v.legacy),
    legacy: Object.entries(FACTIONS).filter(([,v]) =>  v.legacy),
  };
  const labels = { prime: 'MKIV Prime Armies', legacy: 'Legacy / Unlimited' };
  for (const [groupKey, entries] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = labels[groupKey];
    for (const [id, meta] of entries) {
      const opt = document.createElement('option');
      opt.value       = id;
      opt.textContent = meta.label;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
}

async function loadFactionUnits(factionId) {
  if (!factionId) return;
  const section = document.getElementById('unit-list-section');

  if (factionCache[factionId]) {
    renderUnitList(factionId, factionCache[factionId]);
    section.hidden = false;
    return;
  }

  // ── Try WM App data first ─────────────────────────────────────────────────
  try {
    const res = await fetch(`/api/wm-units?faction=${encodeURIComponent(factionId)}`);
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const units = normalizeWMUnits(arr, factionId);
        factionCache[factionId] = units;
        addToFlat(units);
        renderUnitList(factionId, units);
        section.hidden = false;
        return;
      }
    }
  } catch { /* fall through */ }

  // ── Fallback: npm package / local data/ ──────────────────────────────────
  try {
    const res = await fetch(`/api/units/${factionId}`);
    if (!res.ok) throw new Error('no data');
    const raw   = await res.json();
    const units = normalizeFallbackUnits(raw, factionId);
    factionCache[factionId] = units;
    addToFlat(units);
    renderUnitList(factionId, units);
    section.hidden = false;
  } catch {
    factionCache[factionId] = {};
    section.hidden = true;
  }
}

function addToFlat(unitsObj) {
  for (const u of Object.values(unitsObj)) {
    if (!u.name) continue;
    if (!allUnitsFlat.find(f => f.id === u.id)) allUnitsFlat.push(u);
    unitsByName[u.name.toLowerCase()] = u;
  }
}

// Normalize units that came from /api/wm-units (already normalised server-side)
function normalizeWMUnits(arr, factionId) {
  const result = {};

  for (const u of arr) {
    if (!u || !u.name) continue;
    const key     = u.id || u.name.replace(/\s+/g, '-').toLowerCase();
    // Use the faction color/label from our FACTIONS map if we can match it,
    // otherwise fall back to what the server gave us or a generic gray.
    const fkey    = findFactionKey(u.faction || factionId, u.factionName || '');
    const known   = fkey ? FACTIONS[fkey] : null;
    const unit = {
      id:           `${factionId}__${key}`,
      key,
      name:         u.name,
      faction:      u.faction || factionId,
      factionLabel: known?.label || u.factionName || factionId,
      factionColor: known?.color || '#888888',
      type:         u.type || 'unit',
      stats:        u.stats || {},
      focus:        u.focus  ?? null,
      fury:         u.fury   ?? null,
      threshold:    u.threshold ?? null,
      cost:         u.cost   ?? 0,
      damageBoxes:  u.damageBoxes ?? null,
      abilities:    u.abilities || [],
      weapons:      u.weapons   || [],
      keywords:     u.keywords  || [],
      armies:       u.armies    || [],
      portrait:     u.portrait  || null,
      baseSize:     guessBaseSize(u),
    };
    result[key] = unit;
    if (!result._byName) result._byName = {};
    result._byName[unit.name.toLowerCase()] = unit;
  }
  return result;
}

// Normalize units from the npm package / local data/ (keyed object format)
function normalizeFallbackUnits(raw, factionId) {
  const meta   = factionMeta(factionId);
  const result = {};

  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== 'object' || !val.name) continue;
    const unit = {
      id:           `${factionId}__${key}`,
      key,
      name:         val.name,
      faction:      factionId,
      factionLabel: meta.label,
      factionColor: meta.color,
      type:         val.type || val.unitType || 'unit',
      stats:        val.stats || {},
      focus:        val.focus || val.fury || null,
      cost:         val.cost  || val.points || val.pointCost || 0,
      abilities:    val.abilities || val.specialRules || [],
      weapons:      val.weapons   || [],
      baseSize:     guessBaseSize(val),
    };
    result[key] = unit;
    if (!result._byName) result._byName = {};
    result._byName[unit.name.toLowerCase()] = unit;
  }
  return result;
}

// ─── Force Files ──────────────────────────────────────────────────────────────

async function loadForcesList() {
  let forces = [];
  try {
    const res = await fetch('/api/forces');
    if (res.ok) forces = await res.json();
  } catch { return; }

  const section = document.getElementById('forces-section');
  const list    = document.getElementById('forces-list');

  if (!forces.length) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  list.innerHTML = '';

  for (const f of forces) {
    const row = document.createElement('div');
    row.className = 'unit-item';
    row.innerHTML = `
      <div class="unit-dot" style="background:#4a6cf7"></div>
      <div class="unit-item-name">${escHtml(f.name)}</div>
      <button class="unit-deploy-btn" title="Load force to board">Load</button>`;
    row.querySelector('.unit-deploy-btn').addEventListener('click', e => {
      e.stopPropagation();
      loadForce(f.filename, f.name);
    });
    list.appendChild(row);
  }
}

async function loadForce(filename, displayName) {
  let data;
  try {
    const res = await fetch(`/api/force/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
  } catch (e) {
    appendChat(null, `Failed to load force "${displayName}": ${e.message}`, true);
    return;
  }

  // The WM App force file format varies by version; probe common shapes.
  const units = extractForceUnits(data);
  if (!units.length) {
    appendChat(null, `"${displayName}" loaded but no units found in file`, true);
    return;
  }

  appendChat(null, `Loading force: ${displayName} (${units.length} units)`, true);

  for (const u of units) {
    const factionId = u.faction || u.factionId || u.army || 'mercenaries';
    const meta      = factionMeta(factionId);
    createToken({
      name:        u.name || u.unitName || u.title || 'Unknown',
      faction:     factionId,
      baseSize:    guessBaseSize(u),
      playerIndex: state.playerIndex,
      unitData:    u,
    });
  }
}

function extractForceUnits(data) {
  // Try common top-level keys used by the WM App for force lists
  for (const key of ['units', 'models', 'entries', 'force', 'cards', 'roster']) {
    if (Array.isArray(data[key]) && data[key].length) return data[key];
  }
  // Sometimes the force file is a flat array
  if (Array.isArray(data) && data.length) return data;
  // Could be { warcaster: {...}, units: [...], solos: [...], ... }
  const combined = [];
  for (const key of ['warcaster', 'warlock', 'battleEngine', 'colossal', 'gargantuan',
                     'units', 'solos', 'attachments', 'theme']) {
    const v = data[key];
    if (!v) continue;
    if (Array.isArray(v))               combined.push(...v);
    else if (typeof v === 'object' && v.name) combined.push(v);
  }
  return combined;
}

function guessBaseSize(unit) {
  const type = (unit.type || unit.unitType || '').toLowerCase();
  if (type.includes('colossal') || type.includes('gargantuan')) return 'huge';
  if (type.includes('jack') || type.includes('beast') || type.includes('cavalry')) return 'large';
  if (type.includes('warcaster') || type.includes('warlock') || type.includes('cavalry')) return 'medium';
  if (unit.base) {
    const b = unit.base.toLowerCase();
    if (b.includes('120') || b.includes('huge')) return 'huge';
    if (b.includes('50')  || b.includes('large')) return 'large';
    if (b.includes('40')  || b.includes('medium')) return 'medium';
  }
  return 'small';
}

function renderUnitList(factionId, units) {
  const list   = document.getElementById('unit-list');
  const count  = document.getElementById('unit-count');
  const meta   = factionMeta(factionId);
  const items  = Object.values(units).filter(u => u.name);

  count.textContent = items.length;
  list.innerHTML    = '';

  for (const unit of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const row = document.createElement('div');
    row.className    = 'unit-item';
    row.dataset.unit = unit.key;
    row.innerHTML = `
      <div class="unit-dot" style="background:${meta.color}"></div>
      <div class="unit-item-name">${unit.name}</div>
      <div class="unit-item-type">${unit.type || ''}</div>
      <button class="unit-deploy-btn" title="Deploy to board">+</button>`;

    row.querySelector('.unit-deploy-btn').addEventListener('click', e => {
      e.stopPropagation();
      deployUnit(unit);
    });
    row.addEventListener('click', () => showCardDetail(unit));

    list.appendChild(row);
  }
}

function filterUnitList(query) {
  document.querySelectorAll('.unit-item').forEach(row => {
    const name = row.querySelector('.unit-item-name').textContent.toLowerCase();
    row.style.display = name.includes(query) ? '' : 'none';
  });
}

function deployUnit(unit, playerIdx) {
  const idx = playerIdx ?? state.playerIndex;
  createToken({
    name:        unit.name,
    faction:     unit.faction,
    baseSize:    unit.baseSize || 'small',
    playerIndex: idx,
    unitData:    unit,
  });
}

// ─── Card Browser ─────────────────────────────────────────────────────────────
function renderCardSearch(query) {
  const list = document.getElementById('card-list');
  list.innerHTML = '';
  if (!query || query.length < 2) return;

  const matches = allUnitsFlat
    .filter(u => u.name.toLowerCase().includes(query))
    .slice(0, 40);

  for (const unit of matches) {
    const row = document.createElement('div');
    row.className = 'unit-item';
    row.innerHTML = `
      <div class="unit-dot" style="background:${unit.factionColor || '#888'}"></div>
      <div class="unit-item-name">${unit.name}</div>
      <div class="unit-item-type">${unit.factionLabel || ''}</div>`;
    row.addEventListener('click', () => showCardDetail(unit));
    list.appendChild(row);
  }
}

function showCardDetail(unit) {
  const detail = document.getElementById('card-detail');
  const stats  = unit.stats || {};

  const statKeys = ['spd','str','mat','rat','def','arm','cmd','focus','fury'];
  const statHtml = statKeys
    .filter(k => stats[k] !== undefined)
    .map(k => `<span class="stat-cell"><span class="stat-key">${k.toUpperCase()}</span><span class="stat-val">${stats[k]}</span></span>`)
    .join('');

  const ablHtml = (unit.abilities || [])
    .slice(0, 20)
    .map(a => `<div class="card-ability">• <strong>${typeof a === 'string' ? a : (a.name || a)}</strong></div>`)
    .join('');

  detail.innerHTML = `
    <h4>${unit.name}</h4>
    <div class="card-faction">${unit.factionLabel || ''} — ${unit.type || 'unit'}</div>
    ${statHtml ? `<div class="card-stat-row stat-grid" style="grid-template-columns:repeat(4,1fr)">${statHtml}</div>` : ''}
    ${ablHtml  ? `<div class="card-abilities">${ablHtml}</div>` : ''}
    <button class="btn btn-sm btn-secondary" style="margin-top:8px;width:100%"
            onclick="deployUnit(${JSON.stringify(unit).replace(/"/g,"'")})">
      Deploy to Board
    </button>`;

  detail.hidden = false;
}

// ─── Dice ────────────────────────────────────────────────────────────────────
function rollDice(diceArray, label) {
  sendRoll(diceArray, label);
}

function animateDiceResult(roll) {
  const display = document.getElementById('dice-result-display');
  display.innerHTML = '';

  const faces = document.createDocumentFragment();
  for (const r of roll.results) {
    const face = document.createElement('div');
    face.className   = 'die-face';
    face.textContent = r;
    faces.appendChild(face);
  }

  const total = document.createElement('div');
  total.className   = 'dice-total';
  total.textContent = `= ${roll.total}`;

  const lbl = document.createElement('div');
  lbl.className   = 'dice-label';
  lbl.textContent = roll.label || '';

  display.appendChild(faces);
  display.appendChild(total);
  if (roll.label) display.appendChild(lbl);
}

function appendDiceHistory(roll) {
  const hist = document.getElementById('dice-history');
  const row  = document.createElement('div');
  row.className = 'dice-history-entry';
  row.innerHTML = `
    <span class="dh-player">${escHtml(roll.player)}</span>
    <span class="dh-result">${roll.total}</span>
    <span class="dh-dice">[${roll.results.join(', ')}]${roll.label ? ' ' + escHtml(roll.label) : ''}</span>
    <span class="dh-time">${roll.timestamp}</span>`;
  hist.prepend(row);
  // Keep only 15 entries
  while (hist.children.length > 15) hist.lastChild.remove();
}

// ─── Chat ────────────────────────────────────────────────────────────────────
function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  if (state.mode === 'multiplayer' && socket) {
    socket.emit('chatMessage', { text });
  } else {
    appendChat(state.playerName || 'Player', text);
  }
}

function appendChat(name, text, isSystem = false, timestamp) {
  const log = document.getElementById('chat-log');
  const row = document.createElement('div');
  row.className = 'chat-msg';

  if (isSystem) {
    row.innerHTML = `<span class="chat-system">— ${escHtml(text)} —</span>`;
  } else {
    const ts = timestamp || new Date().toLocaleTimeString();
    row.innerHTML = `
      <span class="chat-name">${escHtml(name ?? 'System')}:</span>
      <span class="chat-text">${escHtml(text)}</span>
      <span class="chat-time">${ts}</span>`;
  }

  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

// ─── Escape HTML ─────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  initSocket();
  initLobby();

  // Make deployUnit accessible from inline onclick (card detail)
  window.deployUnit = deployUnit;
}

document.addEventListener('DOMContentLoaded', init);
