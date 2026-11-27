/**
 * OPVS Kirchhoff 4D Terracotta Matrix Pure Math, Troop Formation & Grading Engine
 *
 * 4D Matrix Axes:
 *  - X: Swap Energy ΔWh (2,200 – 4,600 Wh, matrix column)
 *  - Y: Net Survival Altitude d_S (OPVS = µOPVS / 1,000,000, pedestal elevation)
 *  - Z: Joint Torque² Fatigue Integral (800 – 4,800, matrix rank depth)
 *  - W (4th dim): Survival Performance Grade (6 OLED colors) & Thermal Stress (°C)
 */

export const MICRO_PER_OPVS = 1_000_000;

export const SURVIVAL_GRADES = [
  {
    key: "S",
    code: "S",
    color: "#00E5FF",
    bg: "rgba(0, 229, 255, 0.14)",
    border: "#00E5FF",
    en: "S · Ascension Peak",
    fr: "S · Pic d'Ascension",
    thresholdEn: "d_S ≥ +30 OPVS · ΔM ≥ +2",
    thresholdFr: "d_S ≥ +30 OPVS · ΔM ≥ +2"
  },
  {
    key: "A",
    code: "A",
    color: "#00E676",
    bg: "rgba(0, 230, 118, 0.14)",
    border: "#00E676",
    en: "A · Nominal Survivor",
    fr: "A · Survivant Nominal",
    thresholdEn: "d_S > +15 OPVS · ΔM ≥ 0",
    thresholdFr: "d_S > +15 OPVS · ΔM ≥ 0"
  },
  {
    key: "B",
    code: "B",
    color: "#FFAB00",
    bg: "rgba(255, 171, 0, 0.14)",
    border: "#FFAB00",
    en: "B · Stasis / Marginal",
    fr: "B · Stase / Marginal",
    thresholdEn: "10 ≤ d_S ≤ 15 OPVS",
    thresholdFr: "10 ≤ d_S ≤ 15 OPVS"
  },
  {
    key: "C",
    code: "C",
    color: "#B366FF",
    bg: "rgba(179, 102, 255, 0.16)",
    border: "#B366FF",
    en: "C · Thermal Drift",
    fr: "C · Dérive Thermique",
    thresholdEn: "0 < d_S < 10 | T ≥ 74°C | τ² > 3200",
    thresholdFr: "0 < d_S < 10 | T ≥ 74°C | τ² > 3200"
  },
  {
    key: "D",
    code: "D",
    color: "#FF3B30",
    bg: "rgba(255, 59, 48, 0.16)",
    border: "#FF3B30",
    en: "D · Plane Breach",
    fr: "D · Rupture Plan",
    thresholdEn: "d_S ≤ 0 (Overdraft)",
    thresholdFr: "d_S ≤ 0 (Découvert)"
  },
  {
    key: "F",
    code: "F",
    color: "#6E6E73",
    bg: "#050505",
    border: "#3A3A3D",
    en: "F · Void Halt",
    fr: "F · Arrêt Critique",
    thresholdEn: "Y = 0 & d_S ≤ 0 (Halted)",
    thresholdFr: "Y = 0 & d_S ≤ 0 (Gelé)"
  }
];

export const GRADE_BY_KEY = Object.fromEntries(SURVIVAL_GRADES.map((g) => [g.key, g]));

export function computeMaintEscrow(torqueSq, tempC) {
  const tq = Number(torqueSq) || 1825;
  const temp = Number(tempC) || 54;
  const base = 450_000;
  const torqueTerm = Math.round(tq * 220);
  const thermalOver = Math.max(0, temp - 52);
  const thermalWall = Math.round(Math.pow(1.14, thermalOver) * 140_000 - 140_000);
  return base + torqueTerm + thermalWall;
}

