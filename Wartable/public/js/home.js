// ═══════════════════════════════════════════════════════════════════════════
//  Wartable Local — Home Page
//  Handles navigation tile clicks and the play card form.
//  No sockets here — all socket setup happens in game.js.
// ═══════════════════════════════════════════════════════════════════════════

const playCard      = document.getElementById('play-card');
const playStatus    = document.getElementById('play-status');
const nameInput     = document.getElementById('player-name');
const roomInput     = document.getElementById('room-code-input');

// ─── Tile: Build a Force ─────────────────────────────────────────────────────
document.getElementById('tile-forces').addEventListener('click', () => {
  window.location.href = '/forces.html';
});

// ─── Tile: Play ──────────────────────────────────────────────────────────────
document.getElementById('tile-play').addEventListener('click', () => {
  const isOpen = !playCard.hidden;
  playCard.hidden = isOpen;
  document.getElementById('tile-play').classList.toggle('active-tile', !isOpen);
  if (!isOpen) nameInput.focus();
});

// ─── Play card buttons ────────────────────────────────────────────────────────
document.getElementById('solo-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { showError('Please enter your name.'); nameInput.focus(); return; }
  navigate('solo', name, null);
});

document.getElementById('create-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { showError('Please enter your name.'); nameInput.focus(); return; }
  navigate('multiplayer', name, null);
});

document.getElementById('join-btn').addEventListener('click', joinRoom);
roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('solo-btn').click(); });

function joinRoom() {
  const name = nameInput.value.trim();
  const code = roomInput.value.trim().toUpperCase();
  if (!name) { showError('Please enter your name.'); nameInput.focus(); return; }
  if (!code || code.length < 4) { showError('Enter a 4-character room code.'); roomInput.focus(); return; }
  navigate('multiplayer', name, code);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigate(mode, name, room) {
  const params = new URLSearchParams({ mode, name });
  if (room) params.set('room', room);
  window.location.href = `/game.html?${params}`;
}

// ─── Status helpers ───────────────────────────────────────────────────────────
function showError(msg) {
  playStatus.textContent = msg;
  playStatus.className   = 'play-status error';
  playStatus.hidden      = false;
}
