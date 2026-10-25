// ---- Z-factor correlations (all take Ppr, Tpr; return {z, ...}) ----
const DAK_A = [0, 0.3265, -1.0700, -0.5339, 0.01569, -0.05165, 0.5475, -0.7361, 0.1844, 0.1056, 0.6134, 0.7210];

function dakZofRho(rho, T) {
  const A = DAK_A;
  const r2 = rho * rho;
  const c1 = A[1] + A[2] / T + A[3] / T ** 3 + A[4] / T ** 4 + A[5] / T ** 5;
  const c2 = A[6] + A[7] / T + A[8] / T ** 2;
  const c3 = A[9] * (A[7] / T + A[8] / T ** 2);
  const c4 = A[10] / T ** 3;
  const e = Math.exp(-A[11] * r2);
  const z = 1 + c1 * rho + c2 * r2 - c3 * rho ** 5 + c4 * (1 + A[11] * r2) * r2 * e;
  // dz/drho
  const dz = c1 + 2 * c2 * rho - 5 * c3 * rho ** 4
    + c4 * e * (2 * rho + 4 * A[11] * rho ** 3 - 2 * A[11] * rho * r2 * (1 + A[11] * r2));
  return { z, dz };
}

// Solve DAK: f(rho) = Z(rho) - 0.27 Ppr / (rho Tpr) = 0
function dak(Ppr, Tpr) {
  if (Ppr <= 0) return { z: 1, rho: 0, iters: [], ok: true };
  const k = 0.27 * Ppr / Tpr;
  let rho = k; // Z = 1 guess
  const iters = [];
  let ok = false;
  for (let i = 0; i < 100; i++) {
    const { z, dz } = dakZofRho(rho, Tpr);
    const f = z - k / rho;
    const df = dz + k / (rho * rho);
    let step = f / df;
    let next = rho - step;
    if (!(next > 0) || !isFinite(next)) next = rho / 2;
    iters.push({ i: i + 1, rho: next, z: k / next });
    if (Math.abs(next - rho) < 1e-12 * Math.max(1, rho)) { rho = next; ok = true; break; }
    rho = next;
  }
  return { z: k / rho, rho, iters, ok };
}

function hallYarborough(Ppr, Tpr) {
  if (Ppr <= 0) return { z: 1, ok: true };
  const t = 1 / Tpr;
  const A = 0.06125 * t * Math.exp(-1.2 * (1 - t) ** 2);
  const B = 14.76 * t - 9.76 * t * t + 4.58 * t ** 3;
  const C = 90.7 * t - 242.2 * t * t + 42.4 * t ** 3;
  const D = 2.18 + 2.82 * t;
  let y = 0.0125 * Ppr * t * Math.exp(-1.2 * (1 - t) ** 2);
  let ok = false;
  for (let i = 0; i < 200; i++) {
    const f = -A * Ppr + (y + y * y + y ** 3 - y ** 4) / (1 - y) ** 3 - B * y * y + C * y ** D;
    const df = (1 + 4 * y + 4 * y * y - 4 * y ** 3 + y ** 4) / (1 - y) ** 4 - 2 * B * y + C * D * y ** (D - 1);
    let next = y - f / df;
    if (!(next > 0 && next < 1)) next = (y + (next >= 1 ? 1 : 0)) / 2;
    if (Math.abs(next - y) < 1e-13) { y = next; ok = true; break; }
    y = next;
  }
  return { z: A * Ppr / y, ok };
}

function papay(Ppr, Tpr) {
  return { z: 1 - 3.52 * Ppr / 10 ** (0.9813 * Tpr) + 0.274 * Ppr * Ppr / 10 ** (0.8157 * Tpr), ok: true };
}

function beggsBrill(Ppr, Tpr) {
  const A = 1.39 * Math.sqrt(Tpr - 0.92) - 0.36 * Tpr - 0.101;
  const B = (0.62 - 0.23 * Tpr) * Ppr + (0.066 / (Tpr - 0.86) - 0.037) * Ppr * Ppr + 0.32 * Ppr ** 6 / 10 ** (9 * (Tpr - 1));
  const C = 0.132 - 0.32 * Math.log10(Tpr);
  const D = 10 ** (0.3106 - 0.49 * Tpr + 0.1824 * Tpr * Tpr);
  return { z: A + (1 - A) / Math.exp(B) + C * Ppr ** D, ok: true };
}

if (typeof module !== 'undefined') module.exports = { dak, hallYarborough, papay, beggsBrill };