export function classifySurvivalGrade({ ds, dm = 0, liq = 1, temp = 54, torque = 1825, zombie = false, mode = "NOMINAL" }) {
  if (mode === "VOID_HALT" || (liq <= 0 && ds <= 0)) {
    return GRADE_BY_KEY.F;
  }
  if (ds <= 0 || mode === "SOFT_BANKRUPTCY") {
    return GRADE_BY_KEY.D;
  }
  if (zombie || ds < 10_000_000 || temp >= 74 || torque > 3200) {
    return GRADE_BY_KEY.C;
  }
  if (ds >= 30_000_000 && dm >= 2_000_000 && temp < 68 && torque <= 2400) {
    return GRADE_BY_KEY.S;
  }
  if (ds > 15_000_000 && dm >= 0 && temp < 72 && torque <= 2800) {
    return GRADE_BY_KEY.A;
  }
  return GRADE_BY_KEY.B;
}

export function computeThermalIntensity(tempC) {
  const t = Math.max(40, Math.min(88, Number(tempC) || 54));
  const norm = (t - 40) / 48; // 0.0 -> 1.0
  const pct = Math.round(norm * 100);

  const stops = [
    { at: 0.0, rgb: [0, 200, 230] },
    { at: 0.30, rgb: [0, 230, 118] },
    { at: 0.56, rgb: [255, 171, 0] },
    { at: 0.78, rgb: [179, 102, 255] },
    { at: 1.0, rgb: [255, 59, 48] }
  ];

  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (norm >= stops[i].at && norm <= stops[i + 1].at) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = Math.max(1e-6, hi.at - lo.at);
  const f = (norm - lo.at) / span;
  const r = Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f);
  const g = Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f);
  const b = Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f);

  return {
    tempC: t,
    norm,
    pct,
    rgb: [r, g, b],
    css: `rgb(${r}, ${g}, ${b})`,
    glowCss: `rgba(${r}, ${g}, ${b}, ${(0.35 + norm * 0.55).toFixed(2)})`
  };
}

export function computeAscensionAura(historyPoints, previewPoint = null) {
  const list = Array.isArray(historyPoints) ? historyPoints : [];
  const all = previewPoint ? [...list, previewPoint] : [...list];
  if (all.length === 0) {
    return {
      peakPoint: null,
      livePoint: null,
      peakDsOpvs: 0,
      liveDsOpvs: 0,
      lumPct: 0,
      bloomAlpha: 0,
      radiusScale: 0,
      isAscending: false,
      isBreach: true
    };
  }

  let peakPoint = all[0];
  for (let i = 1; i < all.length; i += 1) {
    if (all[i].ds > peakPoint.ds) peakPoint = all[i];
  }
  const livePoint = all[all.length - 1];
  const peakDsOpvs = peakPoint.ds / MICRO_PER_OPVS;
  const liveDsOpvs = livePoint.ds / MICRO_PER_OPVS;
  const isBreach = liveDsOpvs <= 0;

  if (isBreach) {
    return {
      peakPoint,
      livePoint,
      peakDsOpvs,
      liveDsOpvs,
      lumPct: 0,
      bloomAlpha: 0,
      radiusScale: 0,
      isAscending: false,
      isBreach: true
    };
  }

  const altitudeRatio = Math.max(0, Math.min(1, liveDsOpvs / 60));
  const climbBonus = (livePoint.dm || 0) > 0 ? Math.min(0.1, ((livePoint.dm || 0) / MICRO_PER_OPVS) * 0.02) : 0;
  const intensity = Math.max(0.06, Math.min(1, altitudeRatio * 0.92 + climbBonus));

  return {
    peakPoint,
    livePoint,
    peakDsOpvs,
    liveDsOpvs,
    lumPct: Math.round(intensity * 100),
    bloomAlpha: Number((0.22 + intensity * 0.72).toFixed(3)),
    radiusScale: Number((0.35 + intensity * 0.85).toFixed(3)),
    isAscending: (livePoint.dm || 0) > 0 && liveDsOpvs > 15,
    isBreach: false
  };
}

/**
 * Computes the Terracotta Phalanx 4D Matrix positions & grades for the full troop.
 * Returns 20 warriors arranged in Xi'an Pit formation (10 Atlas commanders + 10 flank escorts),
 * positioning each robot on the 4D Matrix (X=ΔWh, Y=d_S altitude, Z=τ² rank, W=Grade/Thermal color)
 * with live parameter responsiveness.
 */
