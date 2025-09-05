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
      clearAllToasts();
      const prevMsg = lastState?.message || '';
      render(msg.state);

      if (msg.state.won || msg.state.showOverlay) {
        showOverlay(msg.state.overlayText || 'Fine mano');
      } else {
        hideOverlay();
      }

      const newMsg = msg.state.message || '';
      if (newMsg && newMsg !== prevMsg && !MSG_BLACKLIST.has(newMsg)) showToast(newMsg);

      if (msg.summary && Array.isArray(msg.summary.winners) && msg.summary.winners.length) {
        try {
          const winners = msg.summary.winners.map(seat => {
            const p = msg.state.players && msg.state.players[seat];
            const hand = p && p.hand ? p.hand : (p && Array.isArray(p.cards) && p.cards.length===5 ? scoreName(eval5(p.cards)) : '');
            return `${p ? p.name : 'Seat '+seat}${hand ? ' ('+hand+')' : ''}`;
          });
          const overlayText = msg.summary.message || `Vincitori: ${winners.join(', ')}`;
          showOverlay(overlayText);
          try { animateVictory(msg.state, msg.summary); } catch (e) { /* ignore animation errors */ }
        } catch (e) { /* ignore errors */ }
      }
    }
  });

  ws.addEventListener('error', (err) => {
    console.warn('WebSocket error', err);
  });
}

function animateVictory(state, summary) {
  if (!state || !summary || !Array.isArray(summary.winners)) return;
  summary.winners.forEach(seat => {
    const seatEl = els.seats.querySelector(`.seat[data-idx="${seat}"]`);
    if (!seatEl) return;
    const cards = [...seatEl.querySelectorAll('.card')];
    cards.forEach((c, i) => {
      if (c.classList.contains('winning')) {
        c.classList.add('animate-win');
        setTimeout(() => c.classList.remove('animate-win'), 1500);
      }
    });
  });

  const potEl = els.pot || null;
  const tableRect = els.table?.getBoundingClientRect();
  const potCenter = { x: (tableRect.left + tableRect.right) / 2, y: (tableRect.top + tableRect.bottom) / 2 };
  summary.winners.forEach((seat, idx) => {
    const seatEl = els.seats.querySelector(`.seat[data-idx="${seat}"]`);
    if (!seatEl) return;
    const sRect = seatEl.getBoundingClientRect();
    const target = { x: sRect.left + sRect.width / 2, y: sRect.top + sRect.height / 2 };
    for (let i = 0; i < 5; i++) {
      const chip = document.createElement('div');
      chip.className = 'chip fly';
      chip.textContent = '';
      document.body.appendChild(chip);
      const startX = potCenter.x - 15;
      const startY = potCenter.y - 15;
      chip.style.left = `${startX}px`;
      chip.style.top = `${startY}px`;
      chip.style.opacity = '1';
      void chip.offsetWidth;
      const dx = target.x - potCenter.x;
      const dy = target.y - potCenter.y;
      chip.style.transform = `translate(${dx}px, ${dy}px) scale(0.8)`;
      chip.style.transitionDelay = `${0.05 * i + idx * 0.06}s`;
      setTimeout(() => {
        chip.style.opacity = '0';
        setTimeout(() => { try { chip.remove(); } catch (e) {} }, 800);
      }, 1100 + idx * 120 + i * 60);
    }
  });
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('Non connesso al server');
    return;
  }
  try { ws.send(JSON.stringify(obj)); } catch (err) { console.warn('Send failed', err); }
}

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

function renderCard(c) {
  const div = document.createElement('div');
  div.className = 'card';
  if (!c || !c.r) { div.classList.add('back'); div.textContent = '🂠'; return div; }
  if (c.s === '♦' || c.s === '♥') div.className += ' red';
  div.textContent = `${c.r}${c.s}`;
  return div;
}

