'use strict';
// Pixel-Krieg – Server (Node.js + Express + Socket.io)
// Der Server ist die einzige Wahrheit: er prüft jeden Zug, steuert Golem, Ereignisse, Verräter und die Runde.

const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

// ---------- Konfiguration (per Umgebungsvariable überschreibbar) ----------
const DEMO = process.argv.includes('--demo');
const CFG = {
  PORT: +process.env.PORT || 3000,
  COLS: +process.env.COLS || 50,
  ROWS: +process.env.ROWS || 36,
  MAP: process.env.MAP || 'mallorca',     // 'mallorca' oder 'rechteck'
  ROUND: +process.env.ROUND || 90,        // Rundendauer in Sekunden
  COOLDOWN: +process.env.COOLDOWN || 2.5, // Sekunden zwischen zwei Zügen
  ADMIN_KEY: process.env.ADMIN_KEY || 'mallorca',
  PUBLIC_URL: process.env.PUBLIC_URL || '', // z. B. https://pixel.example.com/ (für den QR-Code)
};

// Startorte auf Mallorca (Längengrad, Breitengrad) – bzw. Ecken beim Rechteck
const TEAMS = [
  { name: 'Ansible-Armada',   color: '#e5484d', town: 'Andratx',    lon: 2.45, lat: 39.59, cx: 0, cy: 0 },
  { name: 'Sangria-Syndikat', color: '#f5a524', town: 'Alcúdia',    lon: 3.06, lat: 39.84, cx: 1, cy: 0 },
  { name: 'Paella-Paladine',  color: '#30a46c', town: 'Santanyí',   lon: 3.10, lat: 39.37, cx: 0, cy: 1 },
  { name: 'Firewall-Füchse',  color: '#b06cf5', town: 'Cala Millor', lon: 3.36, lat: 39.62, cx: 1, cy: 1 },
];
const GOLEM_HOME = { lon: 2.95, lat: 39.60 }; // Inselmitte (bei Sineu)
const GOLEM = 4;
const COLORS = [...TEAMS.map(t => t.color), '#2f7cf6'];
const ROLE_ORDER = ['Krieger', 'Baumeister', 'Schurke', 'Magier', 'Paladin'];
const ROLE_INFO = {
  Krieger:    'Erobert Feindfelder mit 1 Treffer (alle anderen brauchen 2).',
  Baumeister: 'Setzt auf neutralem Boden automatisch ein zweites Feld daneben.',
  Schurke:    'Halber Cooldown.',
  Magier:     'Alle 20 s ein Brückenkopf: neutrales Feld irgendwo auf der Insel.',
  Paladin:    'Eroberte Felder sind 10 s unangreifbar.',
};
const TITLES = [
  'Schrecken der Firewall', 'Hüter des Prod-Servers', 'Bezwinger der Merge-Konflikte',
  'Flüsterer der YAML-Einrückung', 'Fürst der Sangria', 'Wächter des Strandtuchs',
  'Bändiger des Golems', 'Herr(in) der Cronjobs', 'Plage der Pull-Requests', 'Retter(in) des Backups',
  'Graf/Gräfin von Localhost', 'Erste(r) am Buffet', 'Meister(in) des sudo', 'Fluch der Freitags-Deployments',
];
const MAGIC_CD = 20000, PALADIN_PROT = 10000, GOLEM_CD = 1200, COUNTDOWN_MS = 5000;
const EVENT_EVERY = 20000, EFFECT_MS = 6000, REVEAL_MS = 6500;

// ---------- Karte ----------
const W = CFG.COLS, H = CFG.ROWS, N = W * H;
const idx = (x, y) => y * W + x;
const pick = a => a[(Math.random() * a.length) | 0];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const neighbors = i => {
  const x = i % W, y = (i / W) | 0, r = [];
  if (x > 0) r.push(i - 1); if (x < W - 1) r.push(i + 1);
  if (y > 0) r.push(i - W); if (y < H - 1) r.push(i + W);
  return r;
};

