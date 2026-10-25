"""Reference implementation of the Z-factor and gas-property correlations used by the web page.

The browser version lives in js/zmath.js and js/zgas.js. This module is an independent
Python implementation of the same published equations. It is used to:

  * check the equations against values read from the Standing-Katz chart (tests/python), and
  * produce tests/reference_values.json, which the JavaScript tests (tests/js) must match,
    so the two implementations can't drift apart.

    python3 python/zfactor.py --write-reference   # regenerate the reference table
    python3 python/zfactor.py --check             # CI: the committed table is current
    python3 python/zfactor.py 2.0 1.5             # Z at Ppr = 2.0, Tpr = 1.5 (all methods)

Standard library only. Field units: psia, degrees Rankine.
"""
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "tests" / "reference_values.json"

AIR_MW = 28.9647
R_FIELD = 10.7316  # psia ft3 / (lb-mol degR)
NONHC = {
    "N2": (28.0134, 227.16, 493.1),   # molecular weight, Tc (degR), Pc (psia)
    "CO2": (44.0100, 547.58, 1071.0),
    "H2S": (34.0800, 672.12, 1306.0),
}

# ---------------------------------------------------------------------------- Z-factor

DAK = (0.3265, -1.0700, -0.5339, 0.01569, -0.05165, 0.5475, -0.7361, 0.1844, 0.1056, 0.6134, 0.7210)


def _dak_z_of_rho(rho: float, t: float) -> tuple[float, float]:
    a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11 = DAK
    r2 = rho * rho
    c1 = a1 + a2 / t + a3 / t ** 3 + a4 / t ** 4 + a5 / t ** 5
    c2 = a6 + a7 / t + a8 / t ** 2
    c3 = a9 * (a7 / t + a8 / t ** 2)
    c4 = a10 / t ** 3
    e = math.exp(-a11 * r2)
    z = 1 + c1 * rho + c2 * r2 - c3 * rho ** 5 + c4 * (1 + a11 * r2) * r2 * e
    dz = (c1 + 2 * c2 * rho - 5 * c3 * rho ** 4
          + c4 * e * (2 * rho + 4 * a11 * rho ** 3 - 2 * a11 * rho * r2 * (1 + a11 * r2)))
    return z, dz


def dranchuk_abou_kassem(ppr: float, tpr: float) -> float:
    """Dranchuk & Abou-Kassem (1975), solved for reduced density by Newton's method."""
    if ppr <= 0:
        return 1.0
    k = 0.27 * ppr / tpr
    rho = k
    for _ in range(100):
        z, dz = _dak_z_of_rho(rho, tpr)
        f = z - k / rho
        df = dz + k / (rho * rho)
        nxt = rho - f / df
        if not (nxt > 0) or not math.isfinite(nxt):
            nxt = rho / 2
        if abs(nxt - rho) < 1e-12 * max(1.0, rho):
            rho = nxt
            break
        rho = nxt
    return k / rho


def hall_yarborough(ppr: float, tpr: float) -> float:
    """Hall & Yarborough (1973)."""
    if ppr <= 0:
        return 1.0
    t = 1 / tpr
    a = 0.06125 * t * math.exp(-1.2 * (1 - t) ** 2)
    b = 14.76 * t - 9.76 * t * t + 4.58 * t ** 3
    c = 90.7 * t - 242.2 * t * t + 42.4 * t ** 3
    d = 2.18 + 2.82 * t
    y = 0.0125 * ppr * t * math.exp(-1.2 * (1 - t) ** 2)
    for _ in range(200):
        f = -a * ppr + (y + y * y + y ** 3 - y ** 4) / (1 - y) ** 3 - b * y * y + c * y ** d
        df = (1 + 4 * y + 4 * y * y - 4 * y ** 3 + y ** 4) / (1 - y) ** 4 - 2 * b * y + c * d * y ** (d - 1)
        nxt = y - f / df
        if not (0 < nxt < 1):
            nxt = (y + (1 if nxt >= 1 else 0)) / 2
        if abs(nxt - y) < 1e-13:
            y = nxt
            break
        y = nxt
    return a * ppr / y


def papay(ppr: float, tpr: float) -> float:
    """Papay (1968), explicit."""
    return 1 - 3.52 * ppr / 10 ** (0.9813 * tpr) + 0.274 * ppr * ppr / 10 ** (0.8157 * tpr)


def brill_beggs(ppr: float, tpr: float) -> float:
    """Brill & Beggs (1974), explicit."""
    a = 1.39 * math.sqrt(tpr - 0.92) - 0.36 * tpr - 0.101
    b = ((0.62 - 0.23 * tpr) * ppr + (0.066 / (tpr - 0.86) - 0.037) * ppr * ppr
         + 0.32 * ppr ** 6 / 10 ** (9 * (tpr - 1)))
    c = 0.132 - 0.32 * math.log10(tpr)
    d = 10 ** (0.3106 - 0.49 * tpr + 0.1824 * tpr * tpr)
    decay = 0.0 if b > 700 else (1 - a) / math.exp(b)  # JS: exp() overflows to Infinity, term -> 0
    return a + decay + c * ppr ** d


METHODS = {"dak": dranchuk_abou_kassem, "hy": hall_yarborough, "bb": brill_beggs, "papay": papay}

# ---------------------------------------------------------------------------- pseudo-critical properties

