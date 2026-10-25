// ---- App ----
const STD_TPR = [1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0];
const METHODS = {
  dak: { name: 'Dranchuk–Abou-Kassem', short: 'DAK', range: '1.0 ≤ Tpr ≤ 3.0, 0.2 ≤ Ppr ≤ 30', inRange: (p, t) => t >= 1.0 && t <= 3.0 && p <= 30,
    note: '11-constant equation of state fitted to about 1,500 points read from the Standing–Katz chart (average error about 0.5%). Solved by Newton iteration.' },
  hy: { name: 'Hall–Yarborough', short: 'HY', range: '1.0 ≤ Tpr ≤ 3.0, 0.1 ≤ Ppr ≤ 24', inRange: (p, t) => t >= 1.0 && t <= 3.0 && p <= 24,
    note: 'Starling–Carnahan equation of state fitted to the chart. Solved for reduced density y by Newton iteration. Not recommended below Tpr = 1.' },
  bb: { name: 'Brill–Beggs', short: 'BB', range: '1.15 ≤ Tpr ≤ 2.4, Ppr ≤ 10 (approx.)', inRange: (p, t) => t >= 1.15 && t <= 2.4 && p <= 10,
    note: 'Explicit (no iteration), handy for pipe-flow work. Breaks down quickly outside its range.' },
  papay: { name: 'Papay', short: 'Papay', range: 'Tpr ≥ 1.2, Ppr ≲ 3 (approx.)', inRange: (p, t) => t >= 1.2 && p <= 3,
    note: 'Simple explicit formula. Only for quick estimates at low reduced pressure.' },
};
const RANGES = {
  low: { x0: 0, x1: 8, y0: 0.25, y1: 1.1, xMaj: 1, xMin: 0.2 },
  high: { x0: 7, x1: 15, y0: 0.9, y1: 1.8, xMaj: 1, xMin: 0.2 },
  full: { x0: 0, x1: 15, y0: 0.25, y1: 1.8, xMaj: 1, xMin: 0.5 },
  ext: { x0: 0, x1: 30, y0: 0.25, y1: 3.0, xMaj: 2, xMin: 1 },
};
const DEFAULTS = { mode: 'gas', units: 'field', gamma: 0.65, corr: 'sutton', CO2: 0, H2S: 0, N2: 0, P: 3000, T: 180,
  Ppr: 2.0, Tpr: 1.5, method: 'dak', compare: false, range: 'low', pins: [] };

// Saved settings are untrusted input: only known keys, known choices and finite numbers are kept.
function sanitize(saved) {
  const out = Object.assign({}, DEFAULTS, { pins: [] });
  if (!saved || typeof saved !== 'object') return out;
  const pick = (k, allowed) => { if (allowed.includes(saved[k])) out[k] = saved[k]; };
  pick('mode', ['gas', 'direct']); pick('units', ['field', 'si']); pick('corr', Object.keys(PC_CORR));
  pick('method', Object.keys(METHODS)); pick('range', Object.keys(RANGES));
  if (typeof saved.compare === 'boolean') out.compare = saved.compare;
  for (const k of ['gamma', 'CO2', 'H2S', 'N2', 'P', 'T', 'Ppr', 'Tpr']) if (typeof saved[k] === 'number' && isFinite(saved[k])) out[k] = saved[k];
  if (Array.isArray(saved.pins)) {
    out.pins = saved.pins.slice(0, 12).filter(p => p && isFinite(p.p) && isFinite(p.z))
      .map(p => ({ p: +p.p, z: +p.z, t: isFinite(p.t) && p.t !== null ? +p.t : null }));
  }
  return out;
}
let S = sanitize(null);
try { S = sanitize(JSON.parse(localStorage.getItem('skz.v1') || 'null')); } catch (e) { /* storage unavailable or corrupt */ }
function save() { try { localStorage.setItem('skz.v1', JSON.stringify(S)); } catch (e) { /* ignore */ } }

const $ = id => document.getElementById(id);
const fmt = (x, d = 4) => (x === null || x === undefined || !isFinite(x)) ? '—' : Number(x).toFixed(d);
const fmtE = (x, d = 3) => (!isFinite(x)) ? '—' : Number(x).toExponential(d).replace('e', '×10^').replace(/\^\+?(-?\d+)/, (m, e) => '<sup>' + e + '</sup>');
const fmtEtxt = (x, d = 4) => (!isFinite(x)) ? '' : Number(x).toExponential(d);

// unit helpers (state is always field: psia, °F)
const PSI_KPA = 6.894757;
const U = {
  pIn: p => S.units === 'si' ? p * PSI_KPA : p,
  pOut: v => S.units === 'si' ? v / PSI_KPA : v,
  tIn: t => S.units === 'si' ? (t - 32) / 1.8 : t,
  tOut: v => S.units === 'si' ? v * 1.8 + 32 : v,
  pU: () => S.units === 'si' ? 'kPa' : 'psia',
  tU: () => S.units === 'si' ? '°C' : '°F',
  tcIn: r => S.units === 'si' ? r / 1.8 : r,       // °R -> K
  tcU: () => S.units === 'si' ? 'K' : '°R',
};

// ---------- core computation ----------
function compute() {
  const m = S.method;
  if (S.mode === 'gas') {
    const y = { CO2: S.CO2 / 100, H2S: S.H2S / 100, N2: S.N2 / 100 };
    const pc = pseudoCritical(S.gamma, y, S.corr);
    const Tabs = S.T + 459.67;
    const g = gasProps(S.P, Tabs, S.gamma, pc, m);
    return { mode: 'gas', Ppr: g.Ppr, Tpr: g.Tpr, z: g.z, zr: g.zr, g, pc, Tabs, y, dakR: dak(g.Ppr, g.Tpr) };
  }
  const zr = zBy(m, S.Ppr, S.Tpr);
  const h = Math.max(1e-4, S.Ppr * 1e-4);
  const dZ = (zBy(m, S.Ppr + h, S.Tpr).z - zBy(m, Math.max(1e-6, S.Ppr - h), S.Tpr).z) / (S.Ppr + h - Math.max(1e-6, S.Ppr - h));
  const cpr = S.Ppr > 0 ? 1 / S.Ppr - dZ / zr.z : NaN;
  return { mode: 'direct', Ppr: S.Ppr, Tpr: S.Tpr, z: zr.z, zr, cpr, dZ, dakR: dak(S.Ppr, S.Tpr) };
}