// Grober Umriss von Mallorca (lon, lat), im Uhrzeigersinn ab Sant Elm
const MALLORCA = [[2.35,39.58],[2.40,39.63],[2.50,39.69],[2.60,39.74],[2.68,39.78],[2.80,39.84],[2.92,39.89],[3.02,39.92],[3.12,39.94],[3.21,39.96],[3.17,39.92],[3.08,39.89],[3.12,39.87],[3.20,39.88],[3.15,39.84],[3.12,39.80],[3.15,39.77],[3.22,39.75],[3.30,39.76],[3.37,39.77],[3.45,39.75],[3.48,39.71],[3.44,39.67],[3.39,39.60],[3.33,39.54],[3.27,39.43],[3.22,39.36],[3.12,39.30],[3.05,39.26],[2.99,39.31],[2.90,39.35],[2.79,39.37],[2.76,39.45],[2.74,39.51],[2.68,39.56],[2.62,39.55],[2.55,39.52],[2.52,39.46],[2.48,39.50],[2.44,39.53],[2.39,39.54]];
const PROJ = (() => {
  const lo0 = 2.30, lo1 = 3.52, la0 = 39.22, la1 = 39.99, kx = Math.cos(39.6 * Math.PI / 180);
  const gw = (lo1 - lo0) * kx, gh = la1 - la0, s = Math.min(W / gw, H / gh);
  const ox = (W - gw * s) / 2, oy = (H - gh * s) / 2;
  return {
    toGeo: (cx, cy) => [lo0 + ((cx - ox) / s) / kx, la1 - (cy - oy) / s],
    toCell: (lon, lat) => [Math.floor((lon - lo0) * kx * s + ox), Math.floor((la1 - lat) * s + oy)],
  };
})();
function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [x1, y1] = P[i], [x2, y2] = P[j];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) c = !c;
  }
  return c;
}
const land = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  land[idx(x, y)] = CFG.MAP === 'mallorca' ? (inPoly(...PROJ.toGeo(x + 0.5, y + 0.5), MALLORCA) ? 1 : 0) : 1;
}
const LAND_COUNT = land.reduce((a, b) => a + b, 0);
// Nächster 3×3-Block, der komplett an Land liegt
function baseSpot(cx, cy) {
  let best = null, bd = Infinity;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!land[idx(x + dx, y + dy)]) { ok = false; break; }
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (ok && d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}
const BASES = TEAMS.map(t => CFG.MAP === 'mallorca' ? baseSpot(...PROJ.toCell(t.lon, t.lat)) : [t.cx ? W - 2 : 1, t.cy ? H - 2 : 1]);
const GOLEM_BASE = CFG.MAP === 'mallorca' ? baseSpot(...PROJ.toCell(GOLEM_HOME.lon, GOLEM_HOME.lat)) : [Math.floor(W / 2), Math.floor(H / 2)];

// ---------- Spielzustand ----------
let owner, prev, hp, base, prot, credit, bonus, bonusCredit;
// Phasen: lobby -> countdown (5 s) -> play -> finale
let phase = 'lobby', startsAt = 0, endsAt = 0, golemAt = 0, finaleAt = 0, winner = null, finalScore = null, roundSecs = CFG.ROUND;
let opts = { traitors: true, events: true };
let fx = {}, nextEventAt = 0, eventDeck = [];
let changed = new Set();
const players = new Map(); // pid -> Spieler

function resetBoard() {
  owner = new Int8Array(N).fill(-1); prev = new Int8Array(N).fill(-1); credit = new Int8Array(N).fill(-1);
  hp = new Int8Array(N); base = new Int8Array(N).fill(-1); prot = new Float64Array(N);
  bonus = [0, 0, 0, 0, 0]; bonusCredit = [0, 0, 0, 0, 0]; winner = null; finalScore = null; fx = {}; changed = new Set();
  const putBase = ([x0, y0], t) => {
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { const i = idx(x0 + x, y0 + y); owner[i] = t; credit[i] = t; base[i] = t; hp[i] = 2; }
  };
  BASES.forEach((b, ti) => putBase(b, ti));
  putBase(GOLEM_BASE, GOLEM);
  for (const p of players.values()) p.traitorFor = null;
}

