// ═══════════════════════════════════════════════════════════════════════════
//  Wartable Local — Build a Force
//  Two views: list (saved forces) and builder (create/edit a force).
// ═══════════════════════════════════════════════════════════════════════════

// ─── Type classification ─────────────────────────────────────────────────────
function isCaster(type) {
  return ['warcaster', 'warlock', 'caster'].some(t => (type || '').toLowerCase().includes(t));
}
function isCohort(type) {
  return ['warjack', 'warbeast', 'colossal', 'gargantuan'].some(t => (type || '').toLowerCase().includes(t));
}
function isUnit(type) {
  const t = (type || '').toLowerCase();
  if (['infantry unit', 'cavalry unit', 'battle unit'].some(s => t.includes(s))) return true;
  return t === 'unit';
}
function isSolo(type)   { return (type || '').toLowerCase().includes('solo'); }
function isCA(type)     {
  const t = (type || '').toLowerCase();
  return t.includes('command attachment') || (t.includes('attachment') && !t.includes('jack') && !t.includes('beast'));
}
function isBE(type)     { return (type || '').toLowerCase().includes('battle engine'); }

function categorizeUnit(type) {
  if (isCaster(type))  return 'leaders';
  if (isCohort(type))  return 'cohort';
  if (isCA(type))      return 'commandAttachments';
  if (isUnit(type))    return 'units';
  if (isSolo(type))    return 'solos';
  if (isBE(type))      return 'battleEngines';
  return 'other';
}

function categorizeUnits(units) {
  const cats = { leaders: [], cohort: [], units: [], solos: [], commandAttachments: [], battleEngines: [], other: [] };
  for (const u of units) cats[categorizeUnit(u.type)].push(u);
  return cats;
}

function inferLabels(leaders, cohort) {
  const hasWarcaster = leaders.some(u => (u.type || '').toLowerCase().includes('warcaster'));
  const hasWarlock   = leaders.some(u => (u.type || '').toLowerCase().includes('warlock'));
  const hasWarjack   = cohort.some(u => ['warjack', 'colossal'].some(t => (u.type || '').toLowerCase().includes(t)));
  const hasWarbeast  = cohort.some(u => ['warbeast', 'gargantuan'].some(t => (u.type || '').toLowerCase().includes(t)));
  return {
    leaderLabel: hasWarcaster && !hasWarlock ? 'Warcasters' : hasWarlock && !hasWarcaster ? 'Warlocks' : 'Leaders',
    cohortLabel: hasWarjack  && !hasWarbeast ? 'Warjacks'  : hasWarbeast && !hasWarjack  ? 'Warbeasts' : 'Battlegroup',
  };
}

// ─── App State ───────────────────────────────────────────────────────────────
const state = {
  forces: [],
  sortBy: 'date-desc',

  builder: {
    filename:      null,
    guidStr:       null,
    forceName:     '',
    armyId:        null,
    armyName:      '',
    matchTypeId:   null,
    matchTypeName: '',
    pointLimit:    0,
    leader:        null,
    cards:         [],
    dirty:         false,
  },

  browser: {
    armies:         [],
    matchTypes:     [],
    allUnits:       [],   // full unit list loaded once — filters applied client-side
    mercUnits:      [],
    edition:        'mkiv',
    includeLegends: false,
    showMercs:      false,
    query:          '',
    selectedUnit:   null,
    currentArmy:    null,
  },
};

// ─── Utility ─────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}
function randomUUID() { return crypto.randomUUID(); }

// ─── Edition / army filtering (client-side) ───────────────────────────────────
function armyMatchesEdition(army) {
  const arena = (army.arena || '').toLowerCase();
  const { edition, includeLegends } = state.browser;
  if (!arena) return true; // unknown — show in all editions
  const isLegend = arena.includes('legend') || arena.includes('unlimited');
  if (edition === 'legacy') return arena.includes('legacy');
  // MKIV
  if (isLegend) return includeLegends;
  return !arena.includes('legacy');
}

// Build Set of army names that are valid for the current edition filter
function editionArmyNames() {
  if (!state.browser.armies.length) return null; // no data yet — no restriction
  return new Set(
    state.browser.armies
      .filter(armyMatchesEdition)
      .map(a => a.name.toLowerCase().trim())
  );
}

// Fuzzy army name match (handle minor naming differences between armies API and card data)
function unitBelongsToArmy(unit, armyName) {
  if (!armyName || !Array.isArray(unit.armies) || !unit.armies.length) return true;
  const al = armyName.toLowerCase().trim();
  return unit.armies.some(a => {
    const an = (a || '').toLowerCase().trim();
    return an === al || an.includes(al) || al.includes(an);
  });
}

// Returns the filtered list of units to display in the browser
function getDisplayUnits() {
  let units = state.browser.allUnits;

  // Edition filter — restrict to armies matching current edition
  const validNames = editionArmyNames();
  if (validNames !== null) {
    units = units.filter(u =>
      !u.armies?.length || // if card has no armies listed, show always
      u.armies.some(a => validNames.has((a || '').toLowerCase().trim()))
    );
  }

  // Army-specific filter (only if an army is selected)
  if (state.builder.armyName) {
    units = units.filter(u => unitBelongsToArmy(u, state.builder.armyName));
  }

  return units;
}

