// ─── SCORING ENGINE UNIT TESTS ───
// Standalone Node script — no framework needed.
// Run: node test_scoring.js

import { mapThreshold, computeRoleScore, computeSystemScore, computeOverallScore, computeFinalScore } from './src/engine/ScoringEngine.js';

let passed = 0;
let failed = 0;

function assert(label, actual, expected, tolerance = 0.5) {
    const ok = Math.abs(actual - expected) <= tolerance;
    if (ok) {
        console.log(`  ✅ ${label}: ${actual} (expected ~${expected})`);
        passed++;
    } else {
        console.log(`  ❌ ${label}: ${actual} (expected ~${expected})`);
        failed++;
    }
}

console.log('\n═══════════════════════════════════════════');
console.log('  SCORING ENGINE — UNIT TESTS');
console.log('═══════════════════════════════════════════\n');

// ── mapThreshold ──
console.log('── mapThreshold ──');
const bp = [[-1000, 10], [0, 30], [0.5, 50], [1, 70], [1.5, 85], [2, 100]];
assert('Below min', mapThreshold(-2000, bp), 10);
assert('At first point', mapThreshold(-1000, bp), 10);
assert('At zero', mapThreshold(0, bp), 30);
assert('Midpoint 0-0.5', mapThreshold(0.25, bp), 40);
assert('At 1.0', mapThreshold(1.0, bp), 70);
assert('At 2.0 (max)', mapThreshold(2.0, bp), 100);
assert('Above max', mapThreshold(5.0, bp), 100);

// ── Trader Role Score ──
console.log('\n── Trader Role Score ──');
const traderGood = computeRoleScore('TRADER', { netProfit: 3000, maxDrawdown: 1500, marginEvents: 0 });
assert('Trader good RAR=2.0 → roleScore high', traderGood.roleScore, 100, 5);

const traderOk = computeRoleScore('TRADER', { netProfit: 500, maxDrawdown: 500, marginEvents: 1 });
assert('Trader ok RAR=1.0 → roleScore mid-range', traderOk.roleScore, 73, 5);

const traderBad = computeRoleScore('TRADER', { netProfit: -200, maxDrawdown: 300, marginEvents: 3 });
assert('Trader bad RAR<0 → roleScore low', traderBad.roleScore, 36, 5);

// ── Generator Role Score ──
console.log('\n── Generator Role Score ──');
const genHigh = computeRoleScore('GENERATOR', { netProfit: 50000, capacityMW: 50, totalMWh: 100, imbalanceCost: 0 });
assert('Gen £1000/MW → roleScore ~100', genHigh.roleScore, 96, 10);

const genMid = computeRoleScore('GENERATOR', { netProfit: 20000, capacityMW: 50, totalMWh: 100, imbalanceCost: 500 });
assert('Gen £400/MW → roleScore ~70-75', genMid.roleScore, 74, 10);

const genLoss = computeRoleScore('GENERATOR', { netProfit: -5000, capacityMW: 50, totalMWh: 100, imbalanceCost: 2000 });
assert('Gen negative → roleScore low', genLoss.roleScore, 25, 10);

// ── BESS Role Score ──
console.log('\n── BESS Role Score ──');
const bessGood = computeRoleScore('BESS', { netProfit: 4000, mwhShifted: 20, totalRevenue: 4000, bmRevenue: 3000, socPenalties: 0 });
assert('BESS £200/MWh → roleScore ~100', bessGood.roleScore, 90, 15);

// ── Supplier Role Score ──
console.log('\n── Supplier Role Score ──');
const supplierCheap = computeRoleScore('SUPPLIER', { netCost: 4000, totalMWh: 100, hedgeRatio: 0.9, imbalanceCost: 100 });
assert('Supplier £40/MWh → roleScore', supplierCheap.roleScore, 99, 5);

// ── System Score ──
console.log('\n── System Score ──');
const sysHelper = computeSystemScore({ totalNIVContribution: 200, stressWindowHelps: 3, missedDeliveries: 0, causedBlackout: false });
assert('System helper → score 80-90', sysHelper, 85, 10);

const sysNeutral = computeSystemScore({ totalNIVContribution: 0, stressWindowHelps: 0, missedDeliveries: 0, causedBlackout: false });
assert('System neutral → score ~50', sysNeutral, 50, 5);

const sysHurter = computeSystemScore({ totalNIVContribution: -300, stressWindowHelps: 0, missedDeliveries: 2, causedBlackout: false });
assert('System hurter → score low', sysHurter, 10, 15);

const sysBlackout = computeSystemScore({ totalNIVContribution: 0, stressWindowHelps: 0, missedDeliveries: 0, causedBlackout: true });
assert('System blackout → score ~10', sysBlackout, 10, 5);

// ── Overall Score ──
console.log('\n── Overall Score ──');
assert('Overall 80+90 α=0.6 → 84', computeOverallScore(80, 90, 0.6), 84, 1);
assert('Overall 100+0 α=0.6 → 60', computeOverallScore(100, 0, 0.6), 60, 1);
assert('Overall 50+50 α=0.6 → 50', computeOverallScore(50, 50, 0.6), 50, 1);

// ── Final Score (multi-round) ──
console.log('\n── Final Score (multi-round) ──');
const consistent = computeFinalScore([80, 82, 79, 81, 80]);
assert('Consistent ~80 → finalScore ~80', consistent, 80, 3);

const volatile = computeFinalScore([95, 20, 90, 10, 85]);
assert('Volatile → finalScore penalized', volatile, 56, 5);

// ── Summary ──
console.log('\n═══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