// Wer die Punkte für ein Feld bekommt: normalerweise das Team, beim Verräter heimlich das Zielteam
const creditOf = (p, t) => (p && p.traitorFor != null ? p.traitorFor : t);
function claim(i, t, p) {
  prev[i] = owner[i];
  if (owner[i] === GOLEM && t !== GOLEM) { bonus[t]++; bonusCredit[creditOf(p, t)]++; }
  owner[i] = t; credit[i] = creditOf(p, t); hp[i] = 2; changed.add(i);
}
function hit(i, t, dmg, p) {
  changed.add(i);
  if (owner[i] < 0) { claim(i, t, p); return true; }
  hp[i] -= dmg;
  if (hp[i] <= 0) { claim(i, t, p); return true; }
  return false;
}
function frontier(t, now) {
  const neu = [], en = [], seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (owner[i] !== t) continue;
    for (const j of neighbors(i)) {
      if (seen[j] || !land[j] || owner[j] === t || base[j] >= 0 || prot[j] > now) continue;
      seen[j] = 1; (owner[j] < 0 ? neu : en).push(j);
    }
  }
  return { neu, en };
}
function scores() { // sichtbarer Stand
  const cells = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) if (owner[i] >= 0) cells[owner[i]]++;
  return { cells, score: cells.map((c, t) => c + bonus[t]) };
}
function trueScores() { // echter Stand inkl. Verrat
  const cells = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) if (credit[i] >= 0) cells[credit[i]]++;
  return { cells, score: cells.map((c, t) => c + bonusCredit[t]) };
}

// ---------- Spieler ----------
function assignTeam(p) {
  const counts = [0, 0, 0, 0];
  for (const q of players.values()) if (q !== p) counts[q.team]++;
  const min = Math.min(...counts);
  p.team = pick([0, 1, 2, 3].filter(t => counts[t] === min));
  const taken = new Set([...players.values()].filter(q => q !== p && q.team === p.team).map(q => q.role));
  p.role = ROLE_ORDER.find(r => !taken.has(r)) || pick(['Krieger', 'Baumeister', 'Schurke']);
  p.title = `${p.role} ${p.name}, ${pick(TITLES)}`;
}
function newPlayer(name, bot = false) {
  const p = { pid: crypto.randomUUID(), name, bot, team: 0, role: '', title: '', nextAt: 0, magicAt: 0, moves: 0, captures: 0, traitorFor: null };
  assignTeam(p); players.set(p.pid, p); return p;
}
function assignTraitors() {
  for (let t = 0; t < 4; t++) {
    const members = [...players.values()].filter(p => p.team === t);
    if (members.length < 2) continue; // allein im Team ist Verrat witzlos
    pick(members).traitorFor = pick([0, 1, 2, 3].filter(x => x !== t));
  }
}

// ---------- Ereigniskarten ----------
const EVENTS = {
  siesta:   () => { fx.siestaUntil = Date.now() + EFFECT_MS; return { title: 'SIESTA!', text: 'Alle Cooldowns sind 6 Sekunden lang doppelt so lang.' }; },
  deploy:   () => {
    const cand = []; for (let i = 0; i < N; i++) if (land[i] && base[i] < 0) cand.push(i);
    const c = pick(cand), cx = c % W, cy = (c / W) | 0;
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || (x - cx) ** 2 + (y - cy) ** 2 > 10) continue;
      const i = idx(x, y); if (!land[i] || base[i] >= 0 || owner[i] < 0) continue;
      prev[i] = owner[i]; owner[i] = -1; credit[i] = -1; hp[i] = 0; changed.add(i);
    }
    return { title: 'FREITAGS-DEPLOYMENT', text: 'Jemand hat am Freitag deployed – ein Stück der Insel ist weg.' };
  },
  sangria:  () => {
    const s = scores().score.slice(0, 4), t = s.indexOf(Math.max(...s));
    fx.drunkTeam = t; fx.drunkUntil = Date.now() + EFFECT_MS;
    return { title: 'SANGRIA-RUNDE', text: `${TEAMS[t].name} führt und ist 6 Sekunden lang betrunken – Klicks landen daneben.`, team: t };
  },
  golem:    () => { fx.golemFastUntil = Date.now() + EFFECT_MS; return { title: 'DER GOLEM ERWACHT', text: '6 Sekunden lang malt der Golem dreimal so schnell.' }; },
  underdog: () => {
    const s = scores().score.slice(0, 4), t = s.indexOf(Math.min(...s));
    fx.boostTeam = t; fx.boostUntil = Date.now() + EFFECT_MS;
    return { title: 'RÜCKENWIND', text: `${TEAMS[t].name} liegt hinten: 6 Sekunden lang halber Cooldown.`, team: t };
  },
};
function fireEvent(id) {
  if (!id) { if (!eventDeck.length) eventDeck = shuffle(Object.keys(EVENTS)); id = eventDeck.pop(); }
  const e = EVENTS[id]();
  io.emit('event', { id, ...e, dur: 3500 });
  console.log(`Ereignis: ${e.title}`);
}
function cooldownFor(p, now) {
  let cd = (p.role === 'Schurke' ? CFG.COOLDOWN / 2 : CFG.COOLDOWN) * 1000;
  if (now < (fx.siestaUntil || 0)) cd *= 2;
  if (now < (fx.boostUntil || 0) && fx.boostTeam === p.team) cd /= 2;
  return cd;
}