// ─── View toggling ────────────────────────────────────────────────────────────
function showListView() {
  document.getElementById('list-view').hidden    = false;
  document.getElementById('builder-view').hidden = true;
  document.querySelectorAll('[data-list]').forEach(el => el.hidden = false);
  document.querySelectorAll('[data-builder]').forEach(el => el.hidden = true);
  loadForces();
}

function showBuilderView() {
  document.getElementById('list-view').hidden    = true;
  document.getElementById('builder-view').hidden = false;
  document.querySelectorAll('[data-list]').forEach(el => el.hidden = true);
  document.querySelectorAll('[data-builder]').forEach(el => el.hidden = false);
  const hasFile = !!state.builder.filename;
  document.getElementById('delete-btn').hidden        = !hasFile;
  document.getElementById('delete-btn-footer').hidden = !hasFile;
}

// ─── List view ────────────────────────────────────────────────────────────────
async function loadForces() {
  try {
    const res = await fetch('/api/forces-resolved');
    state.forces = res.ok ? await res.json() : [];
  } catch { state.forces = []; }
  renderForceList();
}

function sortForces(forces, sortBy) {
  const copy = [...forces];
  const cmpStr = (a, b, key) => {
    const va = key === 'army' ? (a.army?.name || '') : (a.leader?.name || '');
    const vb = key === 'army' ? (b.army?.name || '') : (b.leader?.name || '');
    return va.localeCompare(vb);
  };
  switch (sortBy) {
    case 'date-asc':        return copy.sort((a, b) => new Date(a.mtime) - new Date(b.mtime));
    case 'date-desc':       return copy.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    case 'army-pts-asc':    return copy.sort((a, b) => cmpStr(a, b, 'army')   || a.pointTotal - b.pointTotal);
    case 'army-pts-desc':   return copy.sort((a, b) => cmpStr(a, b, 'army')   || b.pointTotal - a.pointTotal);
    case 'leader-pts-asc':  return copy.sort((a, b) => cmpStr(a, b, 'leader') || a.pointTotal - b.pointTotal);
    case 'leader-pts-desc': return copy.sort((a, b) => cmpStr(a, b, 'leader') || b.pointTotal - a.pointTotal);
    case 'pts-asc':         return copy.sort((a, b) => a.pointTotal - b.pointTotal || cmpStr(a, b, 'army'));
    case 'pts-desc':        return copy.sort((a, b) => b.pointTotal - a.pointTotal || cmpStr(a, b, 'army'));
    default:                return copy;
  }
}

function groupKey(force, sortBy) {
  if (sortBy.startsWith('army'))   return force.army?.name   || '(No Army)';
  if (sortBy.startsWith('leader')) return force.leader?.name || '(No Leader)';
  return null;
}

function renderForceList() {
  const grid   = document.getElementById('forces-grid');
  const msg    = document.getElementById('no-data-msg');
  const count  = document.getElementById('force-count');
  const sorted = sortForces(state.forces, state.sortBy);

  count.textContent = `${sorted.length} force${sorted.length !== 1 ? 's' : ''}`;

  if (!sorted.length) {
    grid.innerHTML = '';
    msg.hidden = false;
    document.getElementById('no-data-text').textContent = 'No saved forces found in your Warmachine App folder.';
    return;
  }

  msg.hidden = true;
  grid.innerHTML = '';
  let lastGroup = null;
  for (const force of sorted) {
    const gk = groupKey(force, state.sortBy);
    if (gk !== null && gk !== lastGroup) {
      lastGroup = gk;
      const hdr = document.createElement('div');
      hdr.className = 'force-group-header';
      hdr.textContent = gk;
      grid.appendChild(hdr);
    }
    grid.appendChild(makeForceCard(force));
  }
}

function makeForceCard(force) {
  const el = document.createElement('div');
  el.className = 'force-card';
  const arena      = force.army?.arena || '';
  const armyName   = force.army?.name  || force.armyId   || '(Unknown Army)';
  const mtName     = force.matchType?.name || force.matchTypeId || '';
  const limit      = force.matchType?.pointLimit;
  const pts        = force.pointTotal || 0;
  const ptsLabel   = limit != null
    ? `<span class="pts-num">${pts}</span> <span class="pts-limit">/ ${limit} pts</span>`
    : `<span class="pts-num">${pts}</span> pts`;
  const cardCount  = (force.cards || []).length;
  const nameDisplay = force.forceName
    || force.filename?.replace(/^force-/i, '').replace(/-[^-]+\.json$/i, '')
    || '(Unnamed)';

  el.innerHTML = `
    <div class="fc-arena">${escHtml(arena)}</div>
    <div class="fc-army">${escHtml(armyName)}</div>
    <div class="fc-leader-row">
      <span class="fc-leader-name">${escHtml(force.leader?.name || '(No Leader)')}</span>
      <span class="fc-leader-type">${escHtml(force.leader?.type || '')}</span>
    </div>
    <div class="fc-divider"></div>
    <div style="font-size:12px;color:var(--text-dim);font-weight:600;">${escHtml(nameDisplay)}</div>
    ${mtName ? `<div class="fc-match">${escHtml(mtName)}</div>` : ''}
    <div class="fc-pts">${ptsLabel} · ${cardCount + (force.leader ? 1 : 0)} card${cardCount + (force.leader ? 1 : 0) !== 1 ? 's' : ''}</div>
    <div class="fc-meta">${fmtDate(force.mtime)}</div>
    <div class="fc-actions">
      <button class="btn edit-btn">Edit</button>
      <button class="btn btn-danger del-btn">✕</button>
    </div>`;

  el.querySelector('.edit-btn').addEventListener('click', () => openBuilder(force));
  el.querySelector('.del-btn').addEventListener('click',  () => deleteForceFromList(force));
  return el;
}

