// public/client.js
let ws = null;
let mySeat = null;
let selected = new Set();
let lastState = null;
let lastMessage = '';

// DOM refs
const els = {
  room: document.getElementById('room'),
  name: document.getElementById('name'),
  joinBtn: document.getElementById('joinBtn'),
  startBtn: document.getElementById('startBtn'),
  status: document.getElementById('status'),

  wrap: document.getElementById('tableWrap'),
  table: document.getElementById('table'),
  seats: document.getElementById('seats'),
  stage: document.getElementById('stage'),
  msg: document.getElementById('msg'),
  pot: document.getElementById('pot'),
  potChips: document.getElementById('potChips'),
  dealerBtn: document.getElementById('dealerBtn'),

  actions: {
    check: document.getElementById('checkBtn'),
    bet: document.getElementById('betBtn'),
  betControl: document.getElementById('betControl'),
  betAmount: document.getElementById('betAmount'),
  betConfirm: document.getElementById('betConfirm'),
    call: document.getElementById('callBtn'),
    fold: document.getElementById('foldBtn'),
    discard: document.getElementById('discardBtn'),
    hint: document.getElementById('discardHint'),
  },

  toasts: document.getElementById('toasts'),
  overlay: document.getElementById('overlay'),
  overlayText: document.getElementById('overlayText'),
  overlayBtn: document.getElementById('overlayBtn'),
};

// utility
const MSG_BLACKLIST = new Set(); // keep empty to show all messages

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => { els.status.textContent = 'Connesso'; });
  ws.addEventListener('close', () => { els.status.textContent = 'Disconnesso'; });
  ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { console.warn('Invalid ws message', e.data); return; }
    if (msg.type === 'message') {
      els.status.textContent = msg.text || '';
    } else if (msg.type === 'state' && msg.state) {
  // debug: log incoming actions for investigation
  try { console.log('[client] incoming state for youSeat=', msg.state.youSeat, 'toAct=', msg.state.toActSeat, 'actions=', msg.state.actions); } catch (e) {}
      // clear transient UI to avoid blocked popups from previous states
      clearAllToasts();
      const prevMsg = lastState?.message || '';
      render(msg.state);

      // Show overlay ONLY when server explicitly requests it (won or showOverlay)
      if (msg.state.won || msg.state.showOverlay) {
        showOverlay(msg.state.overlayText || 'Hai vinto!');
      } else {
        hideOverlay();
      }

      const newMsg = msg.state.message || '';
      if (newMsg && newMsg !== prevMsg && !MSG_BLACKLIST.has(newMsg)) showToast(newMsg);
    }
  });

  ws.addEventListener('error', (err) => {
    console.warn('WebSocket error', err);
  });
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('Non connesso al server');
    return;
  }
  try { ws.send(JSON.stringify(obj)); } catch (err) { console.warn('Send failed', err); }
}

// helpers
function clearAllToasts() {
  const toasts = els.toasts;
  if (!toasts) return;
  toasts.querySelectorAll('.toast').forEach(n => n.remove());
  lastMessage = '';
}

function showToast(text) {
  if (!text) return;
  clearAllToasts();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  els.toasts.appendChild(t);
  lastMessage = text;
  setTimeout(() => {
    try { t.remove(); } catch {}
    if (lastMessage === text) lastMessage = '';
  }, 2200);
}

function hideOverlay() {
  if (!els.overlay.classList.contains('hidden')) {
    els.overlay.classList.add('hidden');
  }
}

function showOverlay(text) {
  els.overlayText.textContent = text || '';
  els.overlay.classList.remove('hidden');
}

// rendering helpers
function renderCard(c) {
  const div = document.createElement('div');
  div.className = 'card';
  if (!c || !c.r) { div.classList.add('back'); div.textContent = '🂠'; return div; }
  if (c.s === '♦' || c.s === '♥') div.className += ' red';
  div.textContent = `${c.r}${c.s}`;
  return div;
}

function valueToChips(v) {
  const denoms = [100, 25, 5, 1];
  const colors = { 100: 'black', 25: 'green', 5: 'red', 1: '' };
  const labels = { 100: '100', 25: '25', 5: '5', 1: '' };
  const out = [];
  let rem = Math.max(0, Math.floor(Number(v) || 0));
  for (const d of denoms) {
    let n = Math.floor(rem / d);
    if (n > 8) n = 8;
    for (let i = 0; i < n; i++) out.push({ d, color: colors[d], label: labels[d] });
    rem -= n * d;
  }
  return out;
}

