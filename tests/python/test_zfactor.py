"""Tests for the reference correlations (python/zfactor.py).

    python3 -m unittest discover -s tests/python -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
import zfactor as zf  # noqa: E402

TPR = (1.05, 1.1, 1.2, 1.3, 1.5, 1.7, 2.0, 2.4, 3.0)


class ZFactorTests(unittest.TestCase):
    def test_ideal_gas_limit(self):
        for t in TPR:
            self.assertAlmostEqual(zf.dranchuk_abou_kassem(1e-4, t), 1.0, places=3)
            self.assertAlmostEqual(zf.hall_yarborough(1e-4, t), 1.0, places=3)

    def test_chart_readings(self):
        # Approximate values read from the published Standing-Katz chart.
        for ppr, tpr, z in [(2.0, 1.5, 0.82), (3.0, 1.6, 0.83)]:
            self.assertAlmostEqual(zf.dranchuk_abou_kassem(ppr, tpr), z, delta=0.02, msg=f"Ppr={ppr}, Tpr={tpr}")

    def test_dak_and_hall_yarborough_agree_away_from_the_critical_point(self):
        for t in (1.3, 1.5, 1.7, 2.0, 2.4, 3.0):
            for i in range(2, 151):
                p = i / 10
                d, h = zf.dranchuk_abou_kassem(p, t), zf.hall_yarborough(p, t)
                self.assertLess(abs(h - d) / d, 0.01, f"Ppr={p}, Tpr={t}")

    def test_isotherms_are_continuous(self):
        for t in TPR:
            prev = None
            for i in range(1, 1501):
                z = zf.dranchuk_abou_kassem(i / 100, t)
                if prev is not None:
                    self.assertLess(abs(z - prev), 0.02, f"jump at Ppr={i / 100}, Tpr={t}")
                prev = z

    def test_isotherms_are_ordered_at_moderate_pressure(self):
        zs = [zf.dranchuk_abou_kassem(2.0, t) for t in TPR]
        self.assertEqual(zs, sorted(zs), "at Ppr = 2, Z rises with Tpr")

    def test_low_tpr_minimum(self):
        zmin = min(zf.dranchuk_abou_kassem(i / 100, 1.05) for i in range(50, 400))
        self.assertTrue(0.24 < zmin < 0.32, zmin)


class PseudoCriticalTests(unittest.TestCase):
    def test_sweet_gas_has_no_correction(self):
        pc = zf.pseudo_critical(0.65, 0, 0, 0, "sutton")
        self.assertEqual(pc.eps, 0)
        self.assertAlmostEqual(pc.tc, 169.2 + 349.5 * 0.65 - 74.0 * 0.65 ** 2)
        self.assertAlmostEqual(pc.pc, 756.8 - 131.07 * 0.65 - 3.6 * 0.65 ** 2)

    def test_sour_gas_lowers_pseudo_critical_temperature(self):
        pc = zf.pseudo_critical(0.7, 0.05, 0.10, 0.0, "sutton")
        self.assertGreater(pc.eps, 0)
        sweet = zf.pseudo_critical(0.7, 0.0, 0.0, 0.0, "sutton")
        self.assertNotAlmostEqual(pc.tc, sweet.tc)


class GasPropertyTests(unittest.TestCase):
    def test_low_pressure_density_is_ideal(self):
        pc = zf.pseudo_critical(0.65, 0, 0, 0)
        g = zf.gas_properties(14.696, 519.67, 0.65, pc)
        ideal = 14.696 * 28.9647 * 0.65 / (zf.R_FIELD * 519.67)
        self.assertAlmostEqual(g["rho"] / ideal, g["z"] ** -1, places=6)
        self.assertAlmostEqual(g["Bg"], 0.028269 * g["z"] * 519.67 / 14.696, places=9)

    def test_compressibility_is_close_to_one_over_p_for_ideal_gas(self):
        pc = zf.pseudo_critical(0.6, 0, 0, 0)
        g = zf.gas_properties(20.0, 600.0, 0.6, pc)
        self.assertAlmostEqual(g["cg"] * 20.0, 1.0, delta=0.01)

    def test_viscosity_is_in_the_usual_range(self):
        pc = zf.pseudo_critical(0.65, 0, 0, 0)
        g = zf.gas_properties(3000.0, 640.0, 0.65, pc)
        self.assertTrue(0.012 < g["mu"] < 0.03, g["mu"])


class ReferenceTableTests(unittest.TestCase):
    def test_committed_reference_table_is_current(self):
        import json
        current = json.loads(zf.REFERENCE.read_text(encoding="utf-8"))
        self.assertEqual(current, json.loads(json.dumps(zf.reference_table())),
                         "run python3 python/zfactor.py --write-reference")


if __name__ == "__main__":
    unittest.main()