// Ein Zug. Gibt null zurück oder eine Fehlermeldung für den Spieler.
function place(p, i, now) {
  if (phase === 'countdown') return 'Gleich geht\'s los …';
  if (phase !== 'play') return 'Die Runde läuft gerade nicht.';
  if (now < p.nextAt - 50) return 'Noch im Cooldown.';
  if (!Number.isInteger(i) || i < 0 || i >= N) return 'Ungültiges Feld.';
  const drunk = now < (fx.drunkUntil || 0) && fx.drunkTeam === p.team && Math.random() < 0.75;
  if (drunk) i = pick(neighbors(i));
  const err = placeCore(p, i, now);
  if (err && drunk) { p.nextAt = now + cooldownFor(p, now); return 'Hicks! Daneben gesetzt.'; }
  return err;
}
function placeCore(p, i, now) {
  const t = p.team;
  if (!land[i]) return 'Das ist Meer. 🌊';
  if (owner[i] === t) return 'Das Feld gehört schon euch.';
  if (base[i] >= 0) return 'Basen sind uneinnehmbar.';
  if (prot[i] > now) return 'Dieses Feld schützt gerade ein Paladin.';
  if (!neighbors(i).some(j => owner[j] === t)) {
    if (p.role === 'Magier' && owner[i] < 0 && now >= p.magicAt) p.magicAt = now + MAGIC_CD;
    else if (p.role === 'Magier' && owner[i] < 0) return 'Brückenkopf lädt noch.';
    else return 'Nur Felder direkt an eurem Gebiet.';
  }
  const wasNeutral = owner[i] < 0;
  if (hit(i, t, p.role === 'Krieger' ? 2 : 1, p)) {
    p.captures++;
    if (p.role === 'Paladin') prot[i] = now + PALADIN_PROT;
  }
  if (p.role === 'Baumeister' && wasNeutral) {
    const o = neighbors(i).filter(j => land[j] && owner[j] < 0 && base[j] < 0);
    if (o.length) { claim(pick(o), t, p); p.captures++; }
  }
  p.moves++;
  p.nextAt = now + cooldownFor(p, now);
  return null;
}

function botAct(p, now) {
  let target;
  if (p.role === 'Magier' && now >= p.magicAt && Math.random() < 0.3) {
    const free = []; for (let i = 0; i < N; i++) if (land[i] && owner[i] < 0) free.push(i);
    if (free.length) target = pick(free);
  }
  if (target === undefined) {
    const f = frontier(p.team, now);
    if (!f.neu.length && !f.en.length) { p.nextAt = now + 1000; return; }
    target = (f.neu.length && (Math.random() < 0.6 || !f.en.length)) ? pick(f.neu) : pick(f.en);
  }
  if (place(p, target, now)) p.nextAt = Math.max(p.nextAt, now + 400);
  p.nextAt += Math.random() * 1500; // Bots zögern etwas, wie Menschen
}
function golemAct(now) {
  const f = frontier(GOLEM, now);
  if (!f.neu.length && !f.en.length) return;
  hit((f.neu.length && (Math.random() < 0.7 || !f.en.length)) ? pick(f.neu) : pick(f.en), GOLEM, 1, null);
}

