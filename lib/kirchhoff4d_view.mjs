import {
  MICRO_PER_OPVS,
  SURVIVAL_GRADES,
  computeMaintEscrow,
  classifySurvivalGrade,
  computeThermalIntensity,
  computeAscensionAura,
  computeTroop4DMatrix,
  projectKirchhoff4D
} from "./kirchhoff4d.mjs";

const K4D_I18N = {
  en: {
    axX: "X · MATRIX SWAP ΔWh",
    axY: "Y · ALTITUDE d_S",
    axZ: "Z · MATRIX TORQUE² τ²",
    dimW: "4D PERFORMANCE TEMP",
    auraTitle: "ASCENSION PEAK AURA LUMINESCENCE",
    auraBreach: "COLLAPSED · BREACH",
    auraPeak: "PEAK WARRIOR",
    spinOn: "Orbit: ON",
    spinOff: "Orbit: OFF",
    reset: "Reset 4D",
    gradesTitle: "6-GRADE TROOP PERFORMANCE MATRIX (20 UNITS)",
    previewTag: "ACTIVE TARGET",
    troopTag: "PHALANX",
    hintClick: "CLICK WARRIOR TO SELECT · DRAG TO ORBIT · SCROLL TO ZOOM",
    gradeNames: {
      S: "Ascension Peak",
      A: "Nominal Survivor",
      B: "Stasis Band",
      C: "Thermal Drift",
      D: "Plane Breach",
      F: "Void Halt"
    }
  },
  fr: {
    axX: "X · MATRICE SWAP ΔWh",
    axY: "Y · ALTITUDE d_S",
    axZ: "Z · MATRICE COUPLE² τ²",
    dimW: "4D PERF. THERMIQUE",
    auraTitle: "LUMINANCE AURA PIC D'ASCENSION",
    auraBreach: "ÉTEINTE · RUPTURE",
    auraPeak: "PIC TROUPE",
    spinOn: "Orbite : ON",
    spinOff: "Orbite : OFF",
    reset: "Centrer 4D",
    gradesTitle: "MATRICE DE PERFORMANCE 6 GRADES (20 UNITÉS)",
    previewTag: "CIBLE ACTIVE",
    troopTag: "PHALANGE",
    hintClick: "CLIC SUR GUERRIER = SÉLECTION · GLISSER = ORBITE · ZOOM MOLETTE",
    gradeNames: {
      S: "Pic Ascension",
      A: "Nominal",
      B: "Stase",
      C: "Dérive Therm.",
      D: "Rupture",
      F: "Arrêt Critique"
    }
  }
};

function getAppState() {
  return window.__OPVS_STATE__ || null;
}

function getLang() {
  const st = getAppState();
  if (st && typeof st.getLang === "function") return st.getLang();
  return document.documentElement.lang === "fr" ? "fr" : "en";
}

function getSliderInputs() {
  const wage = Number(document.getElementById("g5-wage")?.value) || 8581000;
  const wh = Number(document.getElementById("g5-wh")?.value) || 3271;
  const temp = Number(document.getElementById("g5-temp")?.value) || 54;
  const torque = Number(document.getElementById("g5-torque")?.value) || 1825;
  return { wage, wh, temp, torque };
}

