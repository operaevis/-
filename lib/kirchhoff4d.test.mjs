import test from "node:test";
import assert from "node:assert/strict";
import {
  SURVIVAL_GRADES,
  computeMaintEscrow,
  classifySurvivalGrade,
  computeThermalIntensity,
  computeAscensionAura,
  computeTroop4DMatrix,
  manifoldFloorOpvs,
  projectKirchhoff4D
} from "./kirchhoff4d.mjs";

test("6 survival performance grades follow OLED Industrial palette order", () => {
  assert.equal(SURVIVAL_GRADES.length, 6);
  assert.deepEqual(
    SURVIVAL_GRADES.map((g) => [g.key, g.color]),
    [
      ["S", "#00E5FF"],
      ["A", "#00E676"],
      ["B", "#FFAB00"],
      ["C", "#B366FF"],
      ["D", "#FF3B30"],
      ["F", "#6E6E73"]
    ]
  );
  assert.equal(SURVIVAL_GRADES[5].bg, "#050505");
});

test("classifySurvivalGrade maps operational & thermal states into S, A, B, C, D, F", () => {
  assert.equal(classifySurvivalGrade({ ds: 58_420_000, dm: 4_610_000, liq: 500_000_000, temp: 51, torque: 1420 }).key, "S");
  assert.equal(classifySurvivalGrade({ ds: 22_000_000, dm: 1_940_000, liq: 400_000_000, temp: 58, torque: 2040 }).key, "A");
  assert.equal(classifySurvivalGrade({ ds: 11_200_000, dm: 820_000, liq: 451_200_000, temp: 63, torque: 2480 }).key, "B");
  assert.equal(classifySurvivalGrade({ ds: 35_000_000, dm: 2_500_000, liq: 400_000_000, temp: 78, torque: 3800 }).key, "C");
  assert.equal(classifySurvivalGrade({ ds: -1_270_000, dm: -2_450_000, liq: 2_140_000, temp: 84, torque: 4380 }).key, "D");
  assert.equal(classifySurvivalGrade({ ds: -500_000, dm: -1_000_000, liq: 0, temp: 88, torque: 4800 }).key, "F");
});

test("computeThermalIntensity ramps temperature 40..88°C monotonically", () => {
  const cool = computeThermalIntensity(40);
  const mid = computeThermalIntensity(64);
  const hot = computeThermalIntensity(88);
  assert.equal(cool.pct, 0);
  assert.equal(mid.pct, 50);
  assert.equal(hot.pct, 100);
  assert.ok(hot.rgb[0] > cool.rgb[0]);
});

test("computeAscensionAura scales cyan-white luminescence proportionally with d_S and collapses on breach", () => {
  const low = computeAscensionAura([{ cycle: 1, ds: 10_000_000, dm: 500_000 }]);
  const high = computeAscensionAura([{ cycle: 1, ds: 58_420_000, dm: 4_610_000 }]);
  const breach = computeAscensionAura([{ cycle: 1, ds: 20_000_000, dm: 1_000_000 }], { cycle: 2, ds: -1_270_000, dm: -2_450_000 });

  assert.ok(high.lumPct > low.lumPct);
  assert.ok(high.bloomAlpha > low.bloomAlpha);
  assert.equal(high.peakDsOpvs, 58.42);
  assert.equal(breach.isBreach, true);
  assert.equal(breach.lumPct, 0);
  assert.equal(breach.peakDsOpvs, 20);
});

test("computeMaintEscrow & manifoldFloorOpvs rise sharply under quadratic torque and thermal stress", () => {
  const nom = computeMaintEscrow(1825, 54);
  const hot = computeMaintEscrow(4200, 82);
  assert.ok(hot > nom * 4);
  assert.ok(manifoldFloorOpvs(4400, 4200, 82) > manifoldFloorOpvs(3271, 1825, 54));
});

test("projectKirchhoff4D returns valid screen coordinates inside camera frustum", () => {
  const p = projectKirchhoff4D(
    { wh: 3271, dsOpvs: 42.18, torque: 1825 },
    { width: 800, height: 360, yaw: -0.58, pitch: 0.36, zoom: 1.0 }
  );
  assert.ok(p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.z > 0.25);
});

test("computeTroop4DMatrix positions 20 Terracotta warriors across the 4D matrix and recolors with parameters", () => {
  const sampleFleet = Array.from({ length: 10 }, (_, i) => ({
    id: `wlt_atlas_${String(i + 1).padStart(2, "0")}`,
    policy: i < 5 ? "gemini-robotics-v2.4-margin" : "gemini-robotics-v2.1-base",
    liq: 450_000_000,
    swap: 3_271_000,
    dm: 4_310_000,
    ds: 42_000_000 - i * 2_000_000,
    torque: 1825,
    temp: 54,
    zombie: false
  }));

  const nominal = computeTroop4DMatrix(sampleFleet, "wlt_atlas_04", { wage: 8581000, wh: 3271, temp: 54, torque: 1825 });
  assert.equal(nominal.warriors.length, 20);
  assert.equal(Object.values(nominal.gradeCounts).reduce((a, b) => a + b, 0), 20);
  const cmdNom = nominal.warriors.find((w) => w.isSelected);
  assert.equal(cmdNom.grade.key, "S");

  const surge = computeTroop4DMatrix(sampleFleet, "wlt_atlas_04", { wage: 8100000, wh: 4200, temp: 81, torque: 4100 });
  assert.equal(Object.values(surge.gradeCounts).reduce((a, b) => a + b, 0), 20);
  const cmdSurge = surge.warriors.find((w) => w.isSelected);
  assert.equal(cmdSurge.grade.key, "C");
  assert.ok(cmdSurge.rawWh > cmdNom.rawWh);
  assert.ok(cmdSurge.rawTorque > cmdNom.rawTorque);
  assert.notEqual(cmdSurge.grade.color, cmdNom.grade.color);
});