function tprThrough(Ppr, Z) {
  if (!(Ppr > 0.02)) return [];
  const roots = [];
  let tPrev = 1.05, fPrev = dak(Ppr, tPrev).z - Z;
  for (let t = 1.075; t <= 3.0001; t += 0.025) {
    const f = dak(Ppr, t).z - Z;
    if (fPrev === 0) roots.push(tPrev);
    else if (fPrev * f < 0) {
      let a = tPrev, b = t, fa = fPrev;
      for (let i = 0; i < 40; i++) { const c = (a + b) / 2, fc = dak(Ppr, c).z - Z; if (fa * fc <= 0) b = c; else { a = c; fa = fc; } }
      roots.push((a + b) / 2);
    }
    tPrev = t; fPrev = f;
  }
  return roots;
}

// ---------- inputs ----------
function syncInputs() {
  $('modeGas').setAttribute('aria-pressed', S.mode === 'gas');
  $('modeDirect').setAttribute('aria-pressed', S.mode === 'direct');
  $('gasInputs').hidden = S.mode !== 'gas';
  $('directInputs').hidden = S.mode !== 'direct';
  $('unitField').setAttribute('aria-pressed', S.units === 'field');
  $('unitSI').setAttribute('aria-pressed', S.units === 'si');
  $('uP').textContent = U.pU(); $('uT').textContent = U.tU();
  const si = S.units === 'si';
  $('rgP').min = si ? 100 : 15; $('rgP').max = si ? 100000 : 15000; $('rgP').step = si ? 50 : 5;
  $('rgT').min = si ? 5 : 40; $('rgT').max = si ? 205 : 400; $('rgT').step = 1;
  if (document.activeElement !== $('inP')) $('inP').value = +U.pIn(S.P).toFixed(si ? 1 : 1);
  if (document.activeElement !== $('inT')) $('inT').value = +U.tIn(S.T).toFixed(1);
  $('rgP').value = U.pIn(S.P); $('rgT').value = U.tIn(S.T);
  if (document.activeElement !== $('inG')) $('inG').value = S.gamma;
  $('rgG').value = S.gamma;
  $('inCorr').value = S.corr;
  for (const k of ['CO2', 'H2S', 'N2']) if (document.activeElement !== $('in' + k)) $('in' + k).value = S[k];
  if (document.activeElement !== $('inPpr')) $('inPpr').value = S.Ppr;
  if (document.activeElement !== $('inTpr')) $('inTpr').value = S.Tpr;
  $('rgPpr').value = Math.min(15, S.Ppr); $('rgTpr').value = S.Tpr;
  $('inMethod').value = S.method;
  $('methodNote').textContent = METHODS[S.method].note;
  $('cbCompare').checked = S.compare;
  $('cbCompare').disabled = S.method === 'dak';
  document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', b.dataset.range === S.range));
}

function num(v, fallback) { const x = parseFloat(v); return isFinite(x) ? x : fallback; }

function onChange(autoRange = true) {
  S.gamma = Math.min(2.0, Math.max(0.55, S.gamma));
  S.P = Math.max(1, S.P);
  for (const k of ['CO2', 'H2S', 'N2']) S[k] = Math.min(80, Math.max(0, S[k]));
  if (S.CO2 + S.H2S + S.N2 > 95) S.N2 = Math.max(0, 95 - S.CO2 - S.H2S);
  S.Ppr = Math.min(30, Math.max(0, S.Ppr));
  S.Tpr = Math.min(3, Math.max(1.0, S.Tpr));
  const r = compute();
  if (autoRange) {
    const R = RANGES[S.range];
    if (r.Ppr < R.x0 || r.Ppr > R.x1 || r.z < R.y0 || r.z > R.y1) {
      S.range = r.Ppr <= 8 && r.z >= 0.25 && r.z <= 1.1 ? 'low' : r.Ppr <= 15 && r.Ppr >= 7 && r.z >= 0.9 ? 'high' : r.Ppr <= 15 ? 'full' : 'ext';
    }
  }
  save();
  syncInputs();
  render(r);
}

function bind() {
  $('modeGas').onclick = () => { S.mode = 'gas'; onChange(); };
  $('modeDirect').onclick = () => { const r = compute(); S.Ppr = +r.Ppr.toFixed(3); S.Tpr = +Math.min(3, Math.max(1, r.Tpr)).toFixed(3); S.mode = 'direct'; onChange(); };
  $('unitField').onclick = () => { S.units = 'field'; onChange(false); };
  $('unitSI').onclick = () => { S.units = 'si'; onChange(false); };
  $('inP').oninput = e => { const v = num(e.target.value, null); if (v > 0) { S.P = U.pOut(v); onChange(); } };
  $('rgP').oninput = e => { S.P = U.pOut(num(e.target.value, S.P)); onChange(); };
  $('inT').oninput = e => { const v = num(e.target.value, null); if (v !== null) { S.T = U.tOut(v); onChange(); } };
  $('rgT').oninput = e => { S.T = U.tOut(num(e.target.value, S.T)); onChange(); };
  $('inG').oninput = e => { const v = num(e.target.value, null); if (v >= 0.55 && v <= 2) { S.gamma = v; onChange(); } };
  $('rgG').oninput = e => { S.gamma = num(e.target.value, S.gamma); onChange(); };
  $('inCorr').onchange = e => { S.corr = e.target.value; onChange(); };
  for (const k of ['CO2', 'H2S', 'N2']) $('in' + k).oninput = e => { S[k] = num(e.target.value, 0); onChange(); };
  $('inPpr').oninput = e => { const v = num(e.target.value, null); if (v !== null && v >= 0) { S.Ppr = v; onChange(); } };
  $('rgPpr').oninput = e => { S.Ppr = num(e.target.value, S.Ppr); onChange(); };
  $('inTpr').oninput = e => { const v = num(e.target.value, null); if (v >= 1 && v <= 3) { S.Tpr = v; onChange(); } };
  $('rgTpr').oninput = e => { S.Tpr = num(e.target.value, S.Tpr); onChange(); };
  $('inMethod').onchange = e => { S.method = e.target.value; if (S.method === 'dak') S.compare = false; onChange(); };
  $('cbCompare').onchange = e => { S.compare = e.target.checked; onChange(false); };
  document.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { S.range = b.dataset.range; onChange(false); });
  $('btnReset').onclick = () => { S = Object.assign(sanitize(null), { units: S.units }); onChange(); };
  $('btnCopy').onclick = copyCSV;
  for (const id of ['inP', 'inT', 'inG', 'inCO2', 'inH2S', 'inN2', 'inPpr', 'inTpr']) $(id).onblur = () => syncInputs();
}