PC_CORR = {
    "sutton": (lambda g: 169.2 + 349.5 * g - 74.0 * g * g, lambda g: 756.8 - 131.07 * g - 3.6 * g * g),
    "standingNG": (lambda g: 168 + 325 * g - 12.5 * g * g, lambda g: 677 + 15 * g - 37.5 * g * g),
    "standingCond": (lambda g: 187 + 330 * g - 71.5 * g * g, lambda g: 706 - 51.7 * g - 11.1 * g * g),
}


@dataclass
class PseudoCritical:
    tc: float   # degR
    pc: float   # psia
    eps: float  # Wichert-Aziz correction, degR


def pseudo_critical(gamma: float, y_co2: float, y_h2s: float, y_n2: float, corr: str = "sutton") -> PseudoCritical:
    """Gravity correlation on the hydrocarbon fraction, Kay's rule for N2/CO2/H2S, then Wichert-Aziz."""
    tc_f, pc_f = PC_CORR[corr]
    y_non = y_co2 + y_h2s + y_n2
    non_mass = y_n2 * NONHC["N2"][0] + y_co2 * NONHC["CO2"][0] + y_h2s * NONHC["H2S"][0]
    g_hc = (gamma - non_mass / AIR_MW) / (1 - y_non) if y_non > 0 else gamma
    tc_mix = (1 - y_non) * tc_f(g_hc) + y_n2 * NONHC["N2"][1] + y_co2 * NONHC["CO2"][1] + y_h2s * NONHC["H2S"][1]
    pc_mix = (1 - y_non) * pc_f(g_hc) + y_n2 * NONHC["N2"][2] + y_co2 * NONHC["CO2"][2] + y_h2s * NONHC["H2S"][2]
    a, b = y_co2 + y_h2s, y_h2s
    eps = 120 * (a ** 0.9 - a ** 1.6) + 15 * (math.sqrt(b) - b ** 4)
    tc = tc_mix - eps
    pc = pc_mix * tc / (tc_mix + b * (1 - b) * eps)
    return PseudoCritical(tc, pc, eps)


# ---------------------------------------------------------------------------- gas properties

def gas_properties(p: float, t_rankine: float, gamma: float, pc: PseudoCritical, method: str = "dak") -> dict:
    zf = METHODS[method]
    ppr, tpr = p / pc.pc, t_rankine / pc.tc
    z = zf(ppr, tpr)
    ma = AIR_MW * gamma
    rho = p * ma / (z * R_FIELD * t_rankine)
    bg = 0.028269 * z * t_rankine / p
    h = max(1e-4, ppr * 1e-4)
    lo = max(1e-6, ppr - h)
    dz = (zf(ppr + h, tpr) - zf(lo, tpr)) / (ppr + h - lo)
    cpr = 1 / ppr - dz / z
    k = (9.4 + 0.02 * ma) * t_rankine ** 1.5 / (209 + 19 * ma + t_rankine)
    x = 3.5 + 986 / t_rankine + 0.01 * ma
    yv = 2.4 - 0.2 * x
    mu = 1e-4 * k * math.exp(x * (rho / 62.428) ** yv)
    return {"Ppr": ppr, "Tpr": tpr, "z": z, "rho": rho, "Bg": bg, "cg": cpr / pc.pc, "mu": mu}


# ---------------------------------------------------------------------------- reference table for the JS tests

REF_POINTS = [(p, t) for t in (1.05, 1.1, 1.2, 1.3, 1.5, 1.7, 2.0, 2.4, 3.0) for p in (0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 12.0, 15.0)]
REF_GASES = [
    # gamma, CO2, H2S, N2, corr, P (psia), T (degF)
    (0.65, 0.0, 0.0, 0.0, "sutton", 3000.0, 180.0),
    (0.70, 0.05, 0.10, 0.0, "sutton", 2000.0, 150.0),
    (0.80, 0.02, 0.0, 0.05, "standingNG", 5000.0, 220.0),
    (1.10, 0.0, 0.0, 0.0, "standingCond", 7000.0, 260.0),
]


def reference_table() -> dict:
    z = [{"Ppr": p, "Tpr": t, **{m: round(f(p, t), 10) for m, f in METHODS.items() if not (m == "bb" and t > 2.4)}}
         for p, t in REF_POINTS]
    gases = []
    for g, co2, h2s, n2, corr, p, tf in REF_GASES:
        pc = pseudo_critical(g, co2, h2s, n2, corr)
        props = gas_properties(p, tf + 459.67, g, pc)
        gases.append({"input": {"gamma": g, "CO2": co2, "H2S": h2s, "N2": n2, "corr": corr, "P": p, "T": tf},
                      "tc": round(pc.tc, 8), "pc": round(pc.pc, 8), **{k: round(v, 10) for k, v in props.items()}})
    return {"z": z, "gases": gases}


def main(argv: list[str]) -> int:
    if argv[:1] == ["--write-reference"]:
        REFERENCE.write_text(json.dumps(reference_table(), indent=1) + "\n", encoding="utf-8")
        print("wrote", REFERENCE.relative_to(ROOT))
        return 0
    if argv[:1] == ["--check"]:
        current = json.loads(REFERENCE.read_text(encoding="utf-8"))
        if current != json.loads(json.dumps(reference_table())):
            print("tests/reference_values.json is out of date: run python3 python/zfactor.py --write-reference", file=sys.stderr)
            return 1
        print("reference table is current")
        return 0
    if len(argv) == 2:
        ppr, tpr = float(argv[0]), float(argv[1])
        for name, f in METHODS.items():
            print(f"{name:6s} Z = {f(ppr, tpr):.5f}")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