// ---------- Nachrichten an Clients ----------
function fullState() {
  const now = Date.now();
  return {
    cols: W, rows: H, colors: COLORS, roleInfo: ROLE_INFO, land: [...land], landCount: LAND_COUNT,
    teams: TEAMS.map((t, ti) => ({ name: t.name, color: t.color, town: t.town, bx: BASES[ti][0], by: BASES[ti][1] })),
    owner: [...owner], prev: [...prev], hp: [...hp], base: [...base],
    prot: [...prot].map(v => Math.max(0, v - now)),
  };
}
function meta() {
  const now = Date.now();
  // Während der Verräter-Enthüllung noch den sichtbaren Stand zeigen, danach den echten
  const s = phase === 'finale' && now >= finaleAt + REVEAL_MS ? finalScore : scores();
  const left = until => Math.max(0, (until || 0) - now);
  return {
    phase, winner, roundSecs,
    remainingMs: phase === 'play' ? Math.max(0, endsAt - now) : (phase === 'finale' ? 0 : roundSecs * 1000),
    countdownMs: phase === 'countdown' ? Math.max(0, startsAt - now) : 0,
    cells: s.cells, score: s.score, bonus: phase === 'finale' && now >= finaleAt + REVEAL_MS ? bonusCredit : bonus,
    fx: { siesta: left(fx.siestaUntil), drunk: left(fx.drunkUntil), drunkTeam: fx.drunkTeam, golem: left(fx.golemFastUntil), boost: left(fx.boostUntil), boostTeam: fx.boostTeam },
    opts,
    teams: TEAMS.map((_, ti) => [...players.values()].filter(p => p.team === ti)
      .map(p => ({ name: p.name, role: p.role, bot: p.bot, captures: p.captures, online: p.bot || p.online }))),
  };
}
function youState(p, err) {
  const now = Date.now();
  return {
    pid: p.pid, name: p.name, team: p.team, role: p.role, title: p.title,
    cooldownMs: Math.max(0, p.nextAt - now), cooldownTotal: cooldownFor(p, now),
    magicMs: p.role === 'Magier' ? Math.max(0, p.magicAt - now) : null, captures: p.captures,
    traitorFor: p.traitorFor, err: err || null, // nur an diesen einen Spieler!
  };
}

// ---------- Server ----------
const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server);
const pub = path.join(__dirname, 'public');