function renderChipStack(container, amount) {
  if (!container) return;
  container.innerHTML = '';
  if (!amount || amount <= 0) return;
  valueToChips(amount).forEach(ch => {
    const c = document.createElement('div');
    c.className = 'chip' + (ch.color ? ' ' + ch.color : '');
    if (ch.label) c.textContent = ch.label;
    container.appendChild(c);
  });
}

function hashName(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || 'Player');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeAvatar(name) {
  const h = hashName(name);
  const hue = h % 360;
  const styleIdx = (h >> 8) % 5;
  const hairColor = `hsl(${hue}, 70%, 35%)`;

  const avatar = document.createElement('div'); avatar.className = 'avatar';
  const hair = document.createElement('div'); hair.className = 'hair'; hair.style.background = hairColor;
  if (styleIdx === 0) { hair.style.borderBottomLeftRadius = '50% 80%'; hair.style.borderBottomRightRadius = '50% 80%'; }
  else if (styleIdx === 1) hair.style.height = '70%';
  else if (styleIdx === 2) hair.style.borderBottomLeftRadius = '80% 80%';
  else if (styleIdx === 3) hair.style.borderBottomRightRadius = '80% 80%';
  else if (styleIdx === 4) hair.style.transform = 'skewX(-6deg)';
  const face = document.createElement('div'); face.className = 'face'; face.textContent = '·͜·';
  avatar.appendChild(hair); avatar.appendChild(face);
  return avatar;
}

// toggle select
function toggleSelect(idx, max) {
  if (typeof idx !== 'number' || idx < 0) return;
  if (selected.has(idx)) selected.delete(idx);
  else if (selected.size < max) selected.add(idx);
  updateDiscardHint(max);

  const meCards = els.seats.querySelector(`.seat[data-idx="${mySeat}"] .cards`);
  if (!meCards) return;
  [...meCards.querySelectorAll('.card')].forEach((el, i) => {
    el.classList.toggle('selected', selected.has(i));
    el.setAttribute('aria-pressed', selected.has(i));
  });
}

function updateDiscardHint(max) {
  const n = selected.size;
  if (els.actions.hint) {
    els.actions.hint.textContent = n ? `${n}/${max} selezionate` : `Seleziona fino a ${max} carte`;
  }
  // Fix: aggiorna lo stato del pulsante scarta in tempo reale
  if (els.actions.discard) {
    const canDiscard = lastState?.actions?.includes('Discard');
    els.actions.discard.disabled = !canDiscard || n === 0;
  }
}