function initKirchhoff4D() {
  const canvas = document.getElementById("k4d-canvas");
  const svg = document.getElementById("g5-manifold-svg");
  if (!canvas || !svg) return;
  const ctx = canvas.getContext("2d");

  let yaw = -0.52;
  let pitch = 0.42;
  let zoom = 0.86;
  let autoSpin = false;
  let dragging = false;
  let didMove = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let pointerPos = null;
  let projectedWarriors = [];
  let dirty = true;
  let rafId = null;
  let lastFrameMs = 0;
  let lastHudSig = "";
  let lastLangRendered = "";

  // Persistent pooled SVG overlay primitives (never recreate DOM nodes at 60Hz)
  const ns = "http://www.w3.org/2000/svg";
  const makeSvg = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    svg.appendChild(el);
    return el;
  };
  const crossV = makeSvg("line", { stroke: "rgba(255,255,255,0.14)", "stroke-width": 1, "stroke-dasharray": "2 3" });
  const crossH = makeSvg("line", { stroke: "rgba(255,255,255,0.14)", "stroke-width": 1, "stroke-dasharray": "2 3" });
  const peakCircle = makeSvg("circle", { fill: "none", "stroke-width": 1.35 });
  const peakRect = makeSvg("rect", { height: 17, fill: "rgba(0,0,0,0.86)", "stroke-width": 0.9 });
  const peakText = makeSvg("text", { "font-size": 10.2, "font-weight": 700, "font-family": '"DIN 1451", monospace' });
  const probeRect = makeSvg("rect", { width: 345, height: 34, fill: "rgba(5,5,5,0.9)", "stroke-width": 1 });
  const probeText1 = makeSvg("text", { "font-size": 10.2, "font-weight": 700, "font-family": '"DIN 1451", monospace' });
  const probeText2 = makeSvg("text", { fill: "#C6C6C6", "font-size": 9.8, "font-family": '"DIN 1451", monospace' });
  const hintText = makeSvg("text", { fill: "#7E6B5D", "font-size": 9.5, "font-weight": 700, "font-family": '"DIN 1451", monospace', "text-anchor": "end" });

  // Build the 6 grade monitor cells once
  const gradeCells = new Map();
  function ensureGradeStripCells() {
    const strip = document.getElementById("k4d-grade-strip");
    if (!strip) return null;
    if (gradeCells.size === SURVIVAL_GRADES.length && strip.children.length === SURVIVAL_GRADES.length) {
      return strip;
    }
    strip.innerHTML = "";
    gradeCells.clear();
    SURVIVAL_GRADES.forEach((g) => {
      const cell = document.createElement("div");
      cell.className = "k4d-grade-item";
      const topRow = document.createElement("div");
      topRow.className = "k4d-grade-top";
      const codeSpan = document.createElement("span");
      codeSpan.className = "k4d-grade-code";
      const markerSpan = document.createElement("span");
      markerSpan.className = "k4d-grade-mark";
      topRow.appendChild(codeSpan);
      topRow.appendChild(markerSpan);
      const nameSpan = document.createElement("div");
      nameSpan.className = "k4d-grade-name";
      cell.appendChild(topRow);
      cell.appendChild(nameSpan);
      strip.appendChild(cell);
      gradeCells.set(g.key, { g, cell, codeSpan, markerSpan, nameSpan });
    });
    return strip;
  }

  function updateGradeStrip(activeKey, previewKey, gradeCounts) {
    const strip = ensureGradeStripCells();
    if (!strip) return;
    const l = getLang();
    const labels = K4D_I18N[l].gradeNames;

    SURVIVAL_GRADES.forEach((g) => {
      const entry = gradeCells.get(g.key);
      if (!entry) return;
      const { cell, codeSpan, markerSpan, nameSpan } = entry;
      const isAct = g.key === activeKey;
      const isPred = g.key === previewKey && previewKey !== activeKey;
      const count = gradeCounts ? (gradeCounts[g.key] || 0) : 0;

      cell.className = `k4d-grade-item${isAct ? " is-active" : ""}${isPred ? " is-predicted" : ""}`;
      cell.title = l === "fr" ? `${g.fr} (${g.thresholdFr})` : `${g.en} (${g.thresholdEn})`;
      cell.style.borderColor = isAct ? g.color : (isPred ? g.color : (count > 0 ? "rgba(180, 130, 96, 0.35)" : (g.key === "F" ? "#2E2E32" : "#262626")));
      cell.style.background = isAct ? g.bg : (g.key === "F" ? "#050505" : "#070707");

      codeSpan.style.color = g.key === "F" ? (isAct ? "#C6C6CC" : "#7A7A80") : g.color;
      codeSpan.textContent = `${g.key} · ${count}`;

      markerSpan.style.color = isAct ? g.color : (isPred ? "#FFFFFF" : (count > 0 ? "#9A9A9E" : "#4A4A4E"));
      markerSpan.textContent = isAct ? "LIVE" : (isPred ? "NEXT" : (count > 0 ? "ACTIVE" : "—"));

      nameSpan.style.color = isAct ? "#FFFFFF" : (isPred ? "#D0D0D0" : "#8A8A8E");
      nameSpan.textContent = labels[g.key] || g.code;
    });
  }

  function resizeCanvas() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      dirty = true;
    }
    const vb = `0 0 ${Math.round(rect.width)} ${Math.round(rect.height)}`;
    if (svg.getAttribute("viewBox") !== vb) {
      svg.setAttribute("viewBox", vb);
    }
  }

  function getSceneData() {
    const st = getAppState();
    const fallbackFleet = [
      { id: "wlt_atlas_01", policy: "gemini-robotics-v2.4-margin", liq: 518420000, swap: 3180000, dm: 4610000, ds: 58420000, torque: 1420, temp: 51, mode: "NOMINAL", zombie: false },
      { id: "wlt_atlas_04", policy: "gemini-robotics-v2.4-margin", liq: 482150000, swap: 3271000, dm: 4310000, ds: 42180000, torque: 1825, temp: 54, mode: "NOMINAL", zombie: false },
      { id: "wlt_atlas_09", policy: "gemini-robotics-v2.5-exp", liq: 2140000, swap: 3410000, dm: -2450000, ds: -1270000, torque: 4380, temp: 84, mode: "SOFT_BANKRUPTCY", zombie: true }
    ];
    const fleet = st ? st.getFleet() : fallbackFleet;
    const selectedId = st ? st.getSelectedId() : fleet[1].id;
    const unit = fleet.find((u) => u.id === selectedId) || fleet[0];
    const slider = getSliderInputs();

    const estMaint = computeMaintEscrow(slider.torque, slider.temp);
    const estDm = slider.wage - slider.wh * 1000 - estMaint;
    const estDs = unit.ds + estDm;
    const estLiq = Math.max(0, (unit.liq || 0) + estDm);
    const estMode = estDs <= 0 && estLiq <= 0
      ? "VOID_HALT"
      : (estDs <= 0 || estLiq === 0 ? "SOFT_BANKRUPTCY" : (estLiq < 10000000 || estDs < 10000000 ? "CONSERVATION" : "NOMINAL"));

    const preview = {
      ds: estDs,
      wh: slider.wh,
      torque: slider.torque,
      temp: slider.temp,
      wage: slider.wage,
      dm: estDm,
      liq: estLiq,
      mode: estMode,
      zombie: Boolean(unit.zombie) && estDs <= 12000000
    };

    const currentGrade = classifySurvivalGrade(unit);
    const previewGrade = classifySurvivalGrade(preview);
    const troop = computeTroop4DMatrix(fleet, unit.id, slider);
    const aura = computeAscensionAura(
      troop.warriors.map((w, i) => ({ cycle: i + 1, ds: w.ds, dm: w.dm })),
      preview
    );

    return { fleet, unit, slider, currentGrade, previewGrade, troop, aura };
  }

  function updateHudDom(data) {
    const l = getLang();
    const countsSig = Object.values(data.troop.gradeCounts).join(",");
    const sig = `${l}|${data.unit.id}|${data.currentGrade.key}|${data.previewGrade.key}|${data.aura.lumPct}|${data.aura.peakDsOpvs.toFixed(2)}|${data.aura.isBreach}|${data.slider.temp}|${countsSig}`;
    if (sig === lastHudSig) return;
    lastHudSig = sig;

    const t = K4D_I18N[l];
    updateGradeStrip(data.currentGrade.key, data.previewGrade.key, data.troop.gradeCounts);

    const pctEl = document.getElementById("k4d-aura-pct");
    const peakEl = document.getElementById("k4d-aura-peak");
    const fillEl = document.getElementById("k4d-aura-fill");
    const stateEl = document.getElementById("k4d-aura-state");
    const thermEl = document.getElementById("k4d-4d-temp");

    const therm = computeThermalIntensity(data.slider.temp);

    if (pctEl) pctEl.textContent = `${data.aura.lumPct}%`;
    if (peakEl) {
      const sign = data.aura.peakDsOpvs >= 0 ? "+" : "";
      const pkId = data.troop.peakWarrior ? data.troop.peakWarrior.shortId : "A01";
      peakEl.textContent = `${t.auraPeak} (${pkId}): ${sign}${data.aura.peakDsOpvs.toFixed(2)} OPVS`;
    }
    if (fillEl) {
      fillEl.style.width = `${data.aura.lumPct}%`;
      if (data.aura.isBreach) {
        fillEl.style.background = "#FF3B30";
        fillEl.style.boxShadow = "none";
      } else {
        fillEl.style.background = "linear-gradient(90deg, #00B8D4 0%, #00E5FF 45%, #E0FBFF 82%, #FFFFFF 100%)";
        fillEl.style.boxShadow = `0 0 ${Math.round(6 + data.aura.lumPct * 0.14)}px rgba(0, 229, 255, ${(0.25 + data.aura.lumPct * 0.006).toFixed(2)})`;
      }
    }
    if (stateEl) {
      if (data.aura.isBreach) {
        stateEl.textContent = t.auraBreach;
        stateEl.className = "c-breach";
        stateEl.style.color = "";
      } else {
        stateEl.textContent = `${data.previewGrade.key} · ${data.previewGrade[l].split("·")[1]?.trim() || ""}`;
        stateEl.className = "";
        stateEl.style.color = data.previewGrade.color;
      }
    }
    if (thermEl) {
      thermEl.textContent = `${t.dimW}: ${data.slider.temp}°C (${therm.pct}%)`;
      thermEl.style.color = therm.css;
    }

    canvas.setAttribute("data-grade", data.currentGrade.key);
    canvas.setAttribute("data-preview-grade", data.previewGrade.key);
    canvas.setAttribute("data-aura-pct", String(data.aura.lumPct));
    canvas.setAttribute("data-peak-ds", data.aura.peakDsOpvs.toFixed(2));
    canvas.setAttribute("data-thermal-temp", String(data.slider.temp));
    canvas.setAttribute("data-troop-count", String(data.troop.warriors.length));
  }

  function applyStaticI18n() {
    const l = getLang();
    const spinBtn = document.getElementById("k4d-btn-spin");
    const resetBtn = document.getElementById("k4d-btn-reset");
    const auraTitle = document.getElementById("k4d-aura-title");
    const gradesTitle = document.getElementById("k4d-grades-title");
    const t = K4D_I18N[l];
    if (spinBtn) spinBtn.textContent = autoSpin ? t.spinOn : t.spinOff;
    if (resetBtn) resetBtn.textContent = t.reset;
    if (l === lastLangRendered) return;
    lastLangRendered = l;
    if (auraTitle) auraTitle.textContent = t.auraTitle;
    if (gradesTitle) gradesTitle.textContent = t.gradesTitle;
  }

  function scheduleRender() {
    dirty = true;
    if (rafId === null) {
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  function renderFrame(now) {
    rafId = null;
    const simView = document.getElementById("view-simulator");
    const isHidden = simView ? simView.classList.contains("hidden") : false;
    const data = getSceneData();
    updateHudDom(data);

    if (!isHidden) {
      resizeCanvas();
      if (canvas.width > 0 && canvas.height > 0) {
        if (autoSpin && !dragging) {
          if (now - lastFrameMs >= 32) {
            yaw += 0.0038;
            dirty = true;
            lastFrameMs = now;
          }
        }
        if (dirty) {
          dirty = false;
          drawScene(data);
        }
      }
      if (autoSpin) {
        rafId = requestAnimationFrame(renderFrame);
      }
    }
  }

  function drawTerracottaWarrior(w, screenFoot, screenPedestal, dpr, isPeak, aura) {
    const s = Math.max(0.62, Math.min(1.5, (screenPedestal.scale / 142))) * dpr;
    const bx = screenPedestal.x;
    const by = screenPedestal.y;
    const col = w.grade.key === "F" ? "#6E6E73" : w.grade.color;
    const fillArmor = w.grade.key === "F" ? "#101012" : w.grade.color;
    const clayDark = "#2B1B13";
    const clayTrim = "#B67349";
    const isCmd = w.rankRole === "COMMANDER";

    // 1. Vertical 4D altitude column connecting matrix floor (y=0) to robot's live pedestal (y=d_S)
    if (screenFoot) {
      ctx.save();
      ctx.strokeStyle = w.dsOpvs <= 0 ? "rgba(255, 59, 48, 0.55)" : (w.isSelected ? "#00E5FF" : "rgba(182, 115, 73, 0.42)");
      ctx.lineWidth = (w.isSelected ? 1.8 : 1.1) * dpr;
      ctx.setLineDash([3 * dpr, 2.5 * dpr]);
      ctx.beginPath();
      ctx.moveTo(screenFoot.x, screenFoot.y);
      ctx.lineTo(bx, by);
      ctx.stroke();

      // Floor anchor footprint square
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(182, 115, 73, 0.25)";
      ctx.fillRect(screenFoot.x - 3 * s, screenFoot.y - 1.5 * s, 6 * s, 3 * s);
      ctx.restore();
    }

    // 2. Ascension Peak cyan-white radial aura glow behind warrior
    if (isPeak && !aura.isBreach && aura.lumPct > 0) {
      const rAura = (28 + aura.radiusScale * 52) * dpr;
      const cyAura = by - 22 * s;
      const grad = ctx.createRadialGradient(bx, cyAura, 2 * dpr, bx, cyAura, rAura);
      grad.addColorStop(0, `rgba(255, 255, 255, ${Math.min(0.95, 0.42 + aura.bloomAlpha * 0.5).toFixed(3)})`);
      grad.addColorStop(0.28, `rgba(184, 248, 255, ${(aura.bloomAlpha * 0.6).toFixed(3)})`);
      grad.addColorStop(0.65, `rgba(0, 229, 255, ${(aura.bloomAlpha * 0.24).toFixed(3)})`);
      grad.addColorStop(1, "rgba(0, 229, 255, 0)");
      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, cyAura, rAura, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Matrix plinth pedestal diamond
    ctx.save();
    const pw = (isCmd ? 11.5 : 9) * s;
    const ph = (isCmd ? 4.8 : 3.8) * s;
    ctx.fillStyle = w.isSelected ? "rgba(0, 229, 255, 0.22)" : "rgba(26, 17, 13, 0.9)";
    ctx.strokeStyle = w.isSelected ? "#FFFFFF" : col;
    ctx.lineWidth = (w.isSelected ? 1.8 : 1.1) * dpr;
    ctx.beginPath();
    ctx.moveTo(bx, by - ph);
    ctx.lineTo(bx + pw, by);
    ctx.lineTo(bx, by + ph);
    ctx.lineTo(bx - pw, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 4. Armored Terracotta Humanoid Warrior Silhouette (bottom-up from plinth y = by)
    const hScale = isCmd ? 1.0 : 0.86;
    const hs = s * hScale;

    // Legs & Armored Greaves
    ctx.fillStyle = clayDark;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.0 * dpr;
    // Left & right greave pillars
    ctx.fillRect(bx - 5.2 * hs, by - 13 * hs, 3.8 * hs, 12 * hs);
    ctx.strokeRect(bx - 5.2 * hs, by - 13 * hs, 3.8 * hs, 12 * hs);
    ctx.fillRect(bx + 1.4 * hs, by - 13 * hs, 3.8 * hs, 12 * hs);
    ctx.strokeRect(bx + 1.4 * hs, by - 13 * hs, 3.8 * hs, 12 * hs);

    // Armored Tunic Skirt (Qin dynasty tassets)
    ctx.fillStyle = fillArmor;
    ctx.globalAlpha = w.grade.key === "F" ? 0.92 : 0.28;
    ctx.beginPath();
    ctx.moveTo(bx - 6.8 * hs, by - 11.5 * hs);
    ctx.lineTo(bx + 6.8 * hs, by - 11.5 * hs);
    ctx.lineTo(bx + 5.2 * hs, by - 19 * hs);
    ctx.lineTo(bx - 5.2 * hs, by - 19 * hs);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.stroke();

    // Lamellar Cuirass (Chest Armor tinted with 4D performance color + warm terracotta ribs)
    ctx.fillStyle = clayDark;
    ctx.beginPath();
    ctx.moveTo(bx - 6.2 * hs, by - 19 * hs);
    ctx.lineTo(bx + 6.2 * hs, by - 19 * hs);
    ctx.lineTo(bx + 8.0 * hs, by - 31 * hs);
    ctx.lineTo(bx - 8.0 * hs, by - 31 * hs);
    ctx.closePath();
    ctx.fill();

    // Performance glaze overlay on chest armor
    ctx.fillStyle = fillArmor;
    ctx.globalAlpha = w.grade.key === "F" ? 0.65 : 0.42;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = w.isSelected ? "#FFFFFF" : col;
    ctx.lineWidth = (w.isSelected ? 1.5 : 1.05) * dpr;
    ctx.stroke();

    // Qin lamellar chest plate horizontal lines
    ctx.strokeStyle = clayTrim;
    ctx.lineWidth = 0.75 * dpr;
    ctx.beginPath();
    ctx.moveTo(bx - 6.8 * hs, by - 23 * hs);
    ctx.lineTo(bx + 6.8 * hs, by - 23 * hs);
    ctx.moveTo(bx - 7.4 * hs, by - 27 * hs);
    ctx.lineTo(bx + 7.4 * hs, by - 27 * hs);
    ctx.stroke();

    // 4th-dimension thermal core badge on chest
    ctx.fillStyle = w.therm.css;
    ctx.fillRect(bx - 2.0 * hs, by - 26.5 * hs, 4.0 * hs, 3.2 * hs);

    // Shoulder Pauldrons
    ctx.fillStyle = fillArmor;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.0 * dpr;
    ctx.fillRect(bx - 10.6 * hs, by - 31.2 * hs, 3.2 * hs, 7.5 * hs);
    ctx.strokeRect(bx - 10.6 * hs, by - 31.2 * hs, 3.2 * hs, 7.5 * hs);
    ctx.fillRect(bx + 7.4 * hs, by - 31.2 * hs, 3.2 * hs, 7.5 * hs);
    ctx.strokeRect(bx + 7.4 * hs, by - 31.2 * hs, 3.2 * hs, 7.5 * hs);

    // Commander Ledger Halberd / Energy Spear (iconic Xi'an standing guard weapon)
    if (isCmd) {
      ctx.strokeStyle = w.isSelected ? "#FFFFFF" : col;
      ctx.lineWidth = 1.3 * dpr;
      ctx.beginPath();
      ctx.moveTo(bx + 9.2 * hs, by - 4 * hs);
      ctx.lineTo(bx + 9.2 * hs, by - 44 * hs);
      ctx.stroke();
      // Spear tip diamond
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(bx + 9.2 * hs, by - 48 * hs);
      ctx.lineTo(bx + 11.4 * hs, by - 43.5 * hs);
      ctx.lineTo(bx + 9.2 * hs, by - 41 * hs);
      ctx.lineTo(bx + 7.0 * hs, by - 43.5 * hs);
      ctx.closePath();
      ctx.fill();
    }

    // Sculpted Head + Qin Topknot Crest + Glowing Visor
    ctx.fillStyle = "#2A1B14";
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.0 * dpr;
    ctx.fillRect(bx - 4.0 * hs, by - 39.5 * hs, 8.0 * hs, 7.8 * hs);
    ctx.strokeRect(bx - 4.0 * hs, by - 39.5 * hs, 8.0 * hs, 7.8 * hs);

    // Qin official topknot / crested officer cap
    ctx.fillStyle = isCmd ? col : clayTrim;
    if (isCmd) {
      ctx.fillRect(bx - 2.6 * hs, by - 43.2 * hs, 5.2 * hs, 3.5 * hs);
    } else {
      ctx.fillRect(bx - 1.7 * hs, by - 42.0 * hs, 3.4 * hs, 2.5 * hs);
    }

    // Glowing performance LED visor
    ctx.fillStyle = w.grade.key === "F" ? "#48484C" : col;
    ctx.fillRect(bx - 3.1 * hs, by - 36.6 * hs, 6.2 * hs, 1.8 * hs);

    // Commander unit tag above helmet (clean & readable)
    if (isCmd || w.isSelected) {
      ctx.font = `700 ${Math.round(8.5 * dpr)}px "DIN 1451", monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = w.isSelected ? "#FFFFFF" : col;
      ctx.fillText(w.shortId, bx, by - 45.8 * hs);
    }

    ctx.restore();
  }

  function drawScene(data) {
    const W = canvas.width;
    const H = canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const l = getLang();
    const t = K4D_I18N[l];

    const allDs = [...data.troop.warriors.map((w) => w.dsOpvs), 0, 20];
    const dsMin = Math.min(-14, Math.floor(Math.min(...allDs) - 6));
    const dsMax = Math.max(64, Math.ceil(Math.max(...allDs) + 8));

    const bounds = { whMin: 2200, whMax: 4600, dsMin, dsMax, tqMin: 800, tqMax: 4800 };
    const cam = { width: W, height: H, yaw, pitch, zoom };
    const proj = (wh, dsOpvs, torque) => projectKirchhoff4D({ wh, dsOpvs, torque }, cam, bounds);

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);

    // 1. Terracotta Excavation Pit Floor Matrix (y = dsMin) + Stepped Earthen Corridor Walls
    const floorY = dsMin;
    const nx = 5;
    const nz = 5;

    // Pit slab background
    const c00 = proj(2200, floorY, 800);
    const c10 = proj(4600, floorY, 800);
    const c11 = proj(4600, floorY, 4800);
    const c01 = proj(2200, floorY, 4800);
    if (c00 && c10 && c11 && c01) {
      ctx.save();
      ctx.fillStyle = "rgba(32, 20, 14, 0.72)";
      ctx.strokeStyle = "rgba(182, 115, 73, 0.45)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(c00.x, c00.y);
      ctx.lineTo(c10.x, c10.y);
      ctx.lineTo(c11.x, c11.y);
      ctx.lineTo(c01.x, c01.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 4D Matrix Floor Grid Lines (Terracotta clay tiles)
    ctx.save();
    for (let i = 0; i <= nx; i += 1) {
      const whLine = 2200 + (i / nx) * 2400;
      const pA = proj(whLine, floorY, 800);
      const pB = proj(whLine, floorY, 4800);
      if (pA && pB) {
        ctx.strokeStyle = i === 0 || i === nx ? "rgba(212, 134, 84, 0.55)" : "rgba(182, 115, 73, 0.24)";
        ctx.lineWidth = (i % 2 === 0 ? 1.2 : 0.85) * dpr;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      }
    }
    for (let j = 0; j <= nz; j += 1) {
      const tqLine = 800 + (j / nz) * 4000;
      const pA = proj(2200, floorY, tqLine);
      const pB = proj(4600, floorY, tqLine);
      if (pA && pB) {
        ctx.strokeStyle = j === 0 || j === nz ? "rgba(212, 134, 84, 0.55)" : "rgba(182, 115, 73, 0.24)";
        ctx.lineWidth = (j % 2 === 0 ? 1.2 : 0.85) * dpr;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      }
    }

    // Two stepped Xi'an rammed-earth partition walls dividing the 3 phalanx bays
    [3000, 3800].forEach((wallWh) => {
      const wBaseA = proj(wallWh, floorY, 800);
      const wBaseB = proj(wallWh, floorY, 4800);
      const wTopA = proj(wallWh, floorY + 4.2, 800);
      const wTopB = proj(wallWh, floorY + 4.2, 4800);
      if (wBaseA && wBaseB && wTopA && wTopB) {
        ctx.fillStyle = "rgba(92, 56, 36, 0.24)";
        ctx.strokeStyle = "rgba(196, 122, 74, 0.48)";
        ctx.lineWidth = 1.0 * dpr;
        ctx.beginPath();
        ctx.moveTo(wBaseA.x, wBaseA.y);
        ctx.lineTo(wBaseB.x, wBaseB.y);
        ctx.lineTo(wTopB.x, wTopB.y);
        ctx.lineTo(wTopA.x, wTopA.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    });
    ctx.restore();

    // 2. Crimson Zero-Breach Datum Plane (d_S = 0)
    const b00 = proj(2200, 0, 800);
    const b10 = proj(4600, 0, 800);
    const b11 = proj(4600, 0, 4800);
    const b01 = proj(2200, 0, 4800);
    if (b00 && b10 && b11 && b01) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 59, 48, 0.42)";
      ctx.lineWidth = 1.15 * dpr;
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(b00.x, b00.y);
      ctx.lineTo(b10.x, b10.y);
      ctx.lineTo(b11.x, b11.y);
      ctx.lineTo(b01.x, b01.y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // 3. 4D Matrix Spatial Axes
    function drawAxis(a, b, color, label) {
      const p1 = proj(a[0], a[1], a[2]);
      const p2 = proj(b[0], b[1], b[2]);
      if (!p1 || !p2) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const head = 6.5 * dpr;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - ux * head - uy * (head * 0.5), p2.y - uy * head + ux * (head * 0.5));
      ctx.lineTo(p2.x - ux * head + uy * (head * 0.5), p2.y - uy * head - ux * (head * 0.5));
      ctx.closePath();
      ctx.fill();

      ctx.font = `700 ${Math.round(10 * dpr)}px "DIN 1451", monospace`;
      ctx.textAlign = "left";
      ctx.fillText(label, p2.x + 5 * dpr, p2.y - 4 * dpr);
      ctx.restore();
    }

    drawAxis([2200, floorY, 800], [4680, floorY, 800], "#00E5FF", t.axX);
    drawAxis([2200, floorY, 800], [2200, dsMax + 2, 800], "#FFFFFF", t.axY);
    drawAxis([2200, floorY, 800], [2200, floorY, 4880], "#D98B5A", t.axZ);

    // 4. Project & Depth-Sort the 20 Terracotta Robot Warriors (painter's algorithm back -> front)
    projectedWarriors = [];
    data.troop.warriors.forEach((w) => {
      const pPedestal = proj(w.wh, w.dsOpvs, w.torque);
      if (!pPedestal) return;
      const pFoot = proj(w.wh, floorY, w.torque);
      projectedWarriors.push({
        w,
        pPedestal,
        pFoot,
        cssX: pPedestal.x / dpr,
        cssY: pPedestal.y / dpr,
        headCssY: (pPedestal.y - 26 * (pPedestal.scale / 170) * dpr) / dpr,
        isPeak: data.troop.peakWarrior && data.troop.peakWarrior.shortId === w.shortId
      });
    });

    projectedWarriors.sort((a, b) => b.pPedestal.z - a.pPedestal.z);

    projectedWarriors.forEach((item) => {
      drawTerracottaWarrior(item.w, item.pFoot, item.pPedestal, dpr, item.isPeak, data.aura);
    });

    updateSvgOverlay(data, projectedWarriors, dpr);
  }

  function updateSvgOverlay(data, warriors, dpr) {
    const l = getLang();
    const t = K4D_I18N[l];
    const viewW = canvas.width / dpr;
    const viewH = canvas.height / dpr;

    const peakItem = warriors.find((item) => item.isPeak);
    if (peakItem) {
      const px = peakItem.cssX;
      const py = peakItem.headCssY;
      const reticleCol = data.aura.isBreach ? "#FF3B30" : "#E0FBFF";
      const outerR = 14 + data.aura.radiusScale * 12;

      peakCircle.setAttribute("visibility", "visible");
      peakCircle.setAttribute("cx", px.toFixed(1));
      peakCircle.setAttribute("cy", py.toFixed(1));
      peakCircle.setAttribute("r", outerR.toFixed(1));
      peakCircle.setAttribute("stroke", reticleCol);
      peakCircle.setAttribute("stroke-dasharray", data.aura.isBreach ? "3 3" : "5 3");
      peakCircle.setAttribute("opacity", (data.aura.isBreach ? 0.85 : Math.max(0.35, data.aura.bloomAlpha)).toFixed(2));

      const sign = data.aura.peakDsOpvs >= 0 ? "+" : "";
      const tagText = `${peakItem.w.shortId} · ${sign}${data.aura.peakDsOpvs.toFixed(2)} OPVS · AURA ${data.aura.lumPct}%`;
      const tx = Math.min(viewW - 224, Math.max(12, px + outerR + 8));
      const ty = Math.max(22, Math.min(viewH - 54, py - 8));

      peakRect.setAttribute("visibility", "visible");
      peakRect.setAttribute("x", (tx - 5).toFixed(1));
      peakRect.setAttribute("y", (ty - 12).toFixed(1));
      peakRect.setAttribute("width", "216");
      peakRect.setAttribute("stroke", reticleCol);

      peakText.setAttribute("visibility", "visible");
      peakText.setAttribute("x", tx.toFixed(1));
      peakText.setAttribute("y", ty.toFixed(1));
      peakText.setAttribute("fill", reticleCol);
      peakText.textContent = tagText;
    } else {
      peakCircle.setAttribute("visibility", "hidden");
      peakRect.setAttribute("visibility", "hidden");
      peakText.setAttribute("visibility", "hidden");
    }

    let probe = null;
    if (pointerPos && warriors.length > 0) {
      let bestDist = 44;
      warriors.forEach((item) => {
        const d = Math.hypot(item.cssX - pointerPos.x, item.headCssY - pointerPos.y);
        if (d < bestDist) {
          bestDist = d;
          probe = item;
        }
      });
    } else {
      probe = warriors.find((item) => item.w.isSelected) || warriors[warriors.length - 1];
    }

    if (probe) {
      const gx = probe.cssX;
      const gy = probe.headCssY;
      crossV.setAttribute("visibility", "visible");
      crossV.setAttribute("x1", gx.toFixed(1));
      crossV.setAttribute("y1", "10");
      crossV.setAttribute("x2", gx.toFixed(1));
      crossV.setAttribute("y2", (viewH - 10).toFixed(1));

      crossH.setAttribute("visibility", "visible");
      crossH.setAttribute("x1", "10");
      crossH.setAttribute("y1", gy.toFixed(1));
      crossH.setAttribute("x2", (viewW - 10).toFixed(1));
      crossH.setAttribute("y2", gy.toFixed(1));

      const hx = 12;
      const hy = viewH - 46;
      const col = probe.w.grade.key === "F" ? "#B0B0B6" : probe.w.grade.color;
      probeRect.setAttribute("visibility", "visible");
      probeRect.setAttribute("x", String(hx));
      probeRect.setAttribute("y", String(hy));
      probeRect.setAttribute("stroke", probe.w.grade.key === "F" ? "#6E6E73" : probe.w.grade.color);

      const dsS = `${probe.w.dsOpvs >= 0 ? "+" : ""}${probe.w.dsOpvs.toFixed(2)}`;
      probeText1.setAttribute("visibility", "visible");
      probeText1.setAttribute("x", String(hx + 8));
      probeText1.setAttribute("y", String(hy + 14));
      probeText1.setAttribute("fill", col);
      probeText1.textContent = `${probe.w.shortId} (${probe.w.uid}) · GRADE ${probe.w.grade.key} · d_S=${dsS} OPVS`;

      probeText2.setAttribute("visibility", "visible");
      probeText2.setAttribute("x", String(hx + 8));
      probeText2.setAttribute("y", String(hy + 28));
      probeText2.textContent = `X=${probe.w.rawWh} Wh · Z=${probe.w.rawTorque} τ² · W=${probe.w.temp}°C (${probe.w.rankRole})`;
    } else {
      crossV.setAttribute("visibility", "hidden");
      crossH.setAttribute("visibility", "hidden");
      probeRect.setAttribute("visibility", "hidden");
      probeText1.setAttribute("visibility", "hidden");
      probeText2.setAttribute("visibility", "hidden");
    }

    hintText.setAttribute("x", String(Math.round(viewW - 14)));
    hintText.setAttribute("y", String(Math.round(viewH - 14)));
    hintText.textContent = t.hintClick;
  }

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    didMove = false;
    downX = e.clientX;
    downY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    pointerPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (dragging) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) {
        didMove = true;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw += dx * 0.008;
      pitch = Math.max(-0.15, Math.min(1.15, pitch + dy * 0.006));
    }
    scheduleRender();
  });
  const handleUp = (e) => {
    if (dragging && !didMove) {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      let hit = null;
      let bestDist = 34;
      projectedWarriors.forEach((item) => {
        const d = Math.hypot(item.cssX - cx, item.headCssY - cy);
        if (d < bestDist) {
          bestDist = d;
          hit = item;
        }
      });
      if (hit) {
        const sel = document.getElementById("g5-unit-select");
        if (sel && sel.value !== hit.w.uid) {
          sel.value = hit.w.uid;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }
    dragging = false;
  };
  canvas.addEventListener("pointerup", handleUp);
  canvas.addEventListener("pointercancel", () => { dragging = false; });
  canvas.addEventListener("pointerleave", () => {
    pointerPos = null;
    dragging = false;
    scheduleRender();
  });
  canvas.addEventListener("dblclick", () => {
    yaw = -0.52;
    pitch = 0.42;
    zoom = 0.86;
    scheduleRender();
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoom = Math.max(0.65, Math.min(2.15, zoom - e.deltaY * 0.001));
    scheduleRender();
  }, { passive: false });

  const spinBtn = document.getElementById("k4d-btn-spin");
  if (spinBtn) {
    spinBtn.addEventListener("click", () => {
      autoSpin = !autoSpin;
      applyStaticI18n();
      scheduleRender();
    });
  }
  const resetBtn = document.getElementById("k4d-btn-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      yaw = -0.52;
      pitch = 0.42;
      zoom = 0.86;
      scheduleRender();
    });
  }

  const refresh = () => {
    const data = getSceneData();
    updateHudDom(data);
    applyStaticI18n();
    scheduleRender();
  };

  window.addEventListener("opvs:g5-update", refresh);
  window.addEventListener("opvs:g5-preview", refresh);
  ["g5-wage", "g5-wh", "g5-temp", "g5-torque"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", refresh);
  });

  const langObserver = new MutationObserver(() => {
    lastHudSig = "";
    lastLangRendered = "";
    refresh();
  });
  langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  const simView = document.getElementById("view-simulator");
  if (simView) {
    new MutationObserver(() => {
      if (!simView.classList.contains("hidden")) {
        scheduleRender();
      }
    }).observe(simView, { attributes: true, attributeFilter: ["class"] });
  }

  if (typeof ResizeObserver !== "undefined" && canvas.parentElement) {
    new ResizeObserver(() => {
      resizeCanvas();
      scheduleRender();
    }).observe(canvas.parentElement);
  }

  applyStaticI18n();
  refresh();
}

initKirchhoff4D();