async function deleteForceFromList(force) {
  if (!confirm(`Delete "${force.forceName || force.filename}"?`)) return;
  try {
    const res = await fetch(`/api/force/${encodeURIComponent(force.filename)}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Delete failed'); return; }
    await loadForces();
  } catch (e) { alert('Delete failed: ' + e.message); }
}

// ─── Open Builder ─────────────────────────────────────────────────────────────
async function openBuilder(existingForce) {
  const b = state.builder;

  if (existingForce) {
    b.filename      = existingForce.filename;
    b.guidStr       = existingForce.guidStr;
    b.forceName     = existingForce.forceName || '';
    b.armyId        = existingForce.armyId || null;
    b.armyName      = existingForce.army?.name || '';
    b.matchTypeId   = existingForce.matchTypeId || null;
    b.matchTypeName = existingForce.matchType?.name || '';
    b.pointLimit    = existingForce.matchType?.pointLimit || 0;
    b.leader        = existingForce.leader || null;
    b.cards         = (existingForce.cards || []).map(c => ({ ...c }));
    b.dirty         = false;
  } else {
    Object.assign(b, {
      filename: null, guidStr: null, forceName: '', armyId: null, armyName: '',
      matchTypeId: null, matchTypeName: '', pointLimit: 0, leader: null, cards: [], dirty: false,
    });
  }

  Object.assign(state.browser, { mercUnits: [], selectedUnit: null, query: '', currentArmy: null });
  document.getElementById('browser-search').value = '';

  showBuilderView();

  // Load all three in parallel — units load once and are cached
  await Promise.all([loadArmies(), loadMatchTypes(), loadAllUnits()]);

  // Infer edition from existing force's army
  if (b.armyId && state.browser.armies.length) {
    const army = state.browser.armies.find(a => a.guidStr === b.armyId);
    if (army) {
      state.browser.edition = (army.arena || '').toLowerCase().includes('legacy') ? 'legacy' : 'mkiv';
      state.browser.currentArmy = army;
      const radio = document.querySelector(`input[name="edition"][value="${state.browser.edition}"]`);
      if (radio) radio.checked = true;
    }
  }

  updateEditionUI();
  populateArmyDropdown();
  syncArmySelect();
  syncMatchTypeSelect();
  renderBuilderTop();
  renderBrowser();
  renderRoster();
  updatePtsDisplay();
  hideCardDetail();
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadAllUnits() {
  if (state.browser.allUnits.length) return; // cached — only fetch once per session
  try {
    const res = await fetch('/api/wm-units');
    state.browser.allUnits = res.ok ? await res.json() : [];
  } catch { state.browser.allUnits = []; }
}

async function loadArmies() {
  if (state.browser.armies.length) return;
  try {
    const res = await fetch('/api/wm-armies');
    state.browser.armies = res.ok ? await res.json() : [];
  } catch { state.browser.armies = []; }
}

async function loadMatchTypes() {
  if (state.browser.matchTypes.length) return;
  try {
    const res = await fetch('/api/wm-matchtypes');
    state.browser.matchTypes = res.ok ? await res.json() : [];
  } catch { state.browser.matchTypes = []; }

  const sel = document.getElementById('matchtype-select');
  sel.innerHTML = '<option value="">— Match Type —</option>';
  for (const mt of state.browser.matchTypes) {
    const opt = document.createElement('option');
    opt.value         = mt.guidStr;
    opt.dataset.limit = mt.pointLimit ?? '';
    opt.dataset.name  = mt.name;
    opt.textContent   = mt.name + (mt.pointLimit != null ? ` (${mt.pointLimit} pts)` : '');
    sel.appendChild(opt);
  }
}

async function loadMercUnits(armyId) {
  const army = state.browser.currentArmy || state.browser.armies.find(a => a.guidStr === armyId);
  if (!army) return;
  const ids = army.includedCardIDs || [];
  if (!ids.length) { state.browser.mercUnits = []; return; }
  try {
    const res = await fetch(`/api/wm-units?guids=${ids.join(',')}`);
    state.browser.mercUnits = res.ok ? await res.json() : [];
  } catch { state.browser.mercUnits = []; }
}

// ─── Dropdown management ──────────────────────────────────────────────────────
function populateArmyDropdown() {
  const sel = document.getElementById('army-select');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— All Armies —</option>';
  const filtered = state.browser.armies.filter(armyMatchesEdition);
  for (const a of filtered) {
    const opt = document.createElement('option');
    opt.value        = a.guidStr;
    opt.dataset.name = a.name;
    opt.textContent  = a.name + (a.arena ? ` (${a.arena})` : '');
    sel.appendChild(opt);
  }
  // Restore previous selection if still valid
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function updateEditionUI() {
  document.getElementById('legends-row').hidden = state.browser.edition !== 'mkiv';
}

function syncArmySelect() {
  document.getElementById('army-select').value = state.builder.armyId || '';
}
function syncMatchTypeSelect() {
  document.getElementById('matchtype-select').value = state.builder.matchTypeId || '';
}

function onArmyChange() {
  const sel  = document.getElementById('army-select');
  const opt  = sel.options[sel.selectedIndex];
  const guid = sel.value;
  const name = opt?.dataset.name || '';

  state.builder.armyId   = guid || null;
  state.builder.armyName = name;
  state.builder.dirty    = true;
  state.browser.currentArmy = state.browser.armies.find(a => a.guidStr === guid) || null;
  state.browser.mercUnits   = [];
  state.browser.selectedUnit = null;

  // Mercs are loaded lazily when checkbox is on
  if (state.browser.showMercs && guid) {
    loadMercUnits(guid).then(() => renderBrowser());
  }

  renderBuilderTop();
  renderBrowser();
  hideCardDetail();
  updatePtsDisplay();
}

function onMatchTypeChange() {
  const sel   = document.getElementById('matchtype-select');
  const opt   = sel.options[sel.selectedIndex];
  const guid  = sel.value;
  const limit = parseInt(opt?.dataset.limit) || 0;
  const name  = opt?.dataset.name || '';

  state.builder.matchTypeId   = guid || null;
  state.builder.matchTypeName = name;
  state.builder.pointLimit    = limit;
  state.builder.dirty         = true;

  updateRosterSetup();
  renderBuilderTop();
  updatePtsDisplay();
}

// ─── Builder top bar ──────────────────────────────────────────────────────────
function renderBuilderTop() {
  document.getElementById('force-name-input').value = state.builder.forceName;
  const b = state.builder;
  document.getElementById('bar-army-mt').textContent =
    [b.armyName, b.matchTypeName].filter(Boolean).join(' · ');
}

function updatePtsDisplay() {
  const used  = pointTotal();
  const limit = state.builder.pointLimit;
  const over  = limit > 0 && used > limit;
  const label = limit > 0 ? `${used} / ${limit} pts` : `${used} pts`;

  document.getElementById('bar-pts').textContent = label;
  document.getElementById('pts-num').textContent = label;
  document.getElementById('pts-num').className   = 'pts-bar-num' + (over ? ' over' : '');

  const pct = limit > 0 ? Math.min(used / limit * 100, 100) : 0;
  const bar = document.getElementById('pts-bar');
  bar.style.width = pct + '%';
  bar.className   = 'pts-bar-fill' + (over ? ' over' : '');
}

function pointTotal() {
  return state.builder.cards.reduce((s, c) => s + (c.cost || 0), 0);
}

// ─── Unit Browser ─────────────────────────────────────────────────────────────
function renderBrowser() {
  const list  = document.getElementById('browser-list');
  const empty = document.getElementById('browser-empty');

  // Still loading
  if (!state.browser.allUnits.length) {
    list.innerHTML = '';
    empty.textContent = 'Loading unit data…';
    empty.hidden = false;
    list.appendChild(empty);
    return;
  }

  empty.hidden = true;

  // Apply edition + army filter, then search
  let units = getDisplayUnits();
  const query = state.browser.query.toLowerCase();
  if (query) units = units.filter(u => u.name.toLowerCase().includes(query));

  const cats = categorizeUnits(units);
  const { leaderLabel, cohortLabel } = inferLabels(cats.leaders, cats.cohort);

  const mercFiltered = state.browser.showMercs
    ? state.browser.mercUnits.filter(u => !query || u.name.toLowerCase().includes(query))
    : [];

  list.innerHTML = '';

  const sections = [
    { key: 'leaders',            label: `${leaderLabel} (free)` },
    { key: 'cohort',             label: cohortLabel },
    { key: 'units',              label: 'Units' },
    { key: 'solos',              label: 'Solos' },
    { key: 'commandAttachments', label: 'Command Attachments' },
    { key: 'battleEngines',      label: 'Battle Engines' },
    { key: 'other',              label: 'Other' },
  ];

  let anyVisible = false;

  for (const { key, label } of sections) {
    const items = cats[key] || [];
    if (!items.length) continue;
    anyVisible = true;
    list.appendChild(makeSectionHeader(label, items.length));
    for (const u of items) list.appendChild(makeBrowserUnit(u, false));
  }

  // Mercenaries section
  if (state.browser.showMercs) {
    anyVisible = true;
    list.appendChild(makeSectionHeader('Mercenaries', mercFiltered.length));
    if (mercFiltered.length) {
      for (const u of mercFiltered) list.appendChild(makeBrowserUnit(u, true));
    } else {
      const note = document.createElement('div');
      note.className   = 'browser-no-mercs';
      note.textContent = state.browser.currentArmy
        ? 'No mercenaries listed for this army.'
        : 'Select an army to see available mercenaries.';
      list.appendChild(note);
    }
  }

  if (!anyVisible) {
    const msg = document.createElement('div');
    msg.className   = 'browser-empty';
    msg.textContent = query ? 'No units match the search.' : 'No unit data found. Ensure the Warmachine App is installed.';
    list.appendChild(msg);
  }
}

function makeSectionHeader(label, count) {
  const hdr = document.createElement('div');
  hdr.className = 'browser-section-hdr';
  hdr.innerHTML = `<span class="bsh-label">${escHtml(label)}</span><span class="bsh-count">${count}</span><span class="bsh-toggle">▾</span>`;
  hdr.addEventListener('click', () => {
    const collapsed = hdr.classList.toggle('collapsed');
    let el = hdr.nextSibling;
    while (el && !(el.classList?.contains('browser-section-hdr'))) {
      if (el.nodeType === 1) el.style.display = collapsed ? 'none' : '';
      el = el.nextSibling;
    }
  });
  return hdr;
}

function makeBrowserUnit(unit, isMerc) {
  const row      = document.createElement('div');
  const isLeader = state.builder.leader?._cardId === unit.guidStr;
  const inForce  = isLeader || state.builder.cards.some(c => c._cardId === unit.guidStr);
  const caster   = isCaster(unit.type);
  const selected = state.browser.selectedUnit?.guidStr === unit.guidStr;

  row.className    = 'browser-unit' + (inForce ? ' in-force' : '') + (selected ? ' selected' : '');
  row.dataset.guid = unit.guidStr || '';

  const costLabel = caster ? 'free' : (unit.cost ?? '?');
  const dotBg     = isMerc ? 'var(--accent)' : 'var(--accent2)';

  row.innerHTML = `
    <div class="bu-dot" style="background:${dotBg}"></div>
    <div class="bu-name" title="${escHtml(unit.name)}">${escHtml(unit.name)}</div>
    <div class="bu-cost ${caster ? 'free' : ''}">${costLabel}</div>
    <button class="bu-add ${isLeader ? 'is-leader' : ''}" ${inForce && !isLeader ? 'disabled' : ''}>
      ${isLeader ? '★' : inForce ? '✓' : '+'}
    </button>`;

  row.addEventListener('click', e => {
    if (e.target.classList.contains('bu-add')) return;
    showCardDetail(unit);
  });
  row.querySelector('.bu-add').addEventListener('click', e => {
    e.stopPropagation();
    if (caster) setLeader(unit);
    else if (!inForce) addCard(unit);
  });

  return row;
}

// ─── Card Detail Panel ────────────────────────────────────────────────────────
function showCardDetail(unit) {
  state.browser.selectedUnit = unit;
  document.querySelectorAll('.browser-unit').forEach(el =>
    el.classList.toggle('selected', el.dataset.guid === unit.guidStr));
  const panel = document.getElementById('card-detail');
  panel.hidden = false;
  renderCardDetail(unit, panel);
}

function hideCardDetail() {
  state.browser.selectedUnit = null;
  const panel = document.getElementById('card-detail');
  panel.hidden = true;
  panel.innerHTML = '';
  document.querySelectorAll('.browser-unit').forEach(el => el.classList.remove('selected'));
}

function refreshCardDetail() {
  const panel = document.getElementById('card-detail');
  if (!panel.hidden && state.browser.selectedUnit) {
    renderCardDetail(state.browser.selectedUnit, panel);
  }
}

function renderCardDetail(unit, panel) {
  const caster   = isCaster(unit.type);
  const isLeader = state.builder.leader?._cardId === unit.guidStr;
  const inForce  = isLeader || state.builder.cards.some(c => c._cardId === unit.guidStr);
  const costLabel = caster ? 'Free' : `${unit.cost ?? '?'} pts`;

  // Stat bar
  const STAT_KEYS = ['spd', 'str', 'mat', 'rat', 'def', 'arm', 'cmd'];
  const PIP_STAT  = unit.stats?.focus != null ? 'focus'
                  : unit.stats?.fury  != null ? 'fury'
                  : unit.focus        != null ? 'focus'
                  : unit.fury         != null ? 'fury'
                  : unit.stats?.threshold != null ? 'threshold' : null;
  const PIP_VAL   = PIP_STAT ? (unit.stats?.[PIP_STAT] ?? unit[PIP_STAT]) : null;
  const PIP_LABEL = PIP_STAT === 'focus' ? 'FOC' : PIP_STAT === 'fury' ? 'FRY' : PIP_STAT === 'threshold' ? 'THR' : null;

  let statsHtml = STAT_KEYS.map(k => {
    const v = unit.stats?.[k] ?? '–';
    return `<div class="cd-stat"><div class="cd-stat-label">${k.toUpperCase()}</div><div class="cd-stat-val">${v}</div></div>`;
  }).join('');
  if (PIP_STAT && PIP_LABEL && PIP_VAL != null) {
    statsHtml += `<div class="cd-stat cd-stat-pip"><div class="cd-stat-label">${PIP_LABEL}</div><div class="cd-stat-val">${PIP_VAL}</div></div>`;
  }

  // Weapons
  const weapons = unit.weapons || [];
  const weaponsHtml = weapons.map(w => {
    const wStats = w.stats || {};
    const statParts = [];
    if (wStats.rng != null) statParts.push(`RNG ${wStats.rng}`);
    if (wStats.rof != null) statParts.push(`ROF ${wStats.rof}`);
    if (wStats.aoe != null && wStats.aoe !== '-') statParts.push(`AOE ${wStats.aoe}`);
    if (wStats.pow != null) statParts.push(`POW ${wStats.pow}`);
    const typeIcon  = (w.type || '').toLowerCase().includes('ranged') ? '↗' : '⚔';
    const props     = [...(w.properties || []), ...(w.abilities || [])];
    const countStr  = (w.count && w.count !== '1') ? ` ×${w.count}` : '';
    const locStr    = w.loc ? ` <span style="color:var(--text-muted);font-size:10px;">${escHtml(w.loc)}</span>` : '';
    return `<div class="cd-weapon">
      <div class="cd-weapon-hdr">
        <span class="cd-weapon-icon">${typeIcon}</span>
        <span class="cd-weapon-name">${escHtml(w.name)}${countStr}</span>${locStr}
        ${statParts.length ? `<span class="cd-weapon-stats">${statParts.join(' · ')}</span>` : ''}
      </div>
      ${props.length ? `<div class="cd-weapon-props">${props.map(p => escHtml(p)).join(' · ')}</div>` : ''}
    </div>`;
  }).join('');

  // Abilities — use rulesText if available (has descriptions), else names only
  const rulesText  = unit.rulesText || {};
  const ruleEntries = Object.entries(rulesText);
  let abilitiesHtml = ruleEntries.length
    ? ruleEntries.map(([name, text]) =>
        `<div class="cd-ability">
          <div class="cd-ability-name">${escHtml(name)}</div>
          ${text ? `<div class="cd-ability-text">${escHtml(text)}</div>` : ''}
        </div>`).join('')
    : (unit.abilities || []).map(a =>
        `<div class="cd-ability"><div class="cd-ability-name">${escHtml(a)}</div></div>`).join('');

  // Feat
  let featHtml = '';
  if (unit.feat && typeof unit.feat === 'object') {
    const entries = Object.entries(unit.feat);
    if (entries.length) {
      const [featName, featText] = entries[0];
      featHtml = `<div class="cd-section">
        <div class="cd-section-hdr">Feat</div>
        <div class="cd-feat-name">${escHtml(featName)}</div>
        ${featText ? `<div class="cd-feat-text">${escHtml(featText)}</div>` : ''}
      </div>`;
    }
  }

  // Options
  const opts = unit.options || [];
  const optionsHtml = opts.length
    ? `<div class="cd-section"><div class="cd-section-hdr">Options</div>${
        opts.map(o => `<div class="cd-option">${escHtml(typeof o === 'string' ? o : (o.name || o.displayName || ''))}</div>`).join('')
      }</div>` : '';

  // Keywords
  const kwHtml = (unit.keywords || []).length
    ? `<div class="cd-keywords">${unit.keywords.map(k => `<span class="cd-kw">${escHtml(k)}</span>`).join('')}</div>`
    : '';

  // Add button
  const addLabel    = caster ? (isLeader ? '★ Current Leader' : '★ Set as Leader')
                    : (inForce ? '✓ In Force' : '+ Add to Force');
  const addDisabled = (inForce && !caster) ? 'disabled' : '';

  panel.innerHTML = `
    <div class="cd-close-row">
      <button class="cd-close-btn" id="cd-close-btn">✕</button>
    </div>
    <div class="cd-header">
      <div class="cd-name">${escHtml(unit.name)}</div>
      <div class="cd-type-cost">
        <span class="cd-type-label">${escHtml(unit.type || '')}</span>
        <span class="cd-cost-label">${costLabel}</span>
        ${unit.fa ? `<span class="cd-fa">FA: ${escHtml(String(unit.fa))}</span>` : ''}
      </div>
      ${kwHtml}
    </div>
    <div class="cd-stats-row">${statsHtml}</div>
    <div class="cd-info-row">
      ${unit.damageBoxes != null ? `<span class="cd-info-chip">HP ${unit.damageBoxes}</span>` : ''}
      ${unit.baseSize    ? `<span class="cd-info-chip">${escHtml(unit.baseSize)} base</span>` : ''}
      ${unit.factionName ? `<span class="cd-info-chip">${escHtml(unit.factionName)}</span>`   : ''}
    </div>
    ${weapons.length  ? `<div class="cd-section"><div class="cd-section-hdr">Weapons</div>${weaponsHtml}</div>` : ''}
    ${abilitiesHtml   ? `<div class="cd-section"><div class="cd-section-hdr">Abilities</div>${abilitiesHtml}</div>` : ''}
    ${featHtml}
    ${optionsHtml}
    <div class="cd-footer">
      <button class="cd-add-btn btn btn-primary btn-sm" id="cd-add-btn" ${addDisabled}>${addLabel}</button>
    </div>`;

  panel.querySelector('#cd-close-btn').addEventListener('click', hideCardDetail);
  panel.querySelector('#cd-add-btn').addEventListener('click', () => {
    if (caster) setLeader(unit);
    else if (!inForce) addCard(unit);
    refreshCardDetail();
    renderBrowser();
  });
}

// ─── Roster Management ────────────────────────────────────────────────────────
function setLeader(unit) {
  state.builder.leader = {
    _cardId: unit.guidStr || '', _forceCardGuid: randomUUID(),
    name: unit.name, type: unit.type, guidStr: unit.guidStr || '',
  };
  state.builder.dirty = true;
  renderBrowser(); renderRoster(); updatePtsDisplay(); refreshCardDetail();
}

function addCard(unit) {
  state.builder.cards.push({
    _cardId: unit.guidStr || '', _forceCardGuid: randomUUID(),
    name: unit.name, type: unit.type, cost: unit.cost || 0, guidStr: unit.guidStr || '',
  });
  state.builder.dirty = true;
  renderBrowser(); renderRoster(); updatePtsDisplay(); refreshCardDetail();
}

function removeCard(idx) {
  state.builder.cards.splice(idx, 1);
  state.builder.dirty = true;
  renderBrowser(); renderRoster(); updatePtsDisplay(); refreshCardDetail();
}

function removeLeader() {
  state.builder.leader = null;
  state.builder.dirty  = true;
  renderBrowser(); renderRoster(); refreshCardDetail();
}

function renderRoster() {
  const body = document.getElementById('roster-body');
  body.innerHTML = '';
  const b = state.builder;

  const leaderType  = (b.leader?.type || '').toLowerCase();
  const leaderLabel = leaderType.includes('warcaster') ? 'Warcaster' : leaderType.includes('warlock') ? 'Warlock' : 'Leader';
  const cohortLabel = leaderType.includes('warcaster') ? 'Warjacks'  : leaderType.includes('warlock') ? 'Warbeasts' : 'Cohort';

  const cohortCards = b.cards.filter(c => isCohort(c.type));
  const unitCards   = b.cards.filter(c => isUnit(c.type));
  const soloCards   = b.cards.filter(c => isSolo(c.type));
  const caCards     = b.cards.filter(c => isCA(c.type));
  const beCards     = b.cards.filter(c => isBE(c.type));
  const otherCards  = b.cards.filter(c => !['leaders','cohort','units','solos','commandAttachments','battleEngines'].includes(categorizeUnit(c.type)));

  function appendSection(label, items, isLeaderSection) {
    const hdr = document.createElement('div');
    hdr.className   = 'roster-section-hdr';
    hdr.textContent = isLeaderSection ? label : `${label} (${items.length})`;
    body.appendChild(hdr);

    if (isLeaderSection) {
      if (b.leader) {
        body.appendChild(makeRosterCard(b.leader, null, true));
      } else {
        const empty = document.createElement('div');
        empty.className = 'roster-empty';
        empty.textContent = 'No leader — pick a warcaster or warlock.';
        body.appendChild(empty);
      }
    } else {
      for (const card of items) {
        body.appendChild(makeRosterCard(card, b.cards.indexOf(card), false));
      }
    }
  }

  appendSection(leaderLabel, [], true);
  if (cohortCards.length) appendSection(cohortLabel, cohortCards);
  if (unitCards.length)   appendSection('Units', unitCards);
  if (soloCards.length)   appendSection('Solos', soloCards);
  if (caCards.length)     appendSection('Command Attachments', caCards);
  if (beCards.length)     appendSection('Battle Engines', beCards);
  if (otherCards.length)  appendSection('Other', otherCards);

  updateRosterSetup();
}

function makeRosterCard(card, idx, isLeader) {
  const el = document.createElement('div');
  el.className = 'roster-card' + (isLeader ? ' leader-card' : '');
  el.innerHTML = `
    <div class="rc-dot" style="background:var(--accent2)"></div>
    <div style="flex:1;min-width:0;">
      <div class="rc-name">${escHtml(card.name)}</div>
      <div class="rc-type">${escHtml(card.type || '')}</div>
    </div>
    <div class="rc-cost ${isLeader ? 'free-cost' : ''}">${isLeader ? 'free' : `${card.cost ?? 0} pts`}</div>
    <button class="rc-remove" title="Remove">✕</button>`;
  el.querySelector('.rc-remove').addEventListener('click', () => {
    if (isLeader) removeLeader(); else removeCard(idx);
  });
  return el;
}

function updateRosterSetup() {
  const b    = state.builder;
  const info = document.getElementById('setup-info');
  if (b.armyName || b.matchTypeName) {
    const parts = [];
    if (b.armyName)      parts.push(`<strong>${escHtml(b.armyName)}</strong>`);
    if (b.matchTypeName) parts.push(escHtml(b.matchTypeName) + (b.pointLimit ? ` · ${b.pointLimit} pts` : ''));
    info.innerHTML   = parts.join('<br>');
    info.style.color = 'var(--text)';
  } else {
    info.textContent  = 'Select an army and match type.';
    info.style.color  = 'var(--text-muted)';
  }
}

// ─── Save / Delete ────────────────────────────────────────────────────────────
async function saveForce() {
  const b = state.builder;
  if (!b.forceName.trim()) {
    const inp = document.getElementById('force-name-input');
    inp.focus(); inp.style.borderColor = 'var(--danger)'; return;
  }
  if (!b.armyId)      { alert('Please select an army.'); return; }
  if (!b.matchTypeId) { alert('Please select a match type.'); return; }

  const forceGuid  = b.guidStr || randomUUID();
  const forceCards = [];
  if (b.leader) {
    forceCards.push({ _cardId: b.leader._cardId, _attachedForceCardIds: [], _cardOption1Ids: [], _cardOption2Ids: [], guidStr: b.leader._forceCardGuid || randomUUID() });
  }
  for (const card of b.cards) {
    forceCards.push({ _cardId: card._cardId, _attachedForceCardIds: [], _cardOption1Ids: [], _cardOption2Ids: [], guidStr: card._forceCardGuid || randomUUID() });
  }
  const force = {
    _forceName: b.forceName.trim(), _armyId: b.armyId, _matchTypeId: b.matchTypeId,
    guidStr: forceGuid, _forceCards: forceCards, _commandCardIds: [],
    isTempForce: false, _isOppForce: false,
  };

  try {
    const res = await fetch('/api/force', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: b.filename, force }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Save failed'); return; }
    const saved = await res.json();
    b.filename = saved.filename; b.guidStr = saved.guidStr; b.dirty = false;
    document.getElementById('delete-btn').hidden        = false;
    document.getElementById('delete-btn-footer').hidden = false;
    ['save-btn', 'save-btn-footer'].forEach(id => {
      const btn = document.getElementById(id);
      const orig = btn.textContent;
      btn.textContent = '✓ Saved';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  } catch (e) { alert('Save failed: ' + e.message); }
}

async function deleteForce() {
  const b = state.builder;
  if (!b.filename) return;
  if (!confirm(`Delete "${b.forceName || b.filename}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/force/${encodeURIComponent(b.filename)}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Delete failed'); return; }
    showListView();
  } catch (e) { alert('Delete failed: ' + e.message); }
}

// ─── Event Wiring ─────────────────────────────────────────────────────────────
function wireEvents() {
  document.getElementById('new-force-btn').addEventListener('click', () => openBuilder(null));
  document.getElementById('sort-select').addEventListener('change', e => {
    state.sortBy = e.target.value; renderForceList();
  });

  document.getElementById('back-btn').addEventListener('click', () => {
    if (state.builder.dirty && !confirm('Leave without saving?')) return;
    showListView();
  });
  document.getElementById('force-name-input').addEventListener('input', e => {
    state.builder.forceName = e.target.value;
    state.builder.dirty     = true;
    e.target.style.borderColor = '';
  });
  document.getElementById('save-btn').addEventListener('click',           saveForce);
  document.getElementById('delete-btn').addEventListener('click',         deleteForce);
  document.getElementById('save-btn-footer').addEventListener('click',   saveForce);
  document.getElementById('delete-btn-footer').addEventListener('click', deleteForce);

  document.getElementById('army-select').addEventListener('change',      onArmyChange);
  document.getElementById('matchtype-select').addEventListener('change', onMatchTypeChange);

  // Edition radios
  document.querySelectorAll('input[name="edition"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.browser.edition = radio.value;
      // Clear army selection since edition changed
      state.builder.armyId   = null;
      state.builder.armyName = '';
      state.browser.currentArmy  = null;
      state.browser.mercUnits    = [];
      state.browser.selectedUnit = null;
      updateEditionUI();
      populateArmyDropdown();
      document.getElementById('army-select').value = '';
      renderBuilderTop();
      renderBrowser();
      hideCardDetail();
    });
  });

  // Include Legends checkbox
  document.getElementById('legends-cb').addEventListener('change', e => {
    state.browser.includeLegends = e.target.checked;
    const prevId = state.builder.armyId;
    populateArmyDropdown();
    // If army is no longer in the filtered list, deselect it
    const sel = document.getElementById('army-select');
    if (prevId && ![ ...sel.options].some(o => o.value === prevId)) {
      state.builder.armyId   = null;
      state.builder.armyName = '';
      sel.value = '';
      renderBuilderTop();
      hideCardDetail();
    }
    renderBrowser();
  });

  // Show Mercenaries checkbox
  document.getElementById('mercs-cb').addEventListener('change', async e => {
    state.browser.showMercs = e.target.checked;
    if (e.target.checked && state.builder.armyId) {
      await loadMercUnits(state.builder.armyId);
    } else {
      state.browser.mercUnits = [];
    }
    renderBrowser();
  });

  // Search
  document.getElementById('browser-search').addEventListener('input', e => {
    state.browser.query = e.target.value.trim();
    renderBrowser();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  wireEvents();
  showListView();
}

document.addEventListener('DOMContentLoaded', init);