export function computeTroop4DMatrix(fleet, selectedId, sliderInputs = {}) {
  const list = Array.isArray(fleet) ? fleet : [];
  const wage = Number(sliderInputs.wage) || 8581000;
  const wh = Number(sliderInputs.wh) || 3271;
  const temp = Number(sliderInputs.temp) || 54;
  const torque = Number(sliderInputs.torque) || 1825;

  const sliderMaint = computeMaintEscrow(torque, temp);
  const sliderDm = wage - wh * 1000 - sliderMaint;
  const dWh = wh - 3271;
  const dTemp = temp - 54;
  const dTorque = torque - 1825;

  const warriors = [];
  const gradeCounts = { S: 0, A: 0, B: 0, C: 0, D: 0, F: 0 };

  list.forEach((u, idx) => {
    const isSelected = u.id === selectedId;
    const baseWh = Math.round((u.swap || 3271000) / 1000);
    const baseTq = Number(u.torque) || 1825;
    const baseTemp = Number(u.temp) || 54;

    // Selected commander takes exact slider parameters; troop cohort feels a weighted parameter wave
    // so adjusting sliders moves and recolors the formation cohesively on the 4D matrix.
    const coupling = isSelected ? 1.0 : (u.policy?.includes("v2.4") ? 0.42 : 0.68);
    const unitWh = Math.max(2200, Math.min(4600, Math.round(isSelected ? wh : baseWh + dWh * coupling)));
    const unitTq = Math.max(800, Math.min(4800, Math.round(isSelected ? torque : baseTq + dTorque * coupling)));
    const unitTemp = Math.max(40, Math.min(88, Math.round(isSelected ? temp : baseTemp + dTemp * coupling)));

    const unitMaint = computeMaintEscrow(unitTq, unitTemp);
    const unitDm = isSelected
      ? sliderDm
      : Math.round((u.dm || 0) + (sliderDm - 4310000) * (coupling * 0.45));
    const unitDs = isSelected
      ? (u.ds + sliderDm)
      : Math.round(u.ds + (unitDm - (u.dm || 0)) * 0.55);
    const unitLiq = isSelected
      ? Math.max(0, (u.liq || 0) + sliderDm)
      : Math.max(0, (u.liq || 0) + Math.round((unitDm - (u.dm || 0)) * 0.55));
    const unitMode = unitDs <= 0 && unitLiq <= 0
      ? "VOID_HALT"
      : (unitDs <= 0 || unitLiq === 0 ? "SOFT_BANKRUPTCY" : (unitLiq < 10_000_000 || unitDs < 10_000_000 ? "CONSERVATION" : "NOMINAL"));

    const state = {
      ds: unitDs,
      dm: unitDm,
      liq: unitLiq,
      temp: unitTemp,
      torque: unitTq,
      zombie: Boolean(u.zombie) && unitDs <= 12_000_000,
      mode: unitMode
    };
    const grade = classifySurvivalGrade(state);
    const therm = computeThermalIntensity(unitTemp);
    gradeCounts[grade.key] += 1;

    // 5 columns x 4 ranks Xi'an Terracotta Phalanx Grid across the 3 pit bays,
    // dynamically shifting across the 4D Matrix as parameters (ΔWh, τ², T, Wage) change.
    const colIdx = idx % 5;
    const rowIdx = Math.floor(idx / 5); // 0 or 1
    const baseColWh = 2420 + colIdx * 485;
    const baseRowTq = 1280 + rowIdx * 1500;
    const shiftWh = Math.round(dWh * coupling * 0.42);
    const shiftTq = Math.round(dTorque * coupling * 0.36);

    // Primary Commander Warrior (A01..A10)
    warriors.push({
      uid: u.id,
      shortId: u.id.replace("wlt_atlas_", "A"),
      rankRole: "COMMANDER",
      isSelected,
      unitIndex: idx,
      wh: Math.max(2240, Math.min(4560, baseColWh + shiftWh)),
      rawWh: unitWh,
      ds: unitDs,
      dsOpvs: unitDs / MICRO_PER_OPVS,
      dm: unitDm,
      torque: Math.max(920, Math.min(4680, baseRowTq + shiftTq)),
      rawTorque: unitTq,
      temp: unitTemp,
      grade,
      therm,
      mode: unitMode
    });

    // Synchronized Terracotta Vanguard Escort (V01..V10) standing in offset rank behind/flank
    const escortDs = Math.round(unitDs - (1_800_000 + (idx % 3) * 650_000));
    const escortTemp = Math.max(40, Math.min(88, unitTemp + (idx % 2 === 0 ? 2 : -1)));
    const escortState = { ...state, ds: escortDs, temp: escortTemp };
    const escortGrade = classifySurvivalGrade(escortState);
    const escortTherm = computeThermalIntensity(escortTemp);
    gradeCounts[escortGrade.key] += 1;
    warriors.push({
      uid: u.id,
      shortId: `V${String(idx + 1).padStart(2, "0")}`,
      rankRole: "VANGUARD",
      isSelected: false,
      unitIndex: idx,
      wh: Math.max(2240, Math.min(4560, baseColWh + shiftWh + (idx % 2 === 0 ? -95 : 95))),
      rawWh: unitWh,
      ds: escortDs,
      dsOpvs: escortDs / MICRO_PER_OPVS,
      dm: unitDm,
      torque: Math.max(920, Math.min(4680, baseRowTq + 740 + shiftTq)),
      rawTorque: unitTq,
      temp: escortTemp,
      grade: escortGrade,
      therm: escortTherm,
      mode: unitMode
    });
  });

  // Identify highest d_S warrior for Ascension Peak aura
  let peakWarrior = warriors[0] || null;
  warriors.forEach((w) => {
    if (peakWarrior && w.ds > peakWarrior.ds) peakWarrior = w;
  });

  return { warriors, gradeCounts, peakWarrior };
}