function lanIp() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return 'localhost';
}
function joinUrl(req) {
  if (CFG.PUBLIC_URL) return CFG.PUBLIC_URL;
  const host = req.get('host') || '';
  if (!/^(localhost|127\.)/.test(host)) return `${req.protocol}://${host}/`;
  return `http://${lanIp()}:${CFG.PORT}/`;
}
app.get('/beamer', (req, res) => res.sendFile(path.join(pub, 'beamer.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/info', (req, res) => res.json({ joinUrl: joinUrl(req) }));
app.get('/qr.svg', async (req, res) => {
  res.type('image/svg+xml').send(await QRCode.toString(joinUrl(req), { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } }));
});
app.use(express.static(pub));

function sendYouToAll() {
  for (const s of io.sockets.sockets.values()) { const p = players.get(s.data.pid); if (p) s.emit('you', youState(p)); }
}
function flush() {
  if (!changed.size) return;
  const now = Date.now();
  io.emit('diff', [...changed].map(i => [i, owner[i], prev[i], hp[i], Math.max(0, prot[i] - now)]));
  changed.clear();
}
// Admin drückt Start: Feld zurücksetzen, Verräter auslosen, 5 s Countdown, dann geht's los
function startCountdown(secs, o = {}) {
  roundSecs = Math.min(600, Math.max(15, Math.round(+secs) || CFG.ROUND));
  opts = { traitors: o.traitors !== false, events: o.events !== false };
  resetBoard();
  if (opts.traitors) assignTraitors();
  phase = 'countdown'; startsAt = Date.now() + COUNTDOWN_MS;
  io.emit('state', fullState()); io.emit('meta', meta()); sendYouToAll();
  console.log(`Countdown läuft (Runde ${roundSecs}s, Verräter ${opts.traitors ? 'an' : 'aus'}, Ereignisse ${opts.events ? 'an' : 'aus'})`);
}
function startRound() {
  const now = Date.now();
  phase = 'play'; endsAt = now + roundSecs * 1000; golemAt = now + 1000; nextEventAt = now + EVENT_EVERY; eventDeck = [];
  for (const p of players.values()) { p.nextAt = now; p.magicAt = now; p.moves = 0; p.captures = 0; }
  io.emit('meta', meta()); sendYouToAll();
  console.log('Runde gestartet');
}
function endRound() {
  flush();
  const vis = scores(); finalScore = trueScores();
  const s = finalScore.score.slice(0, 4);
  winner = s.indexOf(Math.max(...s)); phase = 'finale'; finaleAt = Date.now();
  const traitors = [...players.values()].filter(p => p.traitorFor != null).map(p => ({ name: p.name, team: p.team, target: p.traitorFor }));
  const flips = []; for (let i = 0; i < N; i++) if (owner[i] >= 0 && owner[i] < 4 && credit[i] !== owner[i] && credit[i] >= 0) flips.push([i, credit[i]]);
  io.emit('meta', meta());
  io.emit('finale', { winner, score: s[winner], visible: vis.score.slice(0, 4), final: s, traitors, flips });
  console.log(`Runde vorbei – Sieger: ${TEAMS[winner].name} (${s[winner]}), Verräter: ${traitors.map(t => t.name).join(', ') || 'keine'}`);
}

io.on('connection', socket => {
  socket.emit('state', fullState()); socket.emit('meta', meta());

  socket.on('join', (data, cb) => {
    const name = String((data && data.name) || '').trim().slice(0, 20) || 'Anonym';
    let p = data && data.pid && players.get(data.pid);
    if (!p || p.bot) p = newPlayer(name);
    p.online = true; socket.data.pid = p.pid;
    if (typeof cb === 'function') cb({ pid: p.pid });
    socket.emit('you', youState(p)); io.emit('meta', meta());
  });

  socket.on('place', i => {
    const p = players.get(socket.data.pid); if (!p) return;
    const err = place(p, Number(i), Date.now());
    socket.emit('you', youState(p, err));
  });

  socket.on('admin', ({ key, cmd, round, traitors, events, event } = {}) => {
    if (key !== CFG.ADMIN_KEY) return socket.emit('adminErr', 'Falscher Admin-Key');
    socket.emit('adminOk');
    if (cmd === 'hello') return;
    if (cmd === 'start' && phase !== 'countdown' && phase !== 'play') startCountdown(round, { traitors, events });
    else if (cmd === 'stop' && phase === 'play') endRound();
    else if (cmd === 'event' && phase === 'play') fireEvent(EVENTS[event] ? event : null);
    else if (cmd === 'reset') { phase = 'lobby'; resetBoard(); io.emit('state', fullState()); sendYouToAll(); }
    else if (cmd === 'bots') for (let k = 0; k < 4; k++) newPlayer(`Bot-${crypto.randomInt(100, 999)}`, true);
    else if (cmd === 'nobots') for (const [id, p] of players) if (p.bot) players.delete(id);
    else if (cmd === 'kickoffline') for (const [id, p] of players) if (!p.bot && !p.online) players.delete(id);
    io.emit('meta', meta());
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.data.pid);
    if (p && ![...io.sockets.sockets.values()].some(s => s.data.pid === p.pid)) { p.online = false; io.emit('meta', meta()); }
  });
});

// Spieltakt: 10× pro Sekunde
let metaAt = 0;
setInterval(() => {
  const now = Date.now();
  if (phase === 'countdown' && now >= startsAt) startRound();
  if (phase === 'play') {
    for (const p of players.values()) if (p.bot && now >= p.nextAt) botAct(p, now);
    if (now >= golemAt) { golemAct(now); golemAt = now + (now < (fx.golemFastUntil || 0) ? GOLEM_CD / 3 : GOLEM_CD); }
    if (opts.events && now >= nextEventAt) {
      if (endsAt - now > 18000) fireEvent(); // nicht mehr in den letzten 15 s
      nextEventAt = now + EVENT_EVERY;
    }
    if (now >= endsAt) endRound();
  }
  flush();
  if (now >= metaAt) { io.emit('meta', meta()); metaAt = now + 500; }
}, 100);

resetBoard();
if (DEMO) for (let k = 0; k < 14; k++) newPlayer(`Bot-${100 + k}`, true);
server.listen(CFG.PORT, () => {
  console.log(`Pixel-Krieg läuft auf Port ${CFG.PORT} (Karte ${CFG.MAP}, ${W}×${H}, ${LAND_COUNT} Landfelder, Runde ${CFG.ROUND}s, Cooldown ${CFG.COOLDOWN}s)${DEMO ? ' – DEMO mit 14 Bots' : ''}`);
  console.log(`  Spieler:  http://${lanIp()}:${CFG.PORT}/`);
  console.log(`  Beamer:   http://localhost:${CFG.PORT}/beamer`);
  console.log(`  Admin:    http://localhost:${CFG.PORT}/admin?key=${CFG.ADMIN_KEY}`);
});
