// Pixel-Krieg – gemeinsamer Client-Code (Spielfeld zeichnen, Punktestand, Finale)
'use strict';

const NEUTRAL = '#1b2130', EMPTY = '#10141d', SEA = '#0b2440', SEA2 = '#0c2745';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(r));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

const FONT = {
  G: ['111', '100', '101', '101', '111'], E: ['111', '100', '110', '100', '111'], W: ['101', '101', '101', '111', '101'],
  I: ['111', '010', '010', '010', '111'], N: ['101', '111', '111', '101', '101'], R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'], T: ['111', '010', '010', '010', '010'], D: ['110', '101', '101', '101', '110'],
  A: ['010', '101', '111', '101', '101'], K: ['101', '101', '110', '101', '101'],
};

class Board {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.cell = 10; this.N = 0; this.disp = null; this.hl = null; this.hover = -1; this.tok = 0;
  }
  load(s) {
    this.tok++; this.disp = null;
    this.W = s.cols; this.H = s.rows; this.N = s.cols * s.rows; this.colors = s.colors; this.teams = s.teams; this.roleInfo = s.roleInfo;
    this.land = Uint8Array.from(s.land); this.landCount = s.landCount;
    this.owner = Int8Array.from(s.owner); this.prev = Int8Array.from(s.prev); this.hp = Int8Array.from(s.hp); this.base = Int8Array.from(s.base);
    const now = Date.now();
    this.prot = Float64Array.from(s.prot, r => (r > 0 ? now + r : 0));
    this.flash = new Float64Array(this.N).fill(-1e9);
  }
  diff(list) {
    const now = Date.now(), pn = performance.now();
    for (const [i, o, p, h, pr] of list) { this.owner[i] = o; this.prev[i] = p; this.hp[i] = h; this.prot[i] = pr > 0 ? now + pr : 0; this.flash[i] = pn; }
  }
  fit(maxW, maxH) {
    if (!this.N) return;
    const dpr = window.devicePixelRatio || 1;
    this.cell = Math.max(4, Math.floor(Math.min(maxW / this.W, maxH / this.H)));
    this.cv.width = this.W * this.cell * dpr; this.cv.height = this.H * this.cell * dpr;
    this.cv.style.width = this.W * this.cell + 'px'; this.cv.style.height = this.H * this.cell + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  index(ev) {
    const r = this.cv.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / this.cell), y = Math.floor((ev.clientY - r.top) / this.cell);
    return (x < 0 || y < 0 || x >= this.W || y >= this.H) ? -1 : y * this.W + x;
  }
  neighbors(i) {
    const W = this.W, x = i % W, y = (i / W) | 0, r = [];
    if (x > 0) r.push(i - 1); if (x < W - 1) r.push(i + 1);
    if (y > 0) r.push(i - W); if (y < this.H - 1) r.push(i + W);
    return r;
  }
  // Felder, auf die Team t gerade setzen darf (für die Hervorhebung)
  frontier(t) {
    const m = new Uint8Array(this.N), now = Date.now();
    for (let i = 0; i < this.N; i++) {
      if (this.owner[i] !== t) continue;
      for (const j of this.neighbors(i)) if (this.land[j] && this.owner[j] !== t && this.base[j] < 0 && this.prot[j] <= now) m[j] = 1;
    }
    return m;
  }
  draw() {
    const { ctx, cell, W, H } = this; if (!this.N) return;
    const now = Date.now(), pn = performance.now();
    const g = cell >= 10 ? 1 : 0.5, bw = Math.max(2, cell * 0.2), s = cell - 2 * g;
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W * cell, H * cell);
    for (let i = 0; i < this.N; i++) {
      const x = (i % W) * cell, y = ((i / W) | 0) * cell;
      if (this.disp) { ctx.fillStyle = this.disp[i] || EMPTY; ctx.fillRect(x + g, y + g, s, s); continue; }
      if (!this.land[i]) { ctx.fillStyle = ((i % W) + ((i / W) | 0)) % 2 ? SEA : SEA2; ctx.fillRect(x, y, cell, cell); continue; }
      const o = this.owner[i];
      ctx.fillStyle = o < 0 ? NEUTRAL : this.colors[o];
      ctx.fillRect(x + g, y + g, s, s);
      if (o >= 0 && this.hp[i] === 1) { ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(x + g, y + g, s, s); }
      const p = this.prev[i];
      if (p >= 0 && p !== o) { // Rand = Farbe des Vorbesitzers
        ctx.strokeStyle = this.colors[p]; ctx.lineWidth = bw;
        ctx.strokeRect(x + g + bw / 2, y + g + bw / 2, s - bw, s - bw);
      }
      if (this.base[i] >= 0) { ctx.fillStyle = 'rgba(255,255,255,.55)'; const d = cell * 0.2; ctx.fillRect(x + cell / 2 - d / 2, y + cell / 2 - d / 2, d, d); }
      if (this.prot[i] > now) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3); }
      if (this.hl && this.hl[i]) { ctx.fillStyle = 'rgba(255,255,255,.13)'; ctx.fillRect(x + g, y + g, s, s); }
      const fa = pn - this.flash[i];
      if (fa < 500) { ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - fa / 500)})`; ctx.fillRect(x + g, y + g, s, s); }
    }
    if (this.hover >= 0 && !this.disp) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect((this.hover % W) * cell + 1, ((this.hover / W) | 0) * cell + 1, cell - 2, cell - 2);
    }
  }

  // ---------- Finale ----------
  textLetters(lines) {
    const { W, H } = this;
    const lw = l => [...l].reduce((a, ch) => a + FONT[ch][0].length + 1, 0) - 1;
    const tw = Math.max(...lines.map(lw)), th = lines.length * 5 + (lines.length - 1) * 2;
    let s = 1; while (tw * (s + 1) <= W - 2 && th * (s + 1) <= H - 2) s++;
    const y0 = Math.floor((H - th * s) / 2), letters = [];
    lines.forEach((line, li) => {
      let x = Math.floor((W - lw(line) * s) / 2); const yy = y0 + li * 7 * s;
      for (const ch of line) {
        const gl = FONT[ch], cells = [];
        gl.forEach((row, ry) => [...row].forEach((v, rx) => {
          if (v === '1') for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) cells.push((yy + ry * s + b) * W + x + rx * s + a);
        }));
        letters.push(cells); x += (gl[0].length + 1) * s;
      }
    });
    return letters;
  }
  logoCells() {
    const { W, H } = this, px = new Map(), set = (x, y, c) => px.set(x + ',' + y, c);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const d = Math.hypot(x - 4, y - 4);
      if (d <= 4.4) set(x, y, d > 3.3 ? '#0f4aa8' : '#1f6fd1');
    }
    ['01110', '10001', '11111', '10000', '01111'].forEach((r, y) => [...r].forEach((v, x) => { if (v === '1') set(x + 2, y + 2, '#ffffff'); }));
    const G = {
      M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
      i: ['1', '0', '1', '1', '1', '1', '1'],
      n: ['0000', '0000', '1110', '1001', '1001', '1001', '1001'],
      d: ['0001', '0001', '0111', '1001', '1001', '1001', '0111'],
    };
    let x0 = 11;
    for (const ch of 'Mind') { G[ch].forEach((r, y) => [...r].forEach((v, x) => { if (v === '1') set(x0 + x, y + 1, '#ffffff'); })); x0 += G[ch][0].length + 1; }
    const lw = 28, lh = 9;
    let s = 1; while (lw * (s + 1) <= W - 2 && lh * (s + 1) <= H - 2) s++;
    const ox = Math.floor((W - lw * s) / 2), oy = Math.floor((H - lh * s) / 2), out = [];
    for (const [k, c] of px) {
      const [x, y] = k.split(',').map(Number);
      for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) out.push([(oy + y * s + b) * W + ox + x * s + a, c]);
    }
    return out;
  }
  async finale(f, setCaption) {
    const { winner, score } = f;
    const tok = ++this.tok, { W, N } = this, t = this.teams[winner];
    const alive = () => { if (tok !== this.tok) throw new Error('abgebrochen'); };
    const animate = async (list, ms, fn) => {
      const t0 = performance.now(); let d = 0;
      while (d < list.length) { await frame(); alive(); const target = Math.min(list.length, Math.ceil(list.length * (performance.now() - t0) / ms)); for (; d < target; d++) fn(list[d]); }
    };
    const pause = async ms => { await sleep(ms); alive(); };
    try {
      const all = [...Array(N).keys()];
      this.disp = all.map(i => (!this.land[i] ? SEA : this.owner[i] < 0 ? NEUTRAL : this.colors[this.owner[i]]));
      await pause(400);
      // Verräter-Enthüllung: deren Felder blinken und wechseln in die Farbe des Teams, für das sie heimlich gespielt haben
      if (f.traitors && f.traitors.length) {
        const tn = k => `<span style="color:${this.teams[k].color}">${esc(this.teams[k].name)}</span>`;
        setCaption('Moment … es gab VERRÄTER!', '#ffffff'); Sound.reveal();
        await pause(1600);
        setCaption(f.traitors.map(x => `${esc(x.name)}: ${tn(x.team)} → ${tn(x.target)}`).join(' · '), '#ffffff', true);
        for (let k = 0; k < 6; k++) { f.flips.forEach(([i, c]) => (this.disp[i] = k % 2 ? this.colors[c] : '#ffffff')); Sound.beep(k % 2 ? 330 : 440, 0.12, 'square', 0.12); await pause(260); }
        f.flips.forEach(([i, c]) => (this.disp[i] = this.colors[c]));
        await pause(3600);
        setCaption('', '');
      }
      await animate(shuffle(all.slice()), 1500, i => (this.disp[i] = null));                    // Feld zerfällt
      await pause(300);
      for (const L of this.textLetters(['GEWINNER', 'IST'])) { L.forEach(i => (this.disp[i] = '#ffffff')); await pause(170); }
      await pause(900);
      const cx = t.bx, cy = t.by;
      const dist = i => Math.hypot(i % W - cx, ((i / W) | 0) - cy);
      const byDist = all.slice().sort((a, b) => dist(a) - dist(b));
      await animate(byDist, 1600, i => (this.disp[i] = t.color));                               // Flutung in Siegerfarbe
      setCaption(`${t.name} · ${score} Punkte`, t.color); Sound.fanfare();
      await pause(1600);
      for (const L of this.textLetters(['DANKE'])) { L.forEach(i => (this.disp[i] = '#ffffff')); await pause(160); }
      await pause(2200);
      await animate(byDist.slice().reverse(), 900, i => (this.disp[i] = null));
      setCaption('', '');
      await animate(shuffle(this.logoCells()), 2400, ([i, c]) => (this.disp[i] = c));           // eMind-Logo
    } catch (e) { /* neue Runde hat das Finale abgebrochen */ }
  }
}

// ---------- Töne (Web Audio, braucht einmal einen Klick zum Freischalten) ----------
const Sound = {
  ctx: null, on: false,
  unlock() {
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume(); this.on = true;
    } catch (e) { this.on = false; }
  },
  beep(freq, dur, type = 'square', vol = 0.15, when = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.05);
  },
  tick()    { this.beep(660, 0.09); },                                   // jede Sekunde
  five()    { this.beep(990, 0.3, 'square', 0.2); this.beep(1320, 0.3, 'square', 0.12, 0.12); }, // alle 5 s
  go()      { this.beep(784, 0.15, 'sawtooth', 0.2); this.beep(1568, 0.6, 'sawtooth', 0.2, 0.15); },
  end()     { this.beep(330, 0.25, 'sawtooth', 0.25); this.beep(165, 1.0, 'sawtooth', 0.25, 0.25); },
  event()   { [392, 523, 659].forEach((f, k) => this.beep(f, 0.18, 'triangle', 0.22, k * 0.1)); },
  reveal()  { [440, 415, 392, 370].forEach((f, k) => this.beep(f, 0.35, 'sawtooth', 0.18, k * 0.3)); },
  fanfare() { [523, 659, 784, 1047].forEach((f, k) => this.beep(f, k === 3 ? 0.8 : 0.22, 'triangle', 0.22, k * 0.16)); },
};

// ---------- Uhr + Countdown-Overlay + Beeps (für alle Ansichten gleich) ----------
// Start: "START IN 5 4 3 2 1 GO!" · Ende: letzte 15 s groß, jede Sekunde Tick, alle 5 s ein anderer Beep.
class Clock {
  constructor(overlay, timerEl) { this.overlay = overlay; this.timerEl = timerEl; this.m = null; this.lastS = null; this.phase = null; this.goUntil = 0; }
  setMeta(m) {
    const now = performance.now();
    if (m.phase !== this.phase) {
      if (this.phase === 'countdown' && m.phase === 'play' && this.goUntil < now) { this.goUntil = now + 1200; Sound.go(); }
      this.lastS = null; this.phase = m.phase;
    }
    this.endLocal = now + m.remainingMs; this.startLocal = now + (m.countdownMs || 0); this.m = m;
  }
  show(html) { this.overlay.innerHTML = html; this.overlay.style.opacity = 0.9; }
  hide() { this.overlay.style.opacity = 0; }
  // nur piepen, wenn die Sekunde wirklich kleiner wird (Netzwerk-Jitter erzeugt sonst Doppel-Beeps)
  next(s) { const changed = this.lastS !== null && s < this.lastS; this.lastS = this.lastS === null ? s : Math.min(this.lastS, s); return changed; }
  step() {
    const m = this.m; if (!m) return;
    const now = performance.now();
    const rem = m.phase === 'play' ? Math.max(0, this.endLocal - now) : m.remainingMs;
    this.timerEl.textContent = fmtTime(rem);
    if (m.phase === 'countdown') {
      const s = Math.ceil((this.startLocal - now) / 1000), first = this.lastS === null;
      const changed = this.next(s);
      if (s >= 1) { this.show(`<small>START IN</small>${s}`); if (changed || first) Sound.tick(); }
      else { this.show('GO!'); if (changed) { Sound.go(); this.goUntil = now + 1200; } }
    } else if (m.phase === 'play') {
      const s = Math.ceil(rem / 1000), changed = this.next(s);
      if (now < this.goUntil) this.show('GO!');
      else if (rem > 0 && rem <= 15000) this.show(String(s));
      else this.hide();
      if (changed && s <= 15) { if (s === 0) Sound.end(); else if (s % 5 === 0) Sound.five(); else Sound.tick(); }
    } else this.hide();
  }
}

// Ereigniskarte groß über dem Spielfeld einblenden
let eventTimer;
function showEvent(el, e) {
  el.innerHTML = `<div class="evtitle">${esc(e.title)}</div><div class="evtext">${esc(e.text)}</div>`;
  el.classList.add('show'); Sound.event();
  clearTimeout(eventTimer); eventTimer = setTimeout(() => el.classList.remove('show'), e.dur || 3500);
}
// Aktive Effekte als kurze Textzeile
function fxText(m, teams) {
  const f = m.fx || {}, s = ms => Math.ceil(ms / 1000) + ' s', out = [];
  if (f.siesta) out.push(`Siesta (${s(f.siesta)})`);
  if (f.drunk) out.push(`${teams[f.drunkTeam].name} betrunken (${s(f.drunk)})`);
  if (f.golem) out.push(`Golem rast (${s(f.golem)})`);
  if (f.boost) out.push(`Rückenwind für ${teams[f.boostTeam].name} (${s(f.boost)})`);
  return out.join(' · ');
}

// Punktestand (für Beamer und Spieler-Ansicht)
function renderScores(el, m, colors, teams, { members = false } = {}) {
  const total = m.cells.reduce((a, b) => a + b, 0) || 1;
  const rows = teams.map((t, ti) => ({ ti, t, s: m.score[ti], c: m.cells[ti], b: m.bonus[ti], ps: m.teams[ti] })).sort((a, b) => b.s - a.s);
  let html = rows.map(r => `
    <div class="team">
      <div class="row"><span style="color:${r.t.color}">${esc(r.t.name)}</span><span>${r.s}</span></div>
      <small>${r.t.town ? esc(r.t.town) + " · " : ""}${r.ps.length} Spieler · ${r.c} Felder · +${r.b} Golem-Bonus</small>
      <div class="bar"><i style="width:${(100 * r.c) / total}%;background:${r.t.color}"></i></div>
      ${members ? `<div class="members">${r.ps.map(p => `<span class="${p.online ? '' : 'off'}">${esc(p.name)} <em>${esc(p.role)}</em></span>`).join('')}</div>` : ''}
    </div>`).join('');
  html += `<div class="team golem"><div class="row"><span style="color:${colors[4]}">eMind-Golem (KI)</span><span>${m.cells[4]}</span></div>
    <small>neutral · zählt nicht für den Sieg</small><div class="bar"><i style="width:${(100 * m.cells[4]) / total}%;background:${colors[4]}"></i></div></div>`;
  el.innerHTML = html;
}