// main render
function render(state) {
  if (!state) return;
  lastState = state;
  if (els.wrap) els.wrap.classList.remove('hidden');
  mySeat = typeof state.youSeat === 'number' ? state.youSeat : null;

  els.stage.textContent = `${state.stage || ''}`;
  els.pot.textContent = `Pot: ${state.pot || 0}`;
  renderChipStack(els.potChips, state.pot || 0);

  const MAX = state.config && state.config.MAX_SEATS ? state.config.MAX_SEATS : 6;
  els.seats.innerHTML = '';

  for (let s = 0; s < MAX; s++) {
    const pd = (state.players && state.players[s]) || { empty: true };
    const seat = document.createElement('div'); seat.className = 'seat'; seat.dataset.idx = s;

    if (state.toActSeat === s && /(bet1|bet2)/.test(state.stage || '')) seat.classList.add('turn');

    const head = document.createElement('div'); head.className = 'head';
    const left = document.createElement('div'); left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '.5rem';
    // avatar / placeholder
    left.appendChild(makeAvatar(pd?.name || 'Posto libero'));
    const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = pd?.name || 'Posto libero';
    left.appendChild(nm);
    // se posto libero, aggiungi bottone per inserire un bot
    if (pd && pd.empty) {
      const addBtn = document.createElement('button');
      addBtn.className = 'act add-bot-btn';
      addBtn.textContent = 'Aggiungi BOT';
      addBtn.title = 'Aggiungi un bot in questo posto';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        send({ type: 'add-bot' });
      });
      // rendi il bottone più piccolo rispetto alle azioni principali
      addBtn.style.padding = '.35rem .6rem';
      addBtn.style.fontSize = '.85rem';
      addBtn.style.minWidth = 'auto';
      left.appendChild(addBtn);
    }
    const flags = document.createElement('div'); flags.className = 'flags';
    const tIcon = document.createElement('span'); tIcon.className = 'turn-icon';
    tIcon.textContent = (state.toActSeat === s && /(bet1|bet2)/.test(state.stage || '')) ? '▶' : '';
    const fd = document.createElement('span'); fd.className = 'fold'; fd.textContent = pd?.folded ? 'Fold' : '';
    flags.append(tIcon, fd);
    head.append(left, flags);
    seat.appendChild(head);

    const cards = document.createElement('div'); cards.className = 'cards';
    if (pd && !pd.empty && Array.isArray(pd.cards)) {
      cards.classList.toggle('selectable', s === mySeat && state.stage === 'draw' && !pd.drew);
      pd.cards.forEach((c, i) => {
        const cardEl = renderCard(c);
        if (s === mySeat && state.stage === 'draw' && !pd.drew) {
          cardEl.addEventListener('click', () => {
            toggleSelect(i, state.config?.MAX_DISCARD || 3);
            updateDiscardHint(state.config?.MAX_DISCARD || 3); // Aggiorna subito il pulsante
          });
          cardEl.tabIndex = 0;
          cardEl.setAttribute('role', 'button');
          cardEl.setAttribute('aria-label', `Carta ${i+1}`);
        }
        cards.appendChild(cardEl);
      });
    } else {
      for (let i = 0; i < 5; i++) cards.appendChild(renderCard({}));
    }
    seat.appendChild(cards);

    const betA = document.createElement('div'); betA.className = 'bet-area';
    const bc = document.createElement('div'); bc.className = 'chip-stack';
    const ba = document.createElement('div'); ba.className = 'bet-amt';
    if (pd?.bet > 0) {
      renderChipStack(bc, pd.bet);
      ba.textContent = `+${pd.bet}`;
    }
    betA.append(bc, ba);
    seat.appendChild(betA);

    const st = document.createElement('div'); st.className = 'stack';
    const sc = document.createElement('div'); sc.className = 'chip-stack';
    const sttxt = document.createElement('div'); sttxt.textContent = (pd && !pd.empty) ? `Stack: ${pd.stack || 0}` : '';
    if (pd && !pd.empty) renderChipStack(sc, pd.stack || 0);
    st.append(sc, sttxt);
    seat.appendChild(st);

    els.seats.appendChild(seat);
  }

  if (typeof state.dealerSeat === 'number') posDealerBtnForSeat(state.dealerSeat);

  // message text
  els.msg.textContent = state.message || '';

  updateActions(state);

  const me = (state.players && typeof mySeat === 'number') ? state.players[mySeat] : null;
  if (state.stage !== 'draw' || me?.drew) {
    selected.clear();
    updateDiscardHint(state.config?.MAX_DISCARD || 3);
    // ensure any selected classes removed from DOM
    const meCards = els.seats.querySelector(`.seat[data-idx="${mySeat}"] .cards`);
    if (meCards) [...meCards.querySelectorAll('.card')].forEach(el => el.classList.remove('selected'));
  }

  els.startBtn.disabled = !(['lobby', 'showdown'].includes(state.stage));
}

// actions
function updateActions(state) {
  const acts = new Set(state.actions || []);
  const a = els.actions;
  if (!a) return;

  a.check.disabled = !acts.has('Check');
  a.bet.disabled = !acts.has('Bet');
  a.call.disabled = !acts.has('Call');
  a.fold.disabled = !acts.has('Fold');

  const canDiscard = acts.has('Discard');
  a.discard.disabled = !canDiscard || selected.size === 0;
  a.hint.style.visibility = canDiscard ? 'visible' : 'hidden';

  if (['lobby', 'showdown'].includes(state.stage)) {
    ['check', 'bet', 'call', 'fold', 'discard'].forEach(k => {
      if (a[k]) a[k].disabled = true;
    });
    if (a.hint) a.hint.style.visibility = 'hidden';
  }

  // Bet control visibility and bounds
  try {
    const me = (state.players && typeof state.youSeat === 'number') ? state.players[state.youSeat] : null;
    if (a.betControl) {
      if (acts.has('Bet')) {
        a.betControl.classList.remove('hidden');
        a.betControl.setAttribute('aria-hidden', 'false');
        const min = Math.max(state.config?.BET || 1, 1);
        const max = me ? Math.max(1, me.stack || 0) : min;
        if (a.betAmount) { a.betAmount.min = min; a.betAmount.max = max; if (Number(a.betAmount.value) < min) a.betAmount.value = min; }
      } else {
        a.betControl.classList.add('hidden');
        a.betControl.setAttribute('aria-hidden', 'true');
      }
    }
  } catch (e) {}
}

