import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json());

// In-memory state mirroring OrbitAiviAdapter + AtlasWageService + OPVS µOPVS bridge
const QUALIFYING_ACTIONS = new Set([
  'module_completed',
  'system_adopted',
  'assessment_passed',
]);

const MICRO_OPVS_PER_CREDIT = 250_000; // 1 CREDIT = 0.25 OPVS (0.25 kWh)

function createInitialAdapterState() {
  return {
    processedEvents: new Set(),
    atlasWalletMicroOpvs: 482_150_000,
    atlasCreditsTotal: 0,
    baseHourlyRateCents: 2500, // $25.00 / h
    completionBonusCents: 500, // $5.00
    history: [],
  };
}

let adapterState = createInitialAdapterState();

function roundHalfUp(value) {
  return Math.floor(value + 0.5 + 1e-12);
}

app.get('/api/adapter/state', (_req, res) => {
  res.json({
    processed_count: adapterState.processedEvents.size,
    atlas_wallet_micro_opvs: adapterState.atlasWalletMicroOpvs,
    atlas_credits_total: (adapterState.atlasCreditsTotal / 100).toFixed(2),
    micro_opvs_per_credit: MICRO_OPVS_PER_CREDIT,
    history: adapterState.history,
  });
});

app.post('/api/adapter/events', (req, res) => {
  const {
    event_id,
    source,
    user_or_agent_id = 'atlas',
    module_id = 'mod_locomotion_v4',
    action = 'module_completed',
    score = 1.0,
    duration_minutes = 30,
  } = req.body || {};

  if (!event_id || typeof event_id !== 'string') {
    return res.status(422).json({ error: 'event_id is required' });
  }
  if (source !== 'orbit' && source !== 'aivi_learning') {
    return res.status(422).json({ error: 'source must be "orbit" or "aivi_learning"' });
  }

  const clampedScore = Math.max(0, Math.min(1, Number(score) || 0));
  const clampedMinutes = Math.max(0, Number(duration_minutes) || 0);

  // 1. Sync state between Orbit and AIVI-Learning
  const syncResult =
    source === 'aivi_learning'
      ? 'synced_to_orbit'
      : source === 'orbit'
        ? 'synced_to_aivi'
        : 'no_sync_required';

  // 2. Qualify & issue wage to Atlas with idempotency protection
  let payout = null;
  let idempotencyStatus = 'APPLIED';
  let opvsSettledMicro = 0;

  const isAtlas = String(user_or_agent_id).trim().toLowerCase() === 'atlas';
  const isQualifying = QUALIFYING_ACTIONS.has(action);

  if (!isAtlas || !isQualifying) {
    idempotencyStatus = !isAtlas ? 'SKIPPED_NON_ATLAS' : 'SKIPPED_NON_QUALIFYING_ACTION';
  } else if (adapterState.processedEvents.has(event_id)) {
    idempotencyStatus = 'IDEMPOTENT_DUPLICATE_BLOCKED';
  } else {
    const timePayCents = (clampedMinutes / 60) * adapterState.baseHourlyRateCents;
    const bonusCents = adapterState.completionBonusCents * clampedScore;
    const totalCents = roundHalfUp(timePayCents + bonusCents);

    if (totalCents > 0) {
      opvsSettledMicro = Math.round((totalCents / 100) * MICRO_OPVS_PER_CREDIT);
      adapterState.processedEvents.add(event_id);
      adapterState.atlasCreditsTotal += totalCents;
      adapterState.atlasWalletMicroOpvs += opvsSettledMicro;

      payout = {
        payout_id: crypto.randomUUID(),
        recipient_id: user_or_agent_id,
        source_event_id: event_id,
        amount: (totalCents / 100).toFixed(2),
        currency: 'CREDITS',
        opvs_equivalent_micro_opvs: opvsSettledMicro,
        reason: `${source}:${action} (${module_id})`,
        created_at: new Date().toISOString(),
      };
    } else {
      idempotencyStatus = 'ZERO_AMOUNT_SKIPPED';
    }
  }

  const record = {
    status: 'processed',
    event_id,
    source,
    user_or_agent_id,
    module_id,
    action,
    score: clampedScore,
    duration_minutes: clampedMinutes,
    sync_result: syncResult,
    idempotency_status: idempotencyStatus,
    wage_payout: payout,
    atlas_wallet_micro_opvs: adapterState.atlasWalletMicroOpvs,
    timestamp: new Date().toISOString(),
  };

  adapterState.history.unshift(record);
  if (adapterState.history.length > 30) {
    adapterState.history.pop();
  }

  return res.json(record);
});

app.post('/api/adapter/reset', (_req, res) => {
  adapterState = createInitialAdapterState();
  return res.json({ status: 'reset', atlas_wallet_micro_opvs: adapterState.atlasWalletMicroOpvs });
});

app.get('/whitepaper.pdf', (_req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      'public/assets/aistudio/Operae_Vis_OPVS_Technical_Whitepaper_v2.0_print_1bd25ab0.pdf'
    )
  );
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
