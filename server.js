// server.js - 5 Card Draw multiplayer fino a 6 giocatori
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  console.log(`HTTP ${req.method} ${req.url}`);
  // Normalize requested path and avoid leading slashes that would make path.join ignore PUBLIC_DIR
  let rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, ''));
  const filePath = path.join(PUBLIC_DIR, rel);
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error('Failed to read', filePath, err && err.code);
      res.writeHead(404);
      res.end('Not found');
    }
    else {
      console.log('Serving', filePath, 'bytes=', data.length);
      res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
      res.end(data);
    }
  });
});

const wss = new WebSocket.Server({ server });

// Carte e valutazione
// include '10' so the deck has the full 13 ranks (2..10,J,Q,K,A)
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['♣', '♦', '♥', '♠'];
const RVAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

function makeDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push({ r, v: RVAL[r], s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// eval di esattamente 5 carte, ritorna punteggio confrontabile
function eval5(cards) {
  const counts = {}, suits = {}, vals = [];
  for (const c of cards) {
    counts[c.v] = (counts[c.v] || 0) + 1;
    suits[c.s] = (suits[c.s] || 0) + 1;
    vals.push(c.v);
  }
  vals.sort((a, b) => b - a);
  const uniq = [...new Set(vals)].sort((a, b) => b - a);
  let straightHigh = 0;
  if ([14,5,4,3,2].every(v => uniq.includes(v))) straightHigh = 5; // wheel
  for (let i = 0; i <= uniq.length - 5; i++) {
    if (uniq[i] === uniq[i+1] + 1 && uniq[i+1] === uniq[i+2] + 1 && uniq[i+2] === uniq[i+3] + 1 && uniq[i+3] === uniq[i+4] + 1) {
      straightHigh = Math.max(straightHigh, uniq[i]);
    }
  }
  const isFlush = Object.values(suits).some(v => v === 5);
  const byCount = Object.entries(counts).map(([v, c]) => ({ v: +v, c })).sort((a,b)=> b.c - a.c || b.v - a.v);
  if (isFlush && straightHigh) return [8, straightHigh];
  if (byCount[0].c === 4) return [7, byCount[0].v, byCount[1].v];
  if (byCount[0].c === 3 && byCount[1].c === 2) return [6, byCount[0].v, byCount[1].v];
  if (isFlush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (byCount[0].c === 3) {
    const kick = byCount.filter(x => x.c === 1).map(x => x.v).sort((a,b)=>b-a);
    return [3, byCount[0].v, ...kick];
  }
  if (byCount[0].c === 2 && byCount[1].c === 2) {
    const hp = Math.max(byCount[0].v, byCount[1].v);
    const lp = Math.min(byCount[0].v, byCount[1].v);
    const k = byCount.find(x => x.c === 1).v;
    return [2, hp, lp, k];
  }
  if (byCount[0].c === 2) {
    const kick = byCount.filter(x => x.c === 1).map(x => x.v).sort((a,b)=>b-a);
    return [1, byCount[0].v, ...kick];
  }
  return [0, ...vals];
}
function cmpScore(a, b){ for(let i=0;i<Math.max(a.length,b.length);i++){ const d=(a[i]||0)-(b[i]||0); if(d!==0) return d; } return 0; }
function scoreName(s){ return ['Carta alta','Coppia','Doppia coppia','Tris','Scala','Colore','Full','Poker','Scala colore'][s[0]]; }

// Room state
const rooms = new Map();
function makeRoom(code){
  return {
    code,
    players: [], // {id, ws, name, seat, stack, cards:[], bet, folded, drew}
    deck: [],
    stage: 'lobby', // lobby, bet1, draw, bet2, showdown
    pot: 0,
    currentBet: 0,
    dealerSeat: 0,
    toActSeat: 0,
    checks: 0,
    waitingCalls: 0,
    message: '',
    winners: [], // seat indices at showdown
    config: { MAX_SEATS: 6, ANTE: 10, BET: 20, MAX_DISCARD: 3 }
  };
}

function send(ws, payload){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
function findPlayerBySeat(room, seat){ return room.players.find(p => p.seat === seat); }
function occupiedSeats(room){ return room.players.map(p => p.seat).sort((a,b)=>a-b); }
function nextOccupiedSeat(room, fromSeat){
  const occ = occupiedSeats(room);
  if (occ.length === 0) return 0;
  const after = occ.filter(s => s > fromSeat);
  return (after[0] !== undefined ? after[0] : occ[0]);
}
function activePlayers(room){ return room.players.filter(p => !p.folded); }

function availableActions(room, me){
  // determina le azioni disponibili per il giocatore `me` nello stato `room`
  if (!room || !me) return [];
  if (room.stage === 'lobby') return [];
  if (me.folded) return [];
  // durante lo scarto il giocatore può solo scartare (se non l'ha già fatto)
  if (room.stage === 'draw') return me.drew ? [] : ['Discard'];
  // serve almeno 2 giocatori non-empty (bot o umano)
  const occCount = (room.players || []).filter(p => p && !p.empty).length;
  if (occCount < 2) return [];
  // solo il giocatore a turno può agire
  if (room.toActSeat !== me.seat) return [];
  // quando non c'è puntata corrente -> può checkare o puntare
  if (!room.currentBet || room.currentBet === 0) return ['Check','Bet'];
  // se ha una puntata da coprire -> deve chiamare o foldare
  if ((me.bet || 0) < (room.currentBet || 0)) return ['Call','Fold'];
  // ha già pareggiato la puntata corrente: può controllare o rilanciare
  return ['Check','Bet','Fold'];
}

function buildStateFor(room, me){
  const players = [];
  for (let s = 0; s < room.config.MAX_SEATS; s++){
    const p = findPlayerBySeat(room, s);
    if (!p) {
      players.push({ seat:s, empty:true });
      continue;
    }
    const showCards = (room.stage === 'showdown' && !p.folded) || p === me;
    const playerObj = {
      seat: p.seat,
      name: p.name,
      stack: p.stack,
      bet: p.bet,
      folded: p.folded,
      drew: p.drew,
      cards: showCards ? p.cards : [{},{},{},{},{}],
      isBot: !!p.isBot
    };
    // if cards are visible (player or showdown), include evaluated score and human-friendly name
    if (showCards && Array.isArray(p.cards) && p.cards.length === 5) {
      try {
        const sc = eval5(p.cards);
        playerObj._score = sc;
        playerObj.hand = scoreName(sc);
      } catch (e) {}
    }
    players.push(playerObj);
  }
  return {
    room: room.code,
    stage: room.stage,
    dealerSeat: room.dealerSeat,
    toActSeat: room.toActSeat,
    pot: room.pot,
    currentBet: room.currentBet,
    players,
    youSeat: me.seat,
    actions: availableActions(room, me),
    message: room.message,
    winners: room.winners,
    config: room.config
  };
}

// Broadcast solo ai client umani; poi eventualmente triggera i bot
function broadcast(room){
  for(const p of room.players) {
    if (p.ws) {
      const st = buildStateFor(room, p);
      // debug: log what actions we are sending to each human player
      try {
        console.log(`[broadcast] room=${room.code} stage=${room.stage} toAct=${room.toActSeat} currentBet=${room.currentBet} -> ${p.name}@seat${p.seat} actions=${JSON.stringify(st.actions)}`);
      } catch (e) { /* ignore logging errors */ }
      // include a small summary for clients when in showdown
      const payload = { type:'state', state: st };
      if (room.stage === 'showdown' && room.winners && room.winners.length) {
        payload.summary = { winners: room.winners.slice(), message: room.message };
      }
      send(p.ws, payload);
    }
  }
  // se il giocatore a turno è un bot, schedula la sua azione
  maybeTriggerBots(room);
}

// Schedulazione e azione bot
function maybeTriggerBots(room){
  // In betting stages, only the player to act may be a bot -> schedule that one
  if (room.stage === 'bet1' || room.stage === 'bet2') {
    const seat = room.toActSeat;
    const p = findPlayerBySeat(room, seat);
    if (!p || !p.isBot) return;
    if (p._botTimer) return;
    const delay = 600 + Math.floor(Math.random() * 900);
    p._botTimer = setTimeout(() => {
      p._botTimer = null;
      try { performBotAction(room, p); } catch (e) { console.error('Bot action failed', e); }
    }, delay);
    return;
  }

  // In draw stage, multiple players (including multiple bots) may need to discard.
  // Schedule all bots that haven't drawn yet (and are not folded). Stagger delays so actions look natural.
  if (room.stage === 'draw') {
    const bots = room.players.filter(p => p && p.isBot && !p.folded && !p.drew);
    if (!bots || bots.length === 0) return;
    let base = 400;
    bots.forEach((bot, idx) => {
      if (bot._botTimer) return; // don't double-schedule
      const delay = base + idx * 600 + Math.floor(Math.random() * 600);
      bot._botTimer = setTimeout(() => {
        bot._botTimer = null;
        try { performBotAction(room, bot); } catch (e) { console.error('Bot draw action failed', e); }
        // after each bot action, broadcast to update humans and potentially schedule remaining bots
        broadcast(room);
      }, delay);
    });
    return;
  }
}

function performBotAction(room, bot){
  if (!bot || !bot.isBot) return;
  // se non è più al tavolo o ha foldato, ignora
  if (bot.folded) return;
  // AZIONE IN BASE ALLO STAGE
  if (room.stage === 'draw'){
    // Semplice heuristica: scarta carte singole (non in coppia/tris) dalle più basse
    const counts = {};
    bot.cards.forEach(c => { counts[c.v] = (counts[c.v]||0) + 1; });
    const idxs = [];
    // crea array di indices ordinati per valore crescente
    const ordered = bot.cards.map((c,i) => ({i, v: c.v||0})).sort((a,b)=>a.v-b.v);
    for (const it of ordered) {
      if (idxs.length >= room.config.MAX_DISCARD) break;
      if (!it.v) continue;
      if ((counts[it.v]||0) === 1) idxs.push(it.i);
    }
    // se non trovi nulla da scartare, talvolta scarta la carta singola più bassa
    if (idxs.length === 0 && ordered.length) idxs.push(ordered[0].i);
    handleDiscard(room, bot, idxs);
    broadcast(room);
    return;
  }

  if (room.stage === 'bet1' || room.stage === 'bet2'){
    const BET = room.config.BET;
    // se non è il suo turno ancora, ignore
    if (room.toActSeat !== bot.seat) return;
    if (room.currentBet === 0){
      // se stack basso -> check
      if (bot.stack <= 0) {
        handleBet(room, bot, 'Check');
      } else {
        // decide di puntare con probabilità basata su mano base (semplice): puntare se ha coppia/tris
        const vals = bot.cards.map(c=>c.v||0);
        const uniq = Array.from(new Set(vals));
        const hasPair = vals.some(v => vals.filter(x=>x===v).length >= 2);
        const rnd = Math.random();
        if (hasPair || rnd < 0.25) {
          handleBet(room, bot, 'Bet');
        } else {
          handleBet(room, bot, 'Check');
        }
      }
      broadcast(room);
      return;
    } else {
      // c'è una puntata corrente
      if (bot.bet < room.currentBet){
        const toPay = room.currentBet - bot.bet;
        if (bot.stack >= toPay) {
          handleBet(room, bot, 'Call');
        } else {
          handleBet(room, bot, 'Fold');
        }
        broadcast(room);
        return;
      } else {
        // ha già pareggiato, fa check
        handleBet(room, bot, 'Check');
        broadcast(room);
        return;
      }
    }
  }
}

// --- Mancano funzioni di gioco: startHand, streets e azioni ---
function resetStreet(room){
  for (const p of room.players) p.bet = 0;
  room.currentBet = 0;
  room.checks = 0;
  room.waitingCalls = 0;
}

function postAntes(room){
  for (const p of room.players) {
    const a = Math.min(room.config.ANTE, p.stack || 0);
    p.stack = (p.stack || 0) - a;
  room.pot = (room.pot || 0) + a;
  p.contributed = (p.contributed || 0) + a;
  if ((p.stack || 0) === 0) p.allIn = true;
  }
}

function startHand(room){
  room.deck = makeDeck();
  room.stage = 'bet1';
  room.pot = room.pot || 0; room.message = ''; room.winners = [];
  for (const p of room.players) {
    p.cards = [room.deck.pop(), room.deck.pop(), room.deck.pop(), room.deck.pop(), room.deck.pop()];
  p.folded = false; p.bet = 0; p.drew = false; p.allIn = false; p.contributed = 0;
  }
  postAntes(room);
  resetStreet(room);
  room.toActSeat = nextOccupiedSeat(room, room.dealerSeat);
  room.message = `Nuova mano (ante ${room.config.ANTE}). Parla ${findPlayerBySeat(room, room.toActSeat)?.name || ''}.`;
}

function advanceStage(room){
  if (room.stage === 'bet1') {
    room.stage = 'draw';
    room.message = 'Fase di scarto: seleziona fino a 3 carte e premi Scarta.';
    // imposto il primo giocatore che deve scartare (primo dopo il dealer che non ha ancora scartato)
    const first = nextUndrawnSeat(room, room.dealerSeat);
    room.toActSeat = (first !== null) ? first : nextOccupiedSeat(room, room.dealerSeat);
  } else if (room.stage === 'bet2') {
    room.stage = 'showdown';
    showdown(room);
  }
}

function endStreetByChecksIfNeeded(room, playerChecked){
  if (!playerChecked) { room.checks = 0; return false; }
  room.checks++;
  const stillIn = activePlayers(room).length;
  if (room.checks >= stillIn) {
    resetStreet(room);
    advanceStage(room);
    return true;
  }
  return false;
}

function nextActionSeat(room){
  // trova il prossimo giocatore attivo
  let s = room.toActSeat;
  for (let i=0;i<room.config.MAX_SEATS;i++){
    s = nextOccupiedSeat(room, s);
    const p = findPlayerBySeat(room, s);
    if (p && !p.folded) { room.toActSeat = s; return; }
  }
  // fallback
  room.toActSeat = nextOccupiedSeat(room, room.dealerSeat);
}

// nuovo helper: trova il prossimo giocatore che non ha ancora scartato
function nextUndrawnSeat(room, fromSeat){
  if (!room || !room.players) return null;
  let s = fromSeat;
  for (let i=0;i<room.config.MAX_SEATS;i++){
    s = nextOccupiedSeat(room, s);
    const p = findPlayerBySeat(room, s);
    if (p && !p.folded && !p.drew) return s;
  }
  return null;
}

function everyoneMatchedOrFolded(room){
  if (room.currentBet === 0) return false;
  const target = room.currentBet;
  for (const p of room.players) {
    if (p.folded) continue;
    if ((p.bet||0) !== target) return false;
  }
  return true;
}

function tryAdvanceFromDraw(room){
  const allDone = room.players.every(p => p.folded || p.drew);
  if (allDone){
    resetStreet(room);
    room.stage = 'bet2';
    room.toActSeat = nextOccupiedSeat(room, room.dealerSeat);
    room.message = `Secondo giro di puntate. Parla ${findPlayerBySeat(room, room.toActSeat)?.name || ''}.`;
  }
}

function showdown(room){
  const contenders = room.players.filter(p => !p.folded);
  const total = (room.pot||0) + room.players.reduce((sum,p)=> sum + (p.bet||0), 0);
  for (const p of room.players) p.bet = 0;
  room.pot = 0;
  room.winners = [];

  if (contenders.length === 0) { room.message = 'Tutti hanno foldato.'; return; }
  if (contenders.length === 1) {
    contenders[0].stack += total;
    room.winners = [contenders[0].seat];
    room.message = `Vince ${contenders[0].name} (tutti gli altri fold).`;
    return;
  }
  // valuta tutti
  let best = null;
  for (const p of contenders) {
    p._score = eval5(p.cards);
    if (!best || cmpScore(p._score, best) > 0) best = p._score;
  }
  const winners = contenders.filter(p => cmpScore(p._score, best) === 0).map(p => p.seat);
  room.winners = winners.slice();

  // Side-pot aware distribution
  // Build array of active contenders with their contributed amounts
  const active = room.players.filter(p => !p.folded && (p.contributed || 0) > 0).map(p => ({ seat: p.seat, name: p.name, contributed: p.contributed || 0, score: p._score }));
  // sort contributors ascending by contributed amount
  active.sort((a,b)=> a.contributed - b.contributed);
  let remaining = (room.pot||0) + room.players.reduce((sum,p)=> sum + (p.bet||0), 0);
  const payouts = {}; // seat->amount
  while (active.length > 0 && remaining > 0) {
    const smallest = active[0].contributed;
    // build current side pot: sum min(contributed, smallest) for all remaining players
    let sideTotal = 0;
    for (const p of active) {
      sideTotal += Math.min(p.contributed, smallest);
      p.contributed = p.contributed - Math.min(p.contributed, smallest);
    }
    // determine winners among active for this side pot
    let best = null; for (const p of active) { if (!best || cmpScore(p.score, best) > 0) best = p.score; }
    const sideWinners = active.filter(p => cmpScore(p.score, best) === 0).map(p => p.seat);
    const share = Math.floor(sideTotal / sideWinners.length);
    let remSide = sideTotal - share * sideWinners.length;
    for (const seat of sideWinners) { payouts[seat] = (payouts[seat]||0) + share; }
    // distribute remainder starting from left of dealer
    let s = nextOccupiedSeat(room, room.dealerSeat);
    while (remSide > 0) {
      if (sideWinners.includes(s)) { payouts[s] = (payouts[s]||0) + 1; remSide--; }
      s = nextOccupiedSeat(room, s);
    }
    // remove players with zero contributed left
    active = active.filter(p => p.contributed > 0);
    remaining -= sideTotal;
  }
  // apply payouts
  for (const seatStr of Object.keys(payouts)) {
    const seat = Number(seatStr);
    const player = findPlayerBySeat(room, seat);
    if (player) player.stack += payouts[seat];
  }

  const names = winners.map(seat => findPlayerBySeat(room, seat).name).join(', ');
  room.message = winners.length === 1
    ? `Showdown: vince ${names} (${scoreName(best)}).`
    : `Showdown: split pot tra ${names} (${scoreName(best)}).`;
}

function handleBet(room, me, action, amount){
  const BET = room.config.BET;
  if (room.toActSeat !== me.seat) return;
  if (room.currentBet === 0) {
    if (action === 'Check') {
      const ended = endStreetByChecksIfNeeded(room, true);
      if (!ended) {
        me._acted = true;
        nextActionSeat(room);
        room.message = `${me.name} fa check.`;
      }
    } else if (action === 'Bet') {
      // allow custom amount if provided, otherwise default to configured BET
      let pay = Number(amount || BET) || BET;
      pay = Math.max(BET, Math.floor(pay)); // at least the min bet
  pay = Math.min(pay, me.stack);
  me.stack -= pay; me.bet += pay; room.pot += pay;
  me.contributed = (me.contributed || 0) + pay;
  if ((me.stack || 0) === 0) me.allIn = true;
      room.currentBet = me.bet;
      room.checks = 0;
      me._acted = true;
      nextActionSeat(room);
      room.message = `${me.name} punta ${BET}.`;
    }
  } else {
    if (action === 'Call' && me.bet < room.currentBet) {
      const toPay = room.currentBet - me.bet;
  const pay = Math.min(toPay, me.stack);
  me.stack -= pay; me.bet += pay; room.pot += pay;
  me.contributed = (me.contributed || 0) + pay;
  if ((me.stack || 0) === 0) me.allIn = true;
      room.message = `${me.name} chiama.`;
      if (everyoneMatchedOrFolded(room)) {
        resetStreet(room);
        advanceStage(room);
      } else {
        nextActionSeat(room);
      }
    } else if (action === 'Fold') {
      me.folded = true;
      room.message = `${me.name} folda.`;
      const alive = activePlayers(room);
      if (alive.length <= 1) {
        room.stage = 'showdown';
        showdown(room);
      } else {
        nextActionSeat(room);
      }
    } else if (action === 'Bet') {
      // treat as raise: amount must be provided or default to min BET
      let raiseAmt = Number(amount || BET) || BET;
      raiseAmt = Math.max(BET, Math.floor(raiseAmt));
      const toPay = raiseAmt - (me.bet || 0);
      if (toPay <= 0) {
        // nothing to do
        return;
      }
      const pay = Math.min(toPay, me.stack);
      me.stack -= pay; me.bet += pay; room.pot += pay;
      me.contributed = (me.contributed || 0) + pay;
      if ((me.stack || 0) === 0) me.allIn = true;
      room.currentBet = Math.max(room.currentBet || 0, me.bet);
      // resetting checks because there was an action
      room.checks = 0;
      me._acted = true;
      // next player must respond to the raise
      nextActionSeat(room);
      room.message = `${me.name} rilancia a ${room.currentBet}.`;
    }
  }
}

function handleDiscard(room, me, indices){
  if (room.stage !== 'draw' || me.drew || me.folded) return;
  const MAX = room.config.MAX_DISCARD;
  const uniq = Array.from(new Set((indices||[]).map(i => i|0))).filter(i => i>=0 && i<5).slice(0, MAX);
  uniq.sort((a,b)=>a-b);
  for (const idx of uniq) me.cards[idx] = room.deck.pop();
  me.drew = true;
  room.message = `${me.name} scarta ${uniq.length}.`;
  // passa al prossimo giocatore che non ha ancora scartato
  const next = nextUndrawnSeat(room, me.seat);
  if (next !== null) {
    room.toActSeat = next;
  } else {
    // tutti hanno scartato -> procedi al secondo giro di puntate
    tryAdvanceFromDraw(room);
  }
}
// WebSocket
wss.on('connection', (ws) => {
  const id = Math.random().toString(36).slice(2);
  let room = null, me = null;

  send(ws, { type:'message', text:'Connesso. Inserisci stanza e nome.' });

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      const code = String(msg.room || '').toUpperCase().slice(0, 8) || 'TABLE';
      const name = String(msg.name || 'Giocatore').slice(0, 16);
      if (!rooms.has(code)) rooms.set(code, makeRoom(code));
      const r = rooms.get(code);
      if (r.players.length >= r.config.MAX_SEATS) { send(ws, { type:'message', text:'Stanza piena.' }); return; }
      // primo seat libero da 0..MAX-1
      let seat = 0; while (r.players.some(p => p.seat === seat)) seat++;
  me = { id, ws, name, seat, stack: 1000, cards: [], bet:0, folded:false, drew:false, allIn:false, contributed:0 };
      r.players.push(me);
      room = r;
      room.message = `${name} si siede al posto ${seat}.`;
      broadcast(room);
      return;
    }

    // gestione aggiunta bot
    if (msg.type === 'add-bot') {
      if (!room) { send(ws, { type:'message', text:'Devi prima entrare in una stanza.' }); return; }
      const r = room;
      if (r.players.length >= r.config.MAX_SEATS) { send(ws, { type:'message', text:'Tavolo pieno.' }); return; }
      // try requested seat if provided and free
      let seat = null;
      if (typeof msg.seat === 'number' && msg.seat >= 0 && msg.seat < r.config.MAX_SEATS) {
        const occupied = r.players.some(p => p.seat === msg.seat);
        if (!occupied) seat = msg.seat;
      }
      // fallback to first free seat
      if (seat === null) { seat = 0; while (r.players.some(p => p.seat === seat)) seat++; }
      const botName = `BOT_${Math.random().toString(36).slice(2,6).toUpperCase()}`;
      const bot = { id: 'bot_'+Math.random().toString(36).slice(2), ws: null, isBot: true, name: botName, seat, stack: 1000, cards: [], bet:0, folded:false, drew:false, allIn:false, contributed:0 };
      r.players.push(bot);
      r.message = `${botName} si siede al posto ${seat}.`;
      broadcast(r);
      return;
    }

    if (!room || !me) return;

    if (msg.type === 'start') {
      if (room.players.length < 2) { send(ws, { type:'message', text:'Servono almeno 2 giocatori.' }); return; }
      if (room.stage !== 'lobby' && room.stage !== 'showdown') { send(ws, { type:'message', text:'La mano è in corso.' }); return; }
      startHand(room);
      broadcast(room);
      return;
    }

    if (msg.type === 'action') {
      if (room.stage === 'bet1' || room.stage === 'bet2') {
        handleBet(room, me, msg.action, msg.amount);
        broadcast(room);
      } else if (room.stage === 'draw' && msg.action === 'Discard') {
        handleDiscard(room, me, msg.indices || []);
        broadcast(room);
      }
    }
  });

  ws.on('close', () => {
    if (room && me) {
      const wasToAct = (room.toActSeat === me.seat);
      room.players = room.players.filter(p => p !== me);
      room.message = `${me.name} ha lasciato la stanza.`;
      // se mano in corso e resta 0 o 1 attivo -> showdown
      if (room.stage !== 'lobby' && room.stage !== 'showdown') {
        if (activePlayers(room).length <= 1) { room.stage = 'showdown'; showdown(room); }
      }
      if (room.players.length === 0) rooms.delete(room.code);
      else broadcast(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