function eval5(cards) {
  const counts = {}, suits = {}, vals = [];
  for (const c of cards) {
    counts[c.v] = (counts[c.v] || 0) + 1;
    suits[c.s] = (suits[c.s] || 0) + 1;
    vals.push(c.v || 0);
  }
  vals.sort((a, b) => b - a);
  const uniq = [...new Set(vals)].sort((a, b) => b - a);
  let straightHigh = 0;
  if ([14,5,4,3,2].every(v => uniq.includes(v))) straightHigh = 5;
  for (let i = 0; i <= uniq.length - 5; i++) {
    if (uniq[i] === uniq[i+1] + 1 && uniq[i+1] === uniq[i+2] + 1 && uniq[i+2] === uniq[i+3] + 1 && uniq[i+3] === uniq[i+4] + 1) {
      straightHigh = Math.max(straightHigh, uniq[i]);
    }
  }
  const isFlush = Object.values(suits).some(v => v === 5);
  const byCount = Object.entries(counts).map(([v, c]) => ({ v: +v, c })).sort((a,b)=> b.c - a.c || b.v - a.v);
  if (isFlush && straightHigh) return [8, straightHigh];
  if (byCount[0] && byCount[0].c === 4) return [7, byCount[0].v, (byCount[1]||{}).v];
  if (byCount[0] && byCount[0].c === 3 && byCount[1] && byCount[1].c === 2) return [6, byCount[0].v, byCount[1].v];
  if (isFlush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (byCount[0] && byCount[0].c === 3) {
    const kick = byCount.filter(x => x.c === 1).map(x => x.v).sort((a,b)=>b-a);
    return [3, byCount[0].v, ...kick];
  }
  if (byCount[0] && byCount[1] && byCount[0].c === 2 && byCount[1].c === 2) {
    const hp = Math.max(byCount[0].v, byCount[1].v);
    const lp = Math.min(byCount[0].v, byCount[1].v);
    const k = byCount.find(x => x.c === 1).v;
    return [2, hp, lp, k];
  }
  if (byCount[0] && byCount[0].c === 2) {
    const kick = byCount.filter(x => x.c === 1).map(x => x.v).sort((a,b)=>b-a);
    return [1, byCount[0].v, ...kick];
  }
  return [0, ...vals];
}
function scoreName(s){ return ['Carta alta','Coppia','Doppia coppia','Tris','Scala','Colore','Full','Poker','Scala colore'][s[0]]; }

function valueToChips(v) {
  const denoms = [100, 25, 5, 1];
  const colors = { 100: 'black', 25: 'green', 5: 'red', 1: '' };
  const out = [];
  let rem = Math.max(0, Math.floor(Number(v) || 0));
  for (const d of denoms) {
    let n = Math.floor(rem / d);
    if (n > 8) n = 8;
    for (let i = 0; i < n; i++) out.push({ d, color: colors[d] });
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
    container.appendChild(c);
  });
}

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
  if (els.actions.discard) {
    const canDiscard = lastState?.actions?.includes('Discard');
    els.actions.discard.disabled = !canDiscard || n === 0;
  }
}

