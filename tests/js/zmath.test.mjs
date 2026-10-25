// The browser code (js/zmath.js, js/zgas.js) must give the same numbers as the independent
// Python reference implementation (python/zfactor.py -> tests/reference_values.json).
//   node --test tests/js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');
// Load the two browser scripts into one sandbox, exactly as the page does with <script> tags.
const sandbox = { Math, Number, isFinite, Object };
vm.createContext(sandbox);
vm.runInContext(read('js/zmath.js') + '\n' + read('js/zgas.js') +
  '\n;globalThis.__api = { dak, hallYarborough, papay, beggsBrill, pseudoCritical, gasProps };', sandbox);
const api = sandbox.__api;
const ref = JSON.parse(read('tests/reference_values.json'));
const fns = { dak: api.dak, hy: api.hallYarborough, papay: api.papay, bb: api.beggsBrill };

test('Z-factor correlations match the Python reference', () => {
  for (const row of ref.z) {
    for (const [k, fn] of Object.entries(fns)) {
      if (!(k in row)) continue;
      const z = fn(row.Ppr, row.Tpr).z;
      assert.ok(Math.abs(z - row[k]) < 1e-7, `${k} at Ppr=${row.Ppr}, Tpr=${row.Tpr}: ${z} vs ${row[k]}`);
    }
  }
});

test('pseudo-critical and gas properties match the Python reference', () => {
  for (const g of ref.gases) {
    const i = g.input;
    const pc = api.pseudoCritical(i.gamma, { CO2: i.CO2, H2S: i.H2S, N2: i.N2 }, i.corr);
    assert.ok(Math.abs(pc.tc - g.tc) < 1e-6, `Tpc ${pc.tc} vs ${g.tc}`);
    assert.ok(Math.abs(pc.pc - g.pc) < 1e-6, `Ppc ${pc.pc} vs ${g.pc}`);
    const p = api.gasProps(i.P, i.T + 459.67, i.gamma, pc, 'dak');
    for (const k of ['Ppr', 'Tpr', 'z', 'rho', 'Bg', 'mu']) {
      assert.ok(Math.abs(p[k] - g[k]) <= 1e-7 * Math.max(1, Math.abs(g[k])), `${k}: ${p[k]} vs ${g[k]}`);
    }
    assert.ok(Math.abs(p.cg - g.cg) / g.cg < 1e-5, `cg: ${p.cg} vs ${g.cg}`);
  }
});

test('DAK converges everywhere on the printed chart', () => {
  for (const t of [1.05, 1.1, 1.15, 1.2, 1.3, 1.5, 2, 3]) {
    for (let p = 0.05; p <= 15; p += 0.05) assert.ok(api.dak(p, t).ok, `no convergence at Ppr=${p}, Tpr=${t}`);
  }
});