// position dealer button
function posDealerBtnForSeat(seatIdx) {
  const seatEl = els.seats.querySelector(`.seat[data-idx="${seatIdx}"]`);
  if (!seatEl || !els.table) return;
  const tRect = els.table.getBoundingClientRect();
  const sRect = seatEl.getBoundingClientRect();
  const cx = sRect.left + sRect.width / 2 - tRect.left;
  const cy = sRect.top + sRect.height / 2 - tRect.top;
  els.dealerBtn.style.left = `${cx}px`;
  els.dealerBtn.style.top = `${cy - 40}px`;
}

// setup events
function setupEvents() {
  // make sure we don't attach duplicates if called multiple times
  if (setupEvents._done) return;
  setupEvents._done = true;

  els.joinBtn.addEventListener('click', () => {
    const room = (els.room.value || '').trim().toUpperCase();
    const name = (els.name.value || '').trim();
    if (!room || !name) { showToast('Inserisci stanza e nome'); return; }
    send({ type: 'join', room, name });
    els.room.disabled = true; els.name.disabled = true; els.joinBtn.disabled = true;
  });

  els.startBtn.addEventListener('click', () => {
    const cnt = (lastState?.players || []).filter(p => p && !p.empty).length;
    if (cnt < 2) { showToast('Servono almeno 2 giocatori'); return; }
    send({ type: 'start' });
  });

  els.actions.check.addEventListener('click', () => send({ type: 'action', action: 'Check' }));
  // Bet button toggles the bet amount control; confirm sends action with amount
  els.actions.bet.addEventListener('click', () => {
    if (els.actions.betControl) {
      const show = els.actions.betControl.classList.toggle('hidden');
      // when made visible, focus input
      if (!show) { els.actions.betAmount?.focus(); }
    } else {
      send({ type: 'action', action: 'Bet' });
    }
  });
  if (els.actions.betConfirm) {
    els.actions.betConfirm.addEventListener('click', () => {
      const v = Number(els.actions.betAmount?.value || 0) || 0;
      if (v <= 0) { showToast('Inserisci un importo valido'); return; }
      send({ type: 'action', action: 'Bet', amount: v });
      if (els.actions.betControl) els.actions.betControl.classList.add('hidden');
    });
  }
  els.actions.call.addEventListener('click', () => send({ type: 'action', action: 'Call' }));
  els.actions.fold.addEventListener('click', () => send({ type: 'action', action: 'Fold' }));

  els.actions.discard.addEventListener('click', () => {
    if (!lastState) return;
    const max = lastState.config?.MAX_DISCARD || 3;
    const idxs = Array.from(selected).sort((a, b) => a - b).slice(0, max);
    send({ type: 'action', action: 'Discard', indices: idxs });
    selected.clear(); updateDiscardHint(max);
  });

  window.addEventListener('keydown', (e) => {
    if (!lastState) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'c') {
      if (!els.actions.check.disabled) els.actions.check.click();
      else if (!els.actions.call.disabled) els.actions.call.click();
    }
    if (k === 'b' && !els.actions.bet.disabled) els.actions.bet.click();
    if (k === 'f' && !els.actions.fold.disabled) els.actions.fold.click();
    if (k === 'd' && !els.actions.discard.disabled) els.actions.discard.click();
  });

  window.addEventListener('resize', () => {
    if (lastState && typeof lastState.dealerSeat === 'number') posDealerBtnForSeat(lastState.dealerSeat);
  });

  els.overlayBtn.addEventListener('click', () => {
    hideOverlay();
    if ((lastState?.players || []).filter(p => p && !p.empty).length >= 2) send({ type: 'start' });
  });
}

// init
window.addEventListener('load', () => { connect(); setupEvents(); });
window.addEventListener('beforeunload', () => { try { if (ws) ws.close(); } catch {} });