function computeWinningIndices(cards, score) {
  if (!cards || !score) return [];
  const kind = score[0];
  const vals = cards.map(c => c.v);
  const suits = cards.map(c => c.s);
  const byVal = {};
  vals.forEach((v, i) => { (byVal[v] = byVal[v] || []).push(i); });
  const indices = new Set();

  const addVals = (arr) => { arr.forEach(v => { const idxs = byVal[v] || []; idxs.forEach(i => indices.add(i)); }); };

  if (kind === 5) {
    const suitCounts = {};
    suits.forEach((s, i) => { (suitCounts[s] = suitCounts[s] || []).push(i); });
    for (const s in suitCounts) if (suitCounts[s].length >= 5) { suitCounts[s].forEach(i => indices.add(i)); }
    return Array.from(indices).sort((a,b)=>a-b);
  }

  if (kind === 4 || kind === 8) {
    let high = score[1];
    const seq = [];
    if (high === 5) {
      seq.push(5,4,3,2,14);
    } else {
      for (let v = high; v > high - 5; v--) seq.push(v);
    }
    if (kind === 8) {
      const targetSuits = {};
      suits.forEach((s, i) => { targetSuits[s] = targetSuits[s] || []; targetSuits[s].push({v: vals[i], i}); });
      for (const s in targetSuits) {
        const presentVals = new Set(targetSuits[s].map(x=>x.v));
        const ok = seq.every(v => presentVals.has(v));
        if (ok) {
          seq.forEach(v => {
            targetSuits[s].filter(x=>x.v===v).forEach(x=>indices.add(x.i));
          });
          break;
        }
      }
    } else {
      addVals(seq);
    }
    return Array.from(indices).sort((a,b)=>a-b);
  }

  const counts = Object.entries(byVal).map(([v, idxs]) => ({v: Number(v), count: idxs.length, idxs})).sort((a,b)=> b.count - a.count || b.v - a.v);
  if (kind === 7) {
    const quad = counts.find(c=>c.count===4);
    if (quad) quad.idxs.forEach(i => indices.add(i));
    const kicker = counts.find(c=>c.count===1);
    if (kicker) kicker.idxs.forEach(i => indices.add(i));
    return Array.from(indices).sort((a,b)=>a-b);
  }
  if (kind === 3) {
    const t = counts.find(c=>c.count===3);
    if (t) t.idxs.forEach(i => indices.add(i));
    const kickers = counts.filter(c=>c.count===1).slice(0,2);
    kickers.forEach(k=>k.idxs.forEach(i=>indices.add(i)));
    return Array.from(indices).sort((a,b)=>a-b);
  }
  if (kind === 6) {
    const three = counts.find(c=>c.count===3);
    const pair = counts.find(c=>c.count===2);
    if (three) three.idxs.forEach(i=>indices.add(i));
    if (pair) pair.idxs.forEach(i=>indices.add(i));
    return Array.from(indices).sort((a,b)=>a-b);
  }
  if (kind === 2) {
    const pairs = counts.filter(c=>c.count===2).slice(0,2);
    pairs.forEach(p=>p.idxs.forEach(i=>indices.add(i)));
    const kicker = counts.find(c=>c.count===1);
    if (kicker) kicker.idxs.forEach(i=>indices.add(i));
    return Array.from(indices).sort((a,b)=>a-b);
  }
  if (kind === 1) {
    const pair = counts.find(c=>c.count===2);
    if (pair) pair.idxs.forEach(i=>indices.add(i));
    const kickers = counts.filter(c=>c.count===1).slice(0,3);
    kickers.forEach(k=>k.idxs.forEach(i=>indices.add(i)));
    return Array.from(indices).sort((a,b)=>a-b);
  }

  const sorted = vals.map((v,i)=>({v,i})).sort((a,b)=> b.v - a.v);
  indices.add(sorted[0].i);
  return Array.from(indices).sort((a,b)=>a-b);
}

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
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.dataset.idx = s;

    let winningIndices = [];
    if (state.stage === 'showdown' && pd && pd._score && Array.isArray(pd.cards)) {
      try {
        winningIndices = computeWinningIndices(pd.cards, pd._score);
      } catch (e) { winningIndices = []; }
    }

    if (state.toActSeat === s && /(bet1|bet2)/.test(state.stage || '')) seat.classList.add('turn');

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = pd?.name || 'Posto libero';
    seat.appendChild(name);

    if (pd && pd.hand) {
      const handName = document.createElement('div');
      handName.className = 'hand-name';
      handName.textContent = pd.hand;
      seat.appendChild(handName);
    }

    const cards = document.createElement('div');
    cards.className = 'cards';
    if (pd && !pd.empty && Array.isArray(pd.cards)) {
      cards.classList.toggle('selectable', s === mySeat && state.stage === 'draw' && !pd.drew);
      pd.cards.forEach((c, i) => {
        const cardEl = renderCard(c);
        if (s === mySeat && state.stage === 'draw' && !pd.drew) {
          cardEl.addEventListener('click', () => {
            toggleSelect(i, state.config?.MAX_DISCARD || 3);
            updateDiscardHint(state.config?.MAX_DISCARD || 3);
          });
          cardEl.tabIndex = 0;
          cardEl.setAttribute('role', 'button');
        }
        if (winningIndices.includes(i)) cardEl.classList.add('winning');
        cards.appendChild(cardEl);
      });
    } else {
      for (let i = 0; i < 5; i++) cards.appendChild(renderCard({}));
    }
    seat.appendChild(cards);

    const stack = document.createElement('div');
    stack.className = 'stack';
    stack.textContent = (pd && !pd.empty) ? `Stack: ${pd.stack || 0}` : '';
    seat.appendChild(stack);

    els.seats.appendChild(seat);
  }

  if (typeof state.dealerSeat === 'number') posDealerBtnForSeat(state.dealerSeat);

  els.msg.textContent = state.message || '';

  updateActions(state);

  const me = (state.players && typeof mySeat === 'number') ? state.players[mySeat] : null;
  if (state.stage !== 'draw' || me?.drew) {
    selected.clear();
    updateDiscardHint(state.config?.MAX_DISCARD || 3);
    const meCards = els.seats.querySelector(`.seat[data-idx="${mySeat}"] .cards`);
    if (meCards) [...meCards.querySelectorAll('.card')].forEach(el => el.classList.remove('selected'));
  }

  els.startBtn.disabled = !(['lobby', 'showdown'].includes(state.stage));
}

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

function setupEvents() {
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
  els.actions.bet.addEventListener('click', () => {
    if (els.actions.betControl) {
      const wasHidden = els.actions.betControl.classList.toggle('hidden');
      const visible = !wasHidden;
      els.actions.betControl.setAttribute('aria-hidden', String(!visible));
      if (visible && els.actions.betAmount) {
        try { els.actions.betAmount.focus(); els.actions.betAmount.select(); } catch (e) {}
      }
    } else {
      send({ type: 'action', action: 'Bet' });
    }
  });
  if (els.actions.betConfirm) {
    els.actions.betConfirm.addEventListener('click', () => { if (els.actions.betAmount) send({ type: 'action', action: 'Bet', amount: Number(els.actions.betAmount.value || 0) }); });
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
    if (!els.overlay) return;
    const isVisible = !els.overlay.classList.contains('hidden');
    if (!isVisible) return;
    if (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape') {
      e.preventDefault();
      if (els.overlayBtn) els.overlayBtn.click();
    }
  });

  window.addEventListener('resize', () => {
    if (lastState && typeof lastState.dealerSeat === 'number') posDealerBtnForSeat(lastState.dealerSeat);
  });

  els.overlayBtn.addEventListener('click', () => {
    hideOverlay();
    if ((lastState?.players || []).filter(p => p && !p.empty).length >= 2) send({ type: 'start' });
  });
}

window.addEventListener('load', () => { connect(); setupEvents(); });
window.addEventListener('beforeunload', () => { try { if (ws) ws.close(); } catch {} });
