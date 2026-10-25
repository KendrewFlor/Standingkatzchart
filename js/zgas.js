// ---- Pseudo-critical properties and gas properties (field units internally: psia, °R) ----
const AIR_MW = 28.9647;
const R_FIELD = 10.7316; // psia·ft³/(lb-mol·°R)
const NONHC = {
  N2: { mw: 28.0134, tc: 227.16, pc: 493.1 },
  CO2: { mw: 44.0100, tc: 547.58, pc: 1071.0 },
  H2S: { mw: 34.0800, tc: 672.12, pc: 1306.0 },
};
const PC_CORR = {
  sutton: { name: 'Sutton (1985)', tc: g => 169.2 + 349.5 * g - 74.0 * g * g, pc: g => 756.8 - 131.07 * g - 3.6 * g * g,
    tcTxt: 'T<sub>pc</sub> = 169.2 + 349.5 γ − 74.0 γ²', pcTxt: 'P<sub>pc</sub> = 756.8 − 131.07 γ − 3.6 γ²' },
  standingNG: { name: 'Standing (1977), natural gas', tc: g => 168 + 325 * g - 12.5 * g * g, pc: g => 677 + 15 * g - 37.5 * g * g,
    tcTxt: 'T<sub>pc</sub> = 168 + 325 γ − 12.5 γ²', pcTxt: 'P<sub>pc</sub> = 677 + 15 γ − 37.5 γ²' },
  standingCond: { name: 'Standing (1977), gas condensate', tc: g => 187 + 330 * g - 71.5 * g * g, pc: g => 706 - 51.7 * g - 11.1 * g * g,
    tcTxt: 'T<sub>pc</sub> = 187 + 330 γ − 71.5 γ²', pcTxt: 'P<sub>pc</sub> = 706 − 51.7 γ − 11.1 γ²' },
};

// gamma: overall gas gravity (air = 1); y: mole fractions {N2, CO2, H2S}
function pseudoCritical(gamma, y, corrKey) {
  const corr = PC_CORR[corrKey];
  const yN = y.N2, yC = y.CO2, yH = y.H2S;
  const yNon = yN + yC + yH;
  const steps = {};
  const Ma = AIR_MW * gamma;
  // Hydrocarbon fraction gravity (Standing's method for non-hydrocarbons)
  const nonMass = (yN * NONHC.N2.mw + yC * NONHC.CO2.mw + yH * NONHC.H2S.mw);
  const gHC = yNon > 0 ? (gamma - nonMass / AIR_MW) / (1 - yNon) : gamma;
  const tcHC = corr.tc(gHC), pcHC = corr.pc(gHC);
  // Kay's mixing rule
  const tcMix = (1 - yNon) * tcHC + yN * NONHC.N2.tc + yC * NONHC.CO2.tc + yH * NONHC.H2S.tc;
  const pcMix = (1 - yNon) * pcHC + yN * NONHC.N2.pc + yC * NONHC.CO2.pc + yH * NONHC.H2S.pc;
  // Wichert–Aziz sour-gas correction
  const A = yC + yH, B = yH;
  const eps = 120 * (A ** 0.9 - A ** 1.6) + 15 * (Math.sqrt(B) - B ** 4);
  const tc = tcMix - eps;
  const pc = pcMix * tc / (tcMix + B * (1 - B) * eps);
  Object.assign(steps, { Ma, nonMass, gHC, tcHC, pcHC, tcMix, pcMix, A, B, eps, yNon });
  return { tc, pc, steps, corr };
}

function zBy(method, Ppr, Tpr) {
  switch (method) {
    case 'hy': return hallYarborough(Ppr, Tpr);
    case 'papay': return papay(Ppr, Tpr);
    case 'bb': return beggsBrill(Ppr, Tpr);
    default: return dak(Ppr, Tpr);
  }
}

// Gas properties at P (psia), T (°R)
function gasProps(P, T, gamma, pcInfo, method) {
  const Ppr = P / pcInfo.pc, Tpr = T / pcInfo.tc;
  const zr = zBy(method, Ppr, Tpr);
  const z = zr.z;
  const Ma = AIR_MW * gamma;
  const rho = P * Ma / (z * R_FIELD * T);           // lb/ft³
  const Bg = 0.028269 * z * T / P;                   // ft³/scf (14.696 psia, 60 °F)
  const h = Math.max(1e-4, Ppr * 1e-4);
  const zp = zBy(method, Ppr + h, Tpr).z, zm = zBy(method, Math.max(1e-6, Ppr - h), Tpr).z;
  const dZdPpr = (zp - zm) / (Ppr + h - Math.max(1e-6, Ppr - h));
  const cpr = 1 / Ppr - dZdPpr / z;
  const cg = cpr / pcInfo.pc;                        // 1/psi
  // Lee–Gonzalez–Eakin viscosity
  const K = (9.4 + 0.02 * Ma) * T ** 1.5 / (209 + 19 * Ma + T);
  const X = 3.5 + 986 / T + 0.01 * Ma;
  const Y = 2.4 - 0.2 * X;
  const rhoGcc = rho / 62.428;
  const mu = 1e-4 * K * Math.exp(X * rhoGcc ** Y); // cp
  return { Ppr, Tpr, z, zr, Ma, rho, Bg, Eg: 1 / Bg, cg, cpr, dZdPpr, mu, K, X, Y, rhoGcc };
}

if (typeof module !== 'undefined') module.exports = { pseudoCritical, gasProps, zBy, PC_CORR };