// ---------- chart ----------
const cv = $('cv'), ctx = cv.getContext('2d'), plot = $('plot'), tip = $('tip');
let W = 0, H = 0, hover = null, lastResult = null;
const M = { l: 54, r: 46, t: 14, b: 44 };
const curveCache = new Map();

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function X(p) { const R = RANGES[S.range]; return M.l + (p - R.x0) / (R.x1 - R.x0) * (W - M.l - M.r); }
function Y(z) { const R = RANGES[S.range]; return M.t + (R.y1 - z) / (R.y1 - R.y0) * (H - M.t - M.b); }
function invX(x) { const R = RANGES[S.range]; return R.x0 + (x - M.l) / (W - M.l - M.r) * (R.x1 - R.x0); }
function invY(y) { const R = RANGES[S.range]; return R.y1 - (y - M.t) / (H - M.t - M.b) * (R.y1 - R.y0); }

function curve(method, Tpr) {
  const R = RANGES[S.range];
  const key = method + '|' + S.range + '|' + Tpr.toFixed(4);
  if (curveCache.has(key)) return curveCache.get(key);
  const pts = [];
  const n = 360;
  for (let i = 0; i <= n; i++) {
    const p = Math.max(0.001, R.x0 + (R.x1 - R.x0) * i / n);
    pts.push([p, zBy(method, p, Tpr).z]);
  }
  if (curveCache.size > 400) curveCache.clear();
  curveCache.set(key, pts);
  return pts;
}