export function manifoldFloorOpvs(wh, torque, tempC) {
  const escrowOpvs = computeMaintEscrow(torque, tempC) / MICRO_PER_OPVS;
  const swapNorm = Math.max(0, (Number(wh) || 3271) - 2200) / 2400;
  return Number((escrowOpvs * 1.45 + swapNorm * 1.8).toFixed(3));
}

export function projectKirchhoff4D(point, camera, bounds) {
  const {
    whMin = 2200,
    whMax = 4600,
    dsMin = -12,
    dsMax = 68,
    tqMin = 800,
    tqMax = 4800
  } = bounds || {};

  const xRaw = ((Number(point.wh) || 3271) - whMin) / (whMax - whMin);
  const yRaw = ((Number(point.dsOpvs ?? (point.ds / MICRO_PER_OPVS)) || 0) - dsMin) / (dsMax - dsMin);
  const zRaw = ((Number(point.torque) || 1825) - tqMin) / (tqMax - tqMin);

  const nx = (Math.max(-0.15, Math.min(1.15, xRaw)) - 0.5) * 2.25;
  const ny = (Math.max(-0.15, Math.min(1.15, yRaw)) - 0.45) * 1.8;
  const nz = (Math.max(-0.15, Math.min(1.15, zRaw)) - 0.5) * 1.85;

  const yaw = camera.yaw ?? -0.58;
  const pitch = camera.pitch ?? 0.36;
  const zoom = camera.zoom ?? 1.0;

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = nx * cy - nz * sy;
  const z1 = nx * sy + nz * cy;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = ny * cp - z1 * sp;
  const z2 = ny * sp + z1 * cp;

  const dist = 3.85 / Math.max(0.55, zoom);
  const depth = dist + z2;
  if (depth <= 0.25) return null;

  const scale = (Math.min(camera.width, camera.height) * 0.76) / depth;
  return {
    x: camera.width * 0.5 + x1 * scale,
    y: camera.height * 0.54 - y2 * scale,
    z: depth,
    scale
  };
}