function drawPath(pts, R) {
  ctx.beginPath();
  let pen = false;
  for (const [p, z] of pts) {
    if (!isFinite(z) || z < R.y0 - 0.3 || z > R.y1 + 0.3) { pen = false; continue; }
    const x = X(p), y = Y(z);
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function resize() {
  const r = plot.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  M.l = W < 480 ? 42 : 54; M.r = W < 480 ? 36 : 46;
  draw();
}

function draw() {
  if (!W || !lastResult) return;
  const R = RANGES[S.range], r = lastResult;
  const C = { ink: css('--ink'), muted: css('--muted'), major: css('--grid-major'), minor: css('--grid-minor'), curve: css('--curve'),
    accent: css('--accent'), pin: css('--pin'), panel: css('--panel'), soft: css('--accent-soft') };
  ctx.clearRect(0, 0, W, H);
  const fontData = getComputedStyle(document.body).getPropertyValue('--font-data') || 'monospace';
  const small = W < 480;

  // grid
  ctx.save();
  ctx.beginPath(); ctx.rect(M.l, M.t, W - M.l - M.r, H - M.t - M.b); ctx.clip();
  ctx.lineWidth = 1;
  const zMinor = (R.y1 - R.y0) > 1.6 ? 0.05 : 0.02;
  ctx.strokeStyle = C.minor; ctx.beginPath();
  for (let p = Math.ceil(R.x0 / R.xMin) * R.xMin; p <= R.x1 + 1e-9; p += R.xMin) { const x = Math.round(X(p)) + 0.5; ctx.moveTo(x, M.t); ctx.lineTo(x, H - M.b); }
  for (let z = Math.ceil(R.y0 / zMinor) * zMinor; z <= R.y1 + 1e-9; z += zMinor) { const y = Math.round(Y(z)) + 0.5; ctx.moveTo(M.l, y); ctx.lineTo(W - M.r, y); }
  ctx.stroke();
  ctx.strokeStyle = C.major; ctx.beginPath();
  for (let p = Math.ceil(R.x0 / R.xMaj) * R.xMaj; p <= R.x1 + 1e-9; p += R.xMaj) { const x = Math.round(X(p)) + 0.5; ctx.moveTo(x, M.t); ctx.lineTo(x, H - M.b); }
  const zMaj = (R.y1 - R.y0) > 1.6 ? 0.2 : 0.1;
  for (let z = Math.ceil(R.y0 / zMaj - 1e-9) * zMaj; z <= R.y1 + 1e-9; z += zMaj) { const y = Math.round(Y(z)) + 0.5; ctx.moveTo(M.l, y); ctx.lineTo(W - M.r, y); }
  ctx.stroke();
  // Z = 1 reference
  if (R.y0 < 1 && R.y1 > 1) { ctx.strokeStyle = C.muted; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(M.l, Y(1)); ctx.lineTo(W - M.r, Y(1)); ctx.stroke(); ctx.setLineDash([]); }

  // standard isotherms (DAK)
  ctx.lineWidth = 1.15; ctx.strokeStyle = C.curve;
  const ends = [];
  for (const t of STD_TPR) {
    const pts = curve('dak', t);
    drawPath(pts, R);
    const last = pts[pts.length - 1];
    ends.push({ t, y: Y(last[1]) });
  }
  // comparison overlay
  if (S.compare && S.method !== 'dak') {
    ctx.setLineDash([5, 4]); ctx.strokeStyle = C.pin; ctx.lineWidth = 1;
    for (const t of STD_TPR) drawPath(curve(S.method, t), R);
    ctx.setLineDash([]);
  }
  // operating isotherm
  const opT = r.Tpr;
  if (opT >= 1.0 && opT <= 3.5) {
    ctx.lineWidth = 2.6; ctx.strokeStyle = C.accent;
    drawPath(curve(S.method, opT), R);
  }
  // pins
  S.pins.forEach((pn, i) => {
    if (pn.p < R.x0 || pn.p > R.x1 || pn.z < R.y0 || pn.z > R.y1) return;
    const x = X(pn.p), y = Y(pn.z);
    ctx.fillStyle = C.pin; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.panel; ctx.font = '600 10px ' + fontData; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + 0.5);
  });
  // operating point
  if (r.Ppr >= R.x0 && r.Ppr <= R.x1 && r.z >= R.y0 && r.z <= R.y1) {
    const x = X(r.Ppr), y = Y(r.z);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, H - M.b); ctx.moveTo(x, y); ctx.lineTo(M.l, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.panel; ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.accent; ctx.stroke();
    ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  // hover crosshair
  if (hover) {
    ctx.strokeStyle = C.ink; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(hover.p), M.t); ctx.lineTo(X(hover.p), H - M.b); ctx.moveTo(M.l, Y(hover.z)); ctx.lineTo(W - M.r, Y(hover.z)); ctx.stroke();
    ctx.setLineDash([]);
    if (hover.near) {
      ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.55;
      drawPath(curve('dak', hover.near.t), R); ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // frame
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.strokeRect(M.l + 0.5, M.t + 0.5, W - M.l - M.r - 1, H - M.t - M.b - 1);

  // axis labels
  ctx.fillStyle = C.ink; ctx.font = (small ? '10px ' : '11px ') + fontData; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const xLabStep = small && R.x1 - R.x0 > 10 ? R.xMaj * 2 : R.xMaj;
  for (let p = Math.ceil(R.x0 / xLabStep) * xLabStep; p <= R.x1 + 1e-9; p += xLabStep) ctx.fillText(String(+p.toFixed(2)), X(p), H - M.b + 6);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let z = Math.ceil(R.y0 / zMaj - 1e-9) * zMaj; z <= R.y1 + 1e-9; z += zMaj) ctx.fillText(z.toFixed(1), M.l - 6, Y(z));
  ctx.font = '600 11px ' + (getComputedStyle(document.body).getPropertyValue('--font-display') || 'sans-serif');
  ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('PSEUDO-REDUCED PRESSURE, Ppr', M.l + (W - M.l - M.r) / 2, H - 6);
  ctx.save(); ctx.translate(12, M.t + (H - M.t - M.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('COMPRESSIBILITY FACTOR, Z', 0, 0); ctx.restore();

  // isotherm labels: under each curve's minimum (as on the printed chart), else at the right edge
  ctx.font = (small ? '9px ' : '10px ') + fontData; ctx.textBaseline = 'middle';
  const placed = [];
  const fits = (x, y, w, h) => !placed.some(b => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
  const rightEnds = [];
  for (const t of STD_TPR) {
    const pts = curve('dak', t);
    let mi = -1;
    for (let i = 3; i < pts.length - 3; i++) if (mi < 0 || pts[i][1] < pts[mi][1]) mi = i;
    const interior = mi > 3 && mi < pts.length - 4 && pts[mi][1] < pts[mi - 3][1] && pts[mi][1] < pts[mi + 3][1];
    const txt = t.toFixed(2);
    const w = ctx.measureText(txt).width + 4, h = small ? 10 : 12;
    if (interior && pts[mi][1] > R.y0 && pts[mi][1] < R.y1) {
      const x = X(pts[mi][0]) - w / 2, y = Y(pts[mi][1]) + 4;
      if (y + h < H - M.b && fits(x, y, w, h)) {
        placed.push({ x, y, w, h });
        ctx.fillStyle = C.panel; ctx.globalAlpha = 0.85; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
        ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.fillText(txt, x + w / 2, y + h / 2 + 0.5);
        continue;
      }
    }
    const last = pts[pts.length - 1];
    const ly = Y(last[1]);
    if (ly >= M.t - 4 && ly <= H - M.b + 4) rightEnds.push({ txt, y: ly });
  }
  rightEnds.sort((a, b) => a.y - b.y);
  const gap = small ? 10 : 11.5;
  let lastY = -1e9;
  ctx.textAlign = 'left'; ctx.fillStyle = C.muted;
  for (const e of rightEnds) {
    if (e.y - lastY < gap) continue; // crowded: the hover readout names every curve
    if (e.y < M.t + 6) continue;
    ctx.fillText(e.txt, W - M.r + 5, e.y);
    lastY = e.y;
  }
  ctx.fillStyle = C.muted; ctx.font = '600 10px ' + fontData; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('Tpr', W - M.r + 5, M.t - 1 > 10 ? M.t - 1 : 11);
}

function pointerToData(ev) {
  const rect = cv.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  if (x < M.l || x > W - M.r || y < M.t || y > H - M.b) return null;
  return { x, y, p: invX(x), z: invY(y) };
}

function readAt(p, z) {
  let near = null;
  for (const t of STD_TPR) { const zt = dak(p, t).z; const d = Math.abs(zt - z); if (!near || d < near.d) near = { t, z: zt, d }; }
  const roots = tprThrough(p, z);
  return { near, roots };
}

cv.addEventListener('pointermove', ev => {
  const d = pointerToData(ev);
  if (!d) { hover = null; tip.hidden = true; draw(); return; }
  const rd = readAt(d.p, d.z);
  hover = { p: d.p, z: d.z, near: rd.near };
  const tprTxt = rd.roots.length ? rd.roots.map(t => t.toFixed(3)).join(' or ') : (d.p <= 0.02 ? '—' : 'outside 1.05–3.0');
  tip.innerHTML = `<span class="t">Ppr</span> <b>${fmt(d.p, 3)}</b> &nbsp;<span class="t">Z</span> <b>${fmt(d.z, 4)}</b><br>`
    + `<span class="t">Tpr through point</span> ${tprTxt}<br>`
    + `<span class="t">Nearest isotherm</span> ${rd.near.t.toFixed(2)} → Z ${fmt(rd.near.z, 4)}`;
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let tx = d.x + 14, ty = d.y - th - 12;
  if (tx + tw > W - 4) tx = d.x - tw - 14;
  if (ty < 4) ty = d.y + 16;
  tip.style.left = Math.max(4, tx) + 'px'; tip.style.top = Math.max(4, ty) + 'px';
  draw();
});
cv.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; draw(); });
cv.addEventListener('click', ev => {
  const d = pointerToData(ev);
  if (!d) return;
  const roots = tprThrough(d.p, d.z);
  S.pins.push({ p: +d.p.toFixed(4), z: +d.z.toFixed(4), t: roots.length ? +roots[0].toFixed(4) : null });
  if (S.pins.length > 12) S.pins.shift();
  save(); renderPins(); draw();
});

function renderPins() {
  const box = $('pins');
  box.innerHTML = '';
  $('pinsEmpty').hidden = S.pins.length > 0;
  S.pins.forEach((pn, i) => {
    const row = document.createElement('div');
    row.className = 'pin';
    row.innerHTML = `<span class="n">${i + 1}</span><span>P<sub>pr</sub> ${fmt(pn.p, 3)} &nbsp;Z ${fmt(pn.z, 4)}<br>T<sub>pr</sub> ${pn.t ? fmt(pn.t, 3) : 'outside 1.05–3.0'}</span>`;
    const acts = document.createElement('span'); acts.className = 'acts';
    if (pn.t) {
      const use = document.createElement('button'); use.className = 'btn'; use.type = 'button'; use.textContent = 'Use';
      use.title = 'Make this the operating point (Ppr & Tpr mode)';
      use.onclick = () => { S.mode = 'direct'; S.Ppr = pn.p; S.Tpr = pn.t; onChange(); };
      acts.appendChild(use);
    }
    const del = document.createElement('button'); del.className = 'btn'; del.type = 'button'; del.textContent = '×';
    del.setAttribute('aria-label', 'Remove reading ' + (i + 1));
    del.onclick = () => { S.pins.splice(i, 1); save(); renderPins(); draw(); };
    acts.appendChild(del);
    row.appendChild(acts);
    box.appendChild(row);
  });
  if (S.pins.length) {
    const clr = document.createElement('button'); clr.className = 'btn'; clr.type = 'button'; clr.textContent = 'Clear all';
    clr.onclick = () => { S.pins = []; save(); renderPins(); draw(); };
    box.appendChild(clr);
  }
}

// ---------- readout ----------
function render(r) {
  lastResult = r;
  $('outZ').textContent = fmt(r.z, 4);
  const chips = [];
  const meth = METHODS[S.method];
  if (!isFinite(r.z) || r.z <= 0) chips.push(['bad', 'No valid solution']);
  else if (meth.inRange(r.Ppr, r.Tpr)) chips.push(['ok', 'Within ' + meth.short + ' range']);
  else chips.push(['warn', 'Outside ' + meth.short + ' range']);
  if (r.Tpr < 1.05) chips.push(['warn', 'Tpr < 1.05: near critical']);
  if (r.Ppr > 15) chips.push(['warn', 'Ppr > 15: beyond printed chart']);
  if ((S.method === 'dak' || S.method === 'hy') && r.zr && r.zr.ok === false) chips.push(['bad', 'Iteration did not converge']);
  if (r.mode === 'gas' && r.pc.steps.eps > 0.01) chips.push(['ok', 'Sour-gas corrected']);
  $('chips').innerHTML = chips.map(([c, t]) => `<span class="chip ${c}">${t}</span>`).join('');

  const kv = [];
  const row = (k, v) => kv.push(`<dt>${k}</dt><dd>${v}</dd>`);
  const sep = () => kv.push('<div class="sep"></div>');
  if (r.mode === 'gas') {
    const g = r.g, si = S.units === 'si';
    row('T<sub>pc</sub>', fmt(U.tcIn(r.pc.tc), 1) + ' ' + U.tcU());
    row('P<sub>pc</sub>', fmt(U.pIn(r.pc.pc), si ? 0 : 1) + ' ' + U.pU());
    row('<i>P<sub>pr</sub></i>', fmt(r.Ppr, 4));
    row('<i>T<sub>pr</sub></i>', fmt(r.Tpr, 4));
    if (r.dakR) row('ρ<sub>r</sub> (DAK)', fmt(r.dakR.rho, 4));
    sep();
    row('M<sub>a</sub>', fmt(g.Ma, 2) + ' lb/lb-mol');
    row('ρ<sub>g</sub>', si ? fmt(g.rho * 16.01846, 2) + ' kg/m³' : fmt(g.rho, 3) + ' lb/ft³');
    row('B<sub>g</sub>', si ? fmt(g.Bg, 6) + ' m³/sm³' : fmt(g.Bg, 6) + ' ft³/scf');
    if (!si) row('B<sub>g</sub>', fmt(g.Bg / 5.614583 * 1000, 4) + ' rb/Mscf');
    row('E<sub>g</sub>', fmt(g.Eg, 2) + (si ? ' sm³/m³' : ' scf/ft³'));
    row('c<sub>g</sub>', si ? fmtE(g.cg / PSI_KPA) + ' kPa⁻¹' : fmtE(g.cg) + ' psi⁻¹');
    row('c<sub>pr</sub>', fmt(g.cpr, 4));
    row('μ<sub>g</sub> (LGE)', fmt(g.mu, 4) + (si ? ' mPa·s' : ' cp'));
  } else {
    row('<i>P<sub>pr</sub></i>', fmt(r.Ppr, 4));
    row('<i>T<sub>pr</sub></i>', fmt(r.Tpr, 4));
    if (r.dakR) row('ρ<sub>r</sub> (DAK)', fmt(r.dakR.rho, 4));
    row('(∂Z/∂P<sub>pr</sub>)<sub>T</sub>', fmt(r.dZ, 4));
    row('c<sub>pr</sub>', fmt(r.cpr, 4));
  }
  $('outKV').innerHTML = kv.join('');

  renderSteps(r);
  renderCompare(r);
  renderIso(r);
  renderPins();
  draw();
}

// ---------- worked solution ----------
function renderSteps(r) {
  const out = [];
  const step = (title, text, eqs) => out.push(`<div class="step"><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}<div class="eqs">${eqs.map(e => `<div class="eq">${e}</div>`).join('')}</div></div>`);
  const R = v => `<span class="r">${v}</span>`;
  if (r.mode === 'gas') {
    const s = r.pc.steps, g = r.g;
    step('Apparent molecular weight', S.units === 'si' ? 'The worked solution is in field units (psia, °R), the units the correlations were published in.' : '',
      [`M<sub>a</sub> = 28.9647 γ<sub>g</sub> = 28.9647 × ${fmt(S.gamma, 3)} = ${R(fmt(g.Ma, 3) + ' lb/lb-mol')}`]);
    if (s.yNon > 0) {
      step('Hydrocarbon-fraction gravity', 'Remove the non-hydrocarbons before applying the gravity correlation (Standing\'s method).',
        [`γ<sub>HC</sub> = (γ<sub>g</sub> − Σ y<sub>i</sub>M<sub>i</sub> / 28.9647) / (1 − Σ y<sub>i</sub>)`,
         `γ<sub>HC</sub> = (${fmt(S.gamma, 3)} − ${fmt(s.nonMass, 4)} / 28.9647) / (1 − ${fmt(s.yNon, 4)}) = ${R(fmt(s.gHC, 4))}`]);
    }
    const gUse = s.yNon > 0 ? 'γ<sub>HC</sub>' : 'γ<sub>g</sub>';
    step('Pseudo-critical properties', r.pc.corr.name + (s.yNon > 0 ? ', applied to the hydrocarbon fraction.' : '.'),
      [r.pc.corr.tcTxt.replace(/γ/g, gUse) + ` = ${R(fmt(s.tcHC, 2) + ' °R')}`,
       r.pc.corr.pcTxt.replace(/γ/g, gUse) + ` = ${R(fmt(s.pcHC, 2) + ' psia')}`]);
    if (s.yNon > 0) {
      step('Kay\'s mixing rule', `N₂ ${fmt(S.N2, 2)}%, CO₂ ${fmt(S.CO2, 2)}%, H₂S ${fmt(S.H2S, 2)}%.`,
        [`T′<sub>pc</sub> = (1 − Σy<sub>i</sub>) T<sub>pc,HC</sub> + Σ y<sub>i</sub>T<sub>c,i</sub> = ${R(fmt(s.tcMix, 2) + ' °R')}`,
         `P′<sub>pc</sub> = (1 − Σy<sub>i</sub>) P<sub>pc,HC</sub> + Σ y<sub>i</sub>P<sub>c,i</sub> = ${R(fmt(s.pcMix, 2) + ' psia')}`]);
    }
    if (s.eps > 0) {
      step('Wichert–Aziz sour-gas correction', 'Adjusts for CO₂ and H₂S, which the Standing–Katz chart did not include.',
        [`A = y<sub>CO₂</sub> + y<sub>H₂S</sub> = ${fmt(s.A, 4)},  B = y<sub>H₂S</sub> = ${fmt(s.B, 4)}`,
         `ε = 120 (A<sup>0.9</sup> − A<sup>1.6</sup>) + 15 (B<sup>0.5</sup> − B<sup>4</sup>) = ${R(fmt(s.eps, 3) + ' °R')}`,
         `T*<sub>pc</sub> = T′<sub>pc</sub> − ε = ${fmt(s.tcMix, 2)} − ${fmt(s.eps, 3)} = ${R(fmt(r.pc.tc, 2) + ' °R')}`,
         `P*<sub>pc</sub> = P′<sub>pc</sub> T*<sub>pc</sub> / (T′<sub>pc</sub> + B(1 − B)ε) = ${R(fmt(r.pc.pc, 2) + ' psia')}`]);
    }
    step('Pseudo-reduced conditions', '',
      [`T = ${fmt(S.T, 2)} °F + 459.67 = ${fmt(r.Tabs, 2)} °R`,
       `T<sub>pr</sub> = T / T<sub>pc</sub> = ${fmt(r.Tabs, 2)} / ${fmt(r.pc.tc, 2)} = ${R(fmt(r.Tpr, 4))}`,
       `P<sub>pr</sub> = P / P<sub>pc</sub> = ${fmt(S.P, 2)} / ${fmt(r.pc.pc, 2)} = ${R(fmt(r.Ppr, 4))}`]);
  } else {
    step('Pseudo-reduced conditions', 'Entered directly.', [`P<sub>pr</sub> = ${R(fmt(r.Ppr, 4))},  T<sub>pr</sub> = ${R(fmt(r.Tpr, 4))}`]);
  }

  // Z step
  const P = r.Ppr, T = r.Tpr;
  if (S.method === 'dak') {
    const it = r.dakR.iters.slice(0, 8).map(o => `k = ${o.i}:  ρ<sub>r</sub> = ${fmt(o.rho, 6)}  →  Z = ${fmt(o.z, 6)}`);
    step('Solve the Dranchuk–Abou-Kassem equation', 'Newton iteration on the reduced density, starting from Z = 1.',
      [`ρ<sub>r</sub> = 0.27 P<sub>pr</sub> / (Z T<sub>pr</sub>)`,
       `Z = 1 + (A<sub>1</sub> + A<sub>2</sub>/T<sub>pr</sub> + A<sub>3</sub>/T<sub>pr</sub><sup>3</sup> + A<sub>4</sub>/T<sub>pr</sub><sup>4</sup> + A<sub>5</sub>/T<sub>pr</sub><sup>5</sup>) ρ<sub>r</sub>`,
       `&nbsp;&nbsp;&nbsp;&nbsp;+ (A<sub>6</sub> + A<sub>7</sub>/T<sub>pr</sub> + A<sub>8</sub>/T<sub>pr</sub><sup>2</sup>) ρ<sub>r</sub><sup>2</sup> − A<sub>9</sub>(A<sub>7</sub>/T<sub>pr</sub> + A<sub>8</sub>/T<sub>pr</sub><sup>2</sup>) ρ<sub>r</sub><sup>5</sup>`,
       `&nbsp;&nbsp;&nbsp;&nbsp;+ A<sub>10</sub>(1 + A<sub>11</sub>ρ<sub>r</sub><sup>2</sup>)(ρ<sub>r</sub><sup>2</sup>/T<sub>pr</sub><sup>3</sup>) exp(−A<sub>11</sub>ρ<sub>r</sub><sup>2</sup>)`,
       `A<sub>1…11</sub> = 0.3265, −1.0700, −0.5339, 0.01569, −0.05165, 0.5475, −0.7361, 0.1844, 0.1056, 0.6134, 0.7210`,
       `Initial guess: ρ<sub>r</sub> = 0.27 × ${fmt(P, 4)} / (1 × ${fmt(T, 4)}) = ${fmt(0.27 * P / T, 6)}`,
       ...it,
       (r.dakR.iters.length > 8 ? `… ${r.dakR.iters.length} iterations in total` : `Converged after ${r.dakR.iters.length} iterations`),
       `Z = ${R(fmt(r.z, 5))}`]);
  } else if (S.method === 'hy') {
    const t = 1 / T;
    step('Solve the Hall–Yarborough equation', 'Newton iteration on the reduced density y.',
      [`t = 1 / T<sub>pr</sub> = ${fmt(t, 5)}`,
       `−A P<sub>pr</sub> + (y + y<sup>2</sup> + y<sup>3</sup> − y<sup>4</sup>)/(1 − y)<sup>3</sup> − B y<sup>2</sup> + C y<sup>D</sup> = 0`,
       `A = 0.06125 t e<sup>−1.2(1−t)²</sup> = ${fmt(0.06125 * t * Math.exp(-1.2 * (1 - t) ** 2), 6)}`,
       `B = 14.76t − 9.76t² + 4.58t³ = ${fmt(14.76 * t - 9.76 * t * t + 4.58 * t ** 3, 5)}`,
       `C = 90.7t − 242.2t² + 42.4t³ = ${fmt(90.7 * t - 242.2 * t * t + 42.4 * t ** 3, 5)}`,
       `D = 2.18 + 2.82t = ${fmt(2.18 + 2.82 * t, 5)}`,
       `Z = A P<sub>pr</sub> / y = ${R(fmt(r.z, 5))}`]);
  } else if (S.method === 'bb') {
    const A = 1.39 * Math.sqrt(T - 0.92) - 0.36 * T - 0.101;
    const B = (0.62 - 0.23 * T) * P + (0.066 / (T - 0.86) - 0.037) * P * P + 0.32 * P ** 6 / 10 ** (9 * (T - 1));
    const C = 0.132 - 0.32 * Math.log10(T), D = 10 ** (0.3106 - 0.49 * T + 0.1824 * T * T);
    step('Evaluate Brill–Beggs (explicit)', '',
      [`A = 1.39(T<sub>pr</sub> − 0.92)<sup>0.5</sup> − 0.36T<sub>pr</sub> − 0.101 = ${fmt(A, 5)}`,
       `B = (0.62 − 0.23T<sub>pr</sub>)P<sub>pr</sub> + [0.066/(T<sub>pr</sub> − 0.86) − 0.037]P<sub>pr</sub><sup>2</sup> + 0.32P<sub>pr</sub><sup>6</sup>/10<sup>9(T<sub>pr</sub>−1)</sup> = ${fmt(B, 5)}`,
       `C = 0.132 − 0.32 log T<sub>pr</sub> = ${fmt(C, 5)}`,
       `D = 10<sup>(0.3106 − 0.49T<sub>pr</sub> + 0.1824T<sub>pr</sub>²)</sup> = ${fmt(D, 5)}`,
       `Z = A + (1 − A)/e<sup>B</sup> + C P<sub>pr</sub><sup>D</sup> = ${R(fmt(r.z, 5))}`]);
  } else {
    step('Evaluate Papay (explicit)', '',
      [`Z = 1 − 3.52 P<sub>pr</sub> / 10<sup>0.9813 T<sub>pr</sub></sup> + 0.274 P<sub>pr</sub><sup>2</sup> / 10<sup>0.8157 T<sub>pr</sub></sup>`,
       `Z = 1 − 3.52 × ${fmt(P, 4)} / ${fmt(10 ** (0.9813 * T), 4)} + 0.274 × ${fmt(P * P, 4)} / ${fmt(10 ** (0.8157 * T), 4)} = ${R(fmt(r.z, 5))}`]);
  }

  if (r.mode === 'gas') {
    const g = r.g;
    step('Density and formation volume factor', 'Real-gas law, with standard conditions of 14.696 psia and 60 °F.',
      [`ρ<sub>g</sub> = P M<sub>a</sub> / (Z R T) = ${fmt(S.P, 1)} × ${fmt(g.Ma, 3)} / (${fmt(r.z, 4)} × 10.7316 × ${fmt(r.Tabs, 2)}) = ${R(fmt(g.rho, 4) + ' lb/ft³')}`,
       `B<sub>g</sub> = 0.02827 Z T / P = 0.02827 × ${fmt(r.z, 4)} × ${fmt(r.Tabs, 2)} / ${fmt(S.P, 1)} = ${R(fmt(g.Bg, 6) + ' ft³/scf')}`,
       `E<sub>g</sub> = 1 / B<sub>g</sub> = ${R(fmt(g.Eg, 2) + ' scf/ft³')}`]);
    step('Isothermal gas compressibility', 'The slope of the isotherm is taken numerically from the same Z method.',
      [`(∂Z/∂P<sub>pr</sub>)<sub>T<sub>pr</sub></sub> = ${fmt(g.dZdPpr, 5)}`,
       `c<sub>pr</sub> = 1/P<sub>pr</sub> − (1/Z)(∂Z/∂P<sub>pr</sub>) = ${fmt(1 / r.Ppr, 5)} − ${fmt(g.dZdPpr / r.z, 5)} = ${R(fmt(g.cpr, 5))}`,
       `c<sub>g</sub> = c<sub>pr</sub> / P<sub>pc</sub> = ${fmt(g.cpr, 5)} / ${fmt(r.pc.pc, 2)} = ${R(fmtEtxt(g.cg, 4) + ' psi⁻¹')}`]);
    step('Gas viscosity (Lee–Gonzalez–Eakin)', 'T in °R, ρ<sub>g</sub> in g/cm³.',
      [`K = (9.4 + 0.02M<sub>a</sub>) T<sup>1.5</sup> / (209 + 19M<sub>a</sub> + T) = ${fmt(g.K, 3)}`,
       `X = 3.5 + 986/T + 0.01M<sub>a</sub> = ${fmt(g.X, 4)},  Y = 2.4 − 0.2X = ${fmt(g.Y, 4)}`,
       `μ<sub>g</sub> = 10<sup>−4</sup> K exp(X ρ<sub>g</sub><sup>Y</sup>) = 10<sup>−4</sup> × ${fmt(g.K, 3)} × exp(${fmt(g.X, 4)} × ${fmt(g.rhoGcc, 5)}<sup>${fmt(g.Y, 4)}</sup>) = ${R(fmt(g.mu, 5) + ' cp')}`]);
  }
  $('steps').innerHTML = out.join('');
}

function renderCompare(r) {
  const P = r.Ppr, T = r.Tpr;
  const zD = dak(P, T).z;
  let html = '<thead><tr><th>Method</th><th>Z</th><th>vs DAK</th><th>Quoted range</th><th>Here</th></tr></thead><tbody>';
  for (const k of ['dak', 'hy', 'bb', 'papay']) {
    const m = METHODS[k];
    const z = zBy(k, P, T).z;
    const dev = (z - zD) / zD * 100;
    const ok = m.inRange(P, T) && isFinite(z) && z > 0;
    html += `<tr${k === S.method ? ' class="here"' : ''}><td>${m.name}</td><td>${fmt(z, 4)}</td><td>${k === 'dak' ? '—' : (dev >= 0 ? '+' : '') + fmt(dev, 2) + '%'}</td><td>${m.range}</td>`
      + `<td><span class="chip ${ok ? 'ok' : 'warn'}">${ok ? 'in range' : 'outside'}</span></td></tr>`;
  }
  $('cmp').innerHTML = html + '</tbody>';
}

let csvText = '';
function renderIso(r) {
  const rows = [];
  if (r.mode === 'gas') {
    const si = S.units === 'si';
    $('isoTitle').textContent = `Isotherm at ${fmt(U.tIn(S.T), 1)} ${U.tU()} (${METHODS[S.method].short})`;
    const pmax = Math.max(1000, S.P * 1.6);
    const step = [100, 200, 250, 500, 1000, 2000].find(s => pmax / s <= 18) || 2000;
    const ps = [];
    for (let p = step; p <= pmax + 1e-9; p += step) ps.push(p);
    ps.unshift(14.696);
    if (!ps.some(p => Math.abs(p - S.P) < 1e-6)) ps.push(S.P);
    ps.sort((a, b) => a - b);
    const head = si ? ['P (kPa)', 'Ppr', 'Z', 'Bg (m³/sm³)', 'ρg (kg/m³)', 'cg (1/kPa)', 'μg (mPa·s)']
      : ['P (psia)', 'Ppr', 'Z', 'Bg (ft³/scf)', 'ρg (lb/ft³)', 'cg (1/psi)', 'μg (cp)'];
    const body = ps.map(p => {
      const g = gasProps(p, r.Tabs, S.gamma, r.pc, S.method);
      return { here: Math.abs(p - S.P) < 1e-6, cells: [fmt(U.pIn(p), si ? 0 : 1), fmt(g.Ppr, 3), fmt(g.z, 4), fmt(g.Bg, 6),
        si ? fmt(g.rho * 16.01846, 2) : fmt(g.rho, 3), fmtEtxt(si ? g.cg / PSI_KPA : g.cg, 3), fmt(g.mu, 5)] };
    });
    rows.push(head, ...body.map(b => b.cells));
    $('iso').innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
      + body.map(b => `<tr${b.here ? ' class="here"' : ''}>${b.cells.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody>';
  } else {
    $('isoTitle').textContent = `Isotherm at Tpr ${fmt(S.Tpr, 3)} (${METHODS[S.method].short})`;
    const ps = [];
    for (let p = 0.5; p <= 15 + 1e-9; p += 0.5) ps.push(p);
    if (!ps.some(p => Math.abs(p - S.Ppr) < 1e-9)) ps.push(S.Ppr);
    ps.sort((a, b) => a - b);
    const head = ['Ppr', 'Z', 'cpr'];
    const body = ps.map(p => {
      const z = zBy(S.method, p, S.Tpr).z, h = 1e-4;
      const dz = (zBy(S.method, p + h, S.Tpr).z - zBy(S.method, p - h, S.Tpr).z) / (2 * h);
      return { here: Math.abs(p - S.Ppr) < 1e-9, cells: [fmt(p, 3), fmt(z, 4), fmt(1 / p - dz / z, 4)] };
    });
    rows.push(head, ...body.map(b => b.cells));
    $('iso').innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
      + body.map(b => `<tr${b.here ? ' class="here"' : ''}>${b.cells.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody>';
  }
  csvText = rows.map(r => r.map(c => /[",]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(',')).join('\n');
}

function copyCSV() {
  const done = () => { $('copyMsg').hidden = false; setTimeout(() => { $('copyMsg').hidden = true; }, 1600); };
  const fallback = () => { const ta = $('csvFallback'); ta.hidden = false; ta.value = csvText; ta.focus(); ta.select(); };
  try {
    navigator.clipboard.writeText(csvText).then(done, fallback);
  } catch (e) { fallback(); }
}

// ---------- boot ----------
bind();
new ResizeObserver(resize).observe(plot);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
onChange(false);
resize();
