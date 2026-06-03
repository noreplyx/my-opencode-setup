#!/usr/bin/env node
/**
 * Plan Quality Score Script
 *
 * Verifier→PlanDescriber feedback loop. Records Verifier results into
 * and computes quality scores.
 *
 * Quality score formula:
 *   planQualityScore = (complianceScore * 0.5)        // plan compliance (0.7 if no contract rules)
 *     + ((1 - failed/total) * 100 * 0.2)              // checkpoint pass rate
 *     + (1 - planOmissions/total) * 100 * 0.1          // plan omissions
 *     + (contractRulesPassed/contractRulesTotal)*100*0.2  // contract rule pass rate
 *
 * Usage:
 *   [runtime] plan-quality-score.ts --record --pipeline-id=<id> --feature=<name>
 *     --compliance-score=<N> --total-checkpoints=<N> --failed=<N>
 *     --skipped=<N> --plan-omissions=<N>
 *     [--contract-rules-total=<N> --contract-rules-passed=<N> --contract-rules-failed=<N>]
 *   [runtime] plan-quality-score.ts --query --feature=<name>
 *   [runtime] plan-quality-score.ts --report
 *   [runtime] plan-quality-score.ts --query-plan-describer
 *
 * Exit codes:
 *   0 = success (or quality >= 85 for --query-plan-describer / pass for --check-contract-rules)
 *   1 = error (or quality 70-85 for --query-plan-describer / warning for --check-contract-rules)
 *   2 = quality < 70 for --query-plan-describer / fail for --check-contract-rules (escalation trigger)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const QUALITY_DIR = path.join(PROJECT_ROOT, '.opencode');
const PLAN_QUALITY_PATH = path.join(QUALITY_DIR, 'plan-quality.yaml');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanQualityEntry {
  date: string;
  pipelineId: string;
  feature: string;
  complianceScore: number;
  totalCheckpoints: number;
  failedCheckpoints: number;
  skippedCheckpoints: number;
  planOmissions: number;
  contractRulesTotal: number;
  contractRulesPassed: number;
  contractRulesFailed: number;
  planQualityScore: number;
}

interface PlanQualityData {
  entries: PlanQualityEntry[];
  aggregates: {
    plandescriber: {
      totalScores: number;
      avgScore: number;
      lowScoreCount: number;
    };
    features: Record<string, {
      totalScores: number;
      avgScore: number;
    }>;
  };
}

// ---------------------------------------------------------------------------
// YAML Helpers (minimal — only what we need, no third-party dep)
// ---------------------------------------------------------------------------

function serializeYaml(data: PlanQualityData): string {
  const lines: string[] = [];

  lines.push('entries:');
  for (const entry of data.entries) {
    lines.push(`  - date: "${entry.date}"`);
    lines.push(`    pipelineId: "${entry.pipelineId}"`);
    lines.push(`    feature: "${entry.feature}"`);
    lines.push(`    complianceScore: ${entry.complianceScore}`);
    lines.push(`    totalCheckpoints: ${entry.totalCheckpoints}`);
    lines.push(`    failedCheckpoints: ${entry.failedCheckpoints}`);
    lines.push(`    skippedCheckpoints: ${entry.skippedCheckpoints}`);
    lines.push(`    planOmissions: ${entry.planOmissions}`);
    lines.push(`    contractRulesTotal: ${entry.contractRulesTotal}`);
    lines.push(`    contractRulesPassed: ${entry.contractRulesPassed}`);
    lines.push(`    contractRulesFailed: ${entry.contractRulesFailed}`);
    lines.push(`    planQualityScore: ${entry.planQualityScore}`);
  }

  lines.push('aggregates:');
  lines.push('  plandescriber:');
  lines.push(`    totalScores: ${data.aggregates.plandescriber.totalScores}`);
  lines.push(`    avgScore: ${data.aggregates.plandescriber.avgScore}`);
  lines.push(`    lowScoreCount: ${data.aggregates.plandescriber.lowScoreCount}`);
  lines.push('  features:');
  for (const [feat, agg] of Object.entries(data.aggregates.features)) {
    lines.push(`    ${feat}:`);
    lines.push(`      totalScores: ${agg.totalScores}`);
    lines.push(`      avgScore: ${agg.avgScore}`);
  }

  return lines.join('\n') + '\n';
}

function deserializeYaml(raw: string): PlanQualityData {
  const data: PlanQualityData = {
    entries: [],
    aggregates: {
      plandescriber: { totalScores: 0, avgScore: 0, lowScoreCount: 0 },
      features: {},
    },
  };

  const lines = raw.split('\n');
  let currentEntry: Partial<PlanQualityEntry> | null = null;
  let inEntries = false;
  let inFeatures = false;
  let currentFeature: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'entries:') {
      inEntries = true;
      inFeatures = false;
      continue;
    }
    if (trimmed === 'aggregates:') {
      inEntries = false;
      continue;
    }
    if (trimmed === '  plandescriber:') {
      inFeatures = false;
      continue;
    }
    if (trimmed.startsWith('  features:')) {
      inFeatures = true;
      continue;
    }

    if (inEntries) {
      if (trimmed === '- date:' || trimmed.startsWith('- date: ')) {
        if (currentEntry && currentEntry.pipelineId) {
          data.entries.push(currentEntry as PlanQualityEntry);
        }
        currentEntry = {};
        const val = trimmed.replace('- date:', '').trim().replace(/^"|"$/g, '');
        currentEntry.date = val;
      } else if (currentEntry) {
        if (trimmed.startsWith('pipelineId: ')) {
          currentEntry.pipelineId = trimmed.replace('pipelineId: ', '').replace(/^"|"$/g, '');
        } else if (trimmed.startsWith('feature: ')) {
          currentEntry.feature = trimmed.replace('feature: ', '').replace(/^"|"$/g, '');
        } else if (trimmed.startsWith('complianceScore: ')) {
          currentEntry.complianceScore = parseFloat(trimmed.replace('complianceScore: ', ''));
        } else if (trimmed.startsWith('totalCheckpoints: ')) {
          currentEntry.totalCheckpoints = parseInt(trimmed.replace('totalCheckpoints: ', ''), 10);
        } else if (trimmed.startsWith('failedCheckpoints: ')) {
          currentEntry.failedCheckpoints = parseInt(trimmed.replace('failedCheckpoints: ', ''), 10);
        } else if (trimmed.startsWith('skippedCheckpoints: ')) {
          currentEntry.skippedCheckpoints = parseInt(trimmed.replace('skippedCheckpoints: ', ''), 10);
        } else if (trimmed.startsWith('planOmissions: ')) {
          currentEntry.planOmissions = parseInt(trimmed.replace('planOmissions: ', ''), 10);
        } else if (trimmed.startsWith('contractRulesTotal: ')) {
          currentEntry.contractRulesTotal = parseInt(trimmed.replace('contractRulesTotal: ', ''), 10);
        } else if (trimmed.startsWith('contractRulesPassed: ')) {
          currentEntry.contractRulesPassed = parseInt(trimmed.replace('contractRulesPassed: ', ''), 10);
        } else if (trimmed.startsWith('contractRulesFailed: ')) {
          currentEntry.contractRulesFailed = parseInt(trimmed.replace('contractRulesFailed: ', ''), 10);
        } else if (trimmed.startsWith('planQualityScore: ')) {
          currentEntry.planQualityScore = parseFloat(trimmed.replace('planQualityScore: ', ''));
        }
      }
    }

    if (!inEntries && !inFeatures) {
      if (trimmed.startsWith('totalScores: ')) {
        data.aggregates.plandescriber.totalScores = parseInt(trimmed.replace('totalScores: ', ''), 10);
      } else if (trimmed.startsWith('avgScore: ')) {
        data.aggregates.plandescriber.avgScore = parseFloat(trimmed.replace('avgScore: ', ''));
      } else if (trimmed.startsWith('lowScoreCount: ')) {
        data.aggregates.plandescriber.lowScoreCount = parseInt(trimmed.replace('lowScoreCount: ', ''), 10);
      }
    }

    if (inFeatures) {
      const featureMatch = trimmed.match(/^    (\S[^:]+):$/);
      if (featureMatch && trimmed.startsWith('    ') && !trimmed.startsWith('      ')) {
        currentFeature = featureMatch[1];
        if (!data.aggregates.features[currentFeature]) {
          data.aggregates.features[currentFeature] = { totalScores: 0, avgScore: 0 };
        }
      } else if (currentFeature && trimmed.startsWith('      totalScores: ')) {
        data.aggregates.features[currentFeature].totalScores = parseInt(trimmed.replace('      totalScores: ', ''), 10);
      } else if (currentFeature && trimmed.startsWith('      avgScore: ')) {
        data.aggregates.features[currentFeature].avgScore = parseFloat(trimmed.replace('      avgScore: ', ''));
      }
    }
  }

  // Push last entry if any
  if (currentEntry && currentEntry.pipelineId) {
    data.entries.push(currentEntry as PlanQualityEntry);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadData(): PlanQualityData {
  if (!fs.existsSync(PLAN_QUALITY_PATH)) {
    return {
      entries: [],
      aggregates: {
        plandescriber: { totalScores: 0, avgScore: 0, lowScoreCount: 0 },
        features: {},
      },
    };
  }
  try {
    const raw = fs.readFileSync(PLAN_QUALITY_PATH, 'utf-8');
    return deserializeYaml(raw);
  } catch (e) {
    console.error(`Error: Failed to parse plan-quality.yaml: ${(e as Error).message}`);
    process.exit(1);
  }
}

function saveData(data: PlanQualityData): void {
  ensureDir(path.dirname(PLAN_QUALITY_PATH));
  const yaml = serializeYaml(data);
  fs.writeFileSync(PLAN_QUALITY_PATH, yaml, 'utf-8');
}

function recalcAggregates(data: PlanQualityData): void {
  const allScores = data.entries.map(e => e.planQualityScore);
  const totalScores = allScores.length;
  const avgScore = totalScores > 0
    ? Math.round((allScores.reduce((s, v) => s + v, 0) / totalScores) * 100) / 100
    : 0;
  const lowScoreCount = allScores.filter(s => s < 70).length;

  data.aggregates.plandescriber = { totalScores, avgScore, lowScoreCount };

  // Per-feature aggregates
  const featureMap: Record<string, number[]> = {};
  for (const entry of data.entries) {
    if (!featureMap[entry.feature]) {
      featureMap[entry.feature] = [];
    }
    featureMap[entry.feature].push(entry.planQualityScore);
  }

  data.aggregates.features = {};
  for (const [feat, scores] of Object.entries(featureMap)) {
    const featTotal = scores.length;
    const featAvg = Math.round((scores.reduce((s, v) => s + v, 0) / featTotal) * 100) / 100;
    data.aggregates.features[feat] = { totalScores: featTotal, avgScore: featAvg };
  }
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function cmdRecord(
  pipelineId: string,
  feature: string,
  complianceScore: number,
  totalCheckpoints: number,
  failed: number,
  skipped: number,
  planOmissions: number,
  contractRulesTotal: number,
  contractRulesPassed: number,
  contractRulesFailed: number,
): void {
  if (totalCheckpoints <= 0) {
    console.error('Error: --total-checkpoints must be > 0');
    process.exit(1);
  }

  // Calculate plan quality score
  let complianceWeight: number;
  let contractRulesComponent: number;

  if (contractRulesTotal > 0) {
    complianceWeight = 0.5;
    contractRulesComponent = (contractRulesPassed / contractRulesTotal) * 100 * 0.2;
  } else {
    complianceWeight = 0.7;
    contractRulesComponent = 0;
  }

  const complianceComponent = complianceScore * complianceWeight;
  const failedRate = failed / totalCheckpoints;
  const checkpointComponent = (1 - failedRate) * 100 * 0.2;
  const omissionRate = planOmissions / totalCheckpoints;
  const omissionComponent = (1 - omissionRate) * 100 * 0.1;

  const planQualityScore = Math.round(
    (complianceComponent + checkpointComponent + omissionComponent + contractRulesComponent) * 100,
  ) / 100;

  const entry: PlanQualityEntry = {
    date: new Date().toISOString(),
    pipelineId,
    feature,
    complianceScore,
    totalCheckpoints,
    failedCheckpoints: failed,
    skippedCheckpoints: skipped,
    planOmissions,
    contractRulesTotal,
    contractRulesPassed,
    contractRulesFailed,
    planQualityScore,
  };

  const data = loadData();
  data.entries.push(entry);
  recalcAggregates(data);
  saveData(data);

  console.log(JSON.stringify({
    ok: true,
    action: 'record',
    pipelineId,
    feature,
    planQualityScore,
    components: {
      compliance: Math.round(complianceComponent * 100) / 100,
      checkpoints: Math.round(checkpointComponent * 100) / 100,
      planOmissions: Math.round(omissionComponent * 100) / 100,
      contractRules: Math.round(contractRulesComponent * 100) / 100,
    },
    contractRules: {
      total: contractRulesTotal,
      passed: contractRulesPassed,
      failed: contractRulesFailed,
    },
  }));
}

function cmdQuery(feature: string): void {
  const data = loadData();
  const featureEntries = data.entries.filter(e => e.feature === feature);

  if (featureEntries.length === 0) {
    console.log(JSON.stringify({
      ok: true,
      action: 'query',
      feature,
      found: false,
      totalEntries: 0,
      avgScore: null,
    }));
    return;
  }

  const scores = featureEntries.map(e => e.planQualityScore);
  const avgScore = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  console.log(JSON.stringify({
    ok: true,
    action: 'query',
    feature,
    found: true,
    totalEntries: scores.length,
    avgScore,
    minScore,
    maxScore,
    entries: featureEntries.map(e => ({
      date: e.date,
      pipelineId: e.pipelineId,
      planQualityScore: e.planQualityScore,
    })),
  }));
}

function cmdReport(): void {
  const data = loadData();

  if (data.entries.length === 0) {
    console.log('No plan quality records found.');
    return;
  }

  // Sort by score ascending (worst first)
  const sorted = [...data.entries].sort((a, b) => a.planQualityScore - b.planQualityScore);

  // Identify agents with low scores — group by feature
  const featureScores: Record<string, number[]> = {};
  for (const entry of data.entries) {
    if (!featureScores[entry.feature]) {
      featureScores[entry.feature] = [];
    }
    featureScores[entry.feature].push(entry.planQualityScore);
  }

  const lowScoringFeatures = Object.entries(featureScores)
    .map(([feat, scores]) => ({
      feature: feat,
      avgScore: Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100,
      count: scores.length,
    }))
    .filter(f => f.avgScore < 70)
    .sort((a, b) => a.avgScore - b.avgScore);

  const pdAvgScore = data.aggregates.plandescriber.avgScore;

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Plan Quality Report');
  console.log('═══════════════════════════════════════════');
  console.log(`  Total Records       : ${data.entries.length}`);
  console.log(`  PlanDescriber Avg   : ${pdAvgScore}`);
  console.log(`  Low Score (<70)     : ${data.aggregates.plandescriber.lowScoreCount}`);
  console.log('───────────────────────────────────────────');
  console.log('  Entries (worst first):');
  console.log('');

  for (const entry of sorted) {
    const icon = entry.planQualityScore >= 85 ? '✅' : entry.planQualityScore >= 70 ? '⚠️' : '❌';
    console.log(`    ${icon} [${entry.pipelineId}] ${entry.feature}`);
    console.log(`       Score  : ${entry.planQualityScore}`);
    console.log(`       Date   : ${entry.date}`);
    console.log(`       Comply : ${entry.complianceScore}%`);
    console.log(`       Checks : ${entry.failedCheckpoints}/${entry.totalCheckpoints} failed`);
    console.log(`               ${entry.skippedCheckpoints} skipped, ${entry.planOmissions} omissions`);
    console.log('');
  }

  if (lowScoringFeatures.length > 0) {
    console.log('───────────────────────────────────────────');
    console.log('  Low-Scoring Features (<70 avg):');
    for (const f of lowScoringFeatures) {
      console.log(`    ❌ ${f.feature}: ${f.avgScore} avg (${f.count} records)`);
    }
    console.log('');
  }

  if (pdAvgScore < 70) {
    console.log('  ⚠️ PlanDescriber quality below threshold — recommend skill update');
    console.log(`    (avg: ${pdAvgScore}, threshold: 70)`);
  } else if (pdAvgScore < 85) {
    console.log(`  ℹ️ PlanDescriber quality acceptable (${pdAvgScore}), room for improvement (target: 85+)`);
  } else {
    console.log(`  ✅ PlanDescriber quality good (${pdAvgScore})`);
  }
  console.log('═══════════════════════════════════════════');
  console.log('');
}

function cmdQueryPlanDescriber(): void {
  const data = loadData();
  const avgScore = data.aggregates.plandescriber.avgScore;
  const totalScores = data.aggregates.plandescriber.totalScores;
  const lowScoreCount = data.aggregates.plandescriber.lowScoreCount;

  console.log(JSON.stringify({
    ok: true,
    action: 'query-plan-describer',
    avgScore,
    totalScores,
    lowScoreCount,
    threshold: '70 = escalation, 70-85 = warning, >=85 = good',
  }));

  if (avgScore < 70 && totalScores > 0) {
    process.exit(2); // Escalation trigger
  } else if (avgScore < 85 && totalScores > 0) {
    process.exit(1); // Warning
  } else {
    process.exit(0); // Good
  }
}

function cmdCheckContractRules(feature: string): void {
  const data = loadData();
  const featureEntries = data.entries.filter(e => e.feature === feature);

  if (featureEntries.length === 0) {
    console.log(JSON.stringify({
      ok: true,
      action: 'check-contract-rules',
      feature,
      found: false,
      totalEntries: 0,
      avgContractRulePassRate: null,
      verdict: 'no_data',
    }));
    process.exit(0);
    return;
  }

  // Compute average contract rule pass rate across all entries
  let totalContractRulesTotal = 0;
  let totalContractRulesPassed = 0;

  for (const entry of featureEntries) {
    if (entry.contractRulesTotal > 0) {
      totalContractRulesTotal += entry.contractRulesTotal;
      totalContractRulesPassed += entry.contractRulesPassed;
    }
  }

  const avgPassRate = totalContractRulesTotal > 0
    ? Math.round((totalContractRulesPassed / totalContractRulesTotal) * 10000) / 100
    : 100; // No contract rules recorded — assume pass

  let exitCode: number;
  let verdict: string;

  if (avgPassRate >= 80) {
    exitCode = 0;
    verdict = 'pass';
  } else if (avgPassRate >= 60) {
    exitCode = 1;
    verdict = 'warning';
  } else {
    exitCode = 2;
    verdict = 'fail';
  }

  console.log(JSON.stringify({
    ok: true,
    action: 'check-contract-rules',
    feature,
    found: true,
    totalEntries: featureEntries.length,
    avgContractRulePassRate: avgPassRate,
    contractRulesTotal: totalContractRulesTotal,
    contractRulesPassed: totalContractRulesPassed,
    verdict,
    threshold: '>=80% = pass (exit 0), 60-80% = warning (exit 1), <60% = fail (exit 2)',
  }));

  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Plan Quality Score Script');
    console.log('');
    console.log('Usage:');
    console.log('  [runtime] plan-quality-score.ts --record --pipeline-id=<id> --feature=<name>');
    console.log('    --compliance-score=<N> --total-checkpoints=<N> --failed=<N>');
    console.log('    --skipped=<N> --plan-omissions=<N>');
    console.log('    [--contract-rules-total=<N> --contract-rules-passed=<N> --contract-rules-failed=<N>]');
    console.log('  [runtime] plan-quality-score.ts --query --feature=<name>');
    console.log('  [runtime] plan-quality-score.ts --report');
    console.log('  [runtime] plan-quality-score.ts --query-plan-describer');
    console.log('  [runtime] plan-quality-score.ts --check-contract-rules --feature=<name>');
    process.exit(0);
  }

  const get = (prefix: string): string | undefined => {
    const a = args.find(a => a.startsWith(prefix));
    return a ? a.split('=')[1] : undefined;
  };

  const hasFlag = (flag: string): boolean => args.includes(flag);

  const pipelineId = get('--pipeline-id=');
  const feature = get('--feature=');

  // --record
  if (hasFlag('--record')) {
    const complianceScoreStr = get('--compliance-score=');
    const totalCheckpointsStr = get('--total-checkpoints=');
    const failedStr = get('--failed=');
    const skippedStr = get('--skipped=');
    const planOmissionsStr = get('--plan-omissions=');
    const contractRulesTotalStr = get('--contract-rules-total=');
    const contractRulesPassedStr = get('--contract-rules-passed=');
    const contractRulesFailedStr = get('--contract-rules-failed=');

    if (!pipelineId || !feature || !complianceScoreStr || !totalCheckpointsStr || !failedStr || !skippedStr || !planOmissionsStr) {
      console.error('Error: --record requires --pipeline-id=<id> --feature=<name> --compliance-score=<N> --total-checkpoints=<N> --failed=<N> --skipped=<N> --plan-omissions=<N>');
      process.exit(1);
    }

    const complianceScore = parseFloat(complianceScoreStr);
    const totalCheckpoints = parseInt(totalCheckpointsStr, 10);
    const failed = parseInt(failedStr, 10);
    const skipped = parseInt(skippedStr, 10);
    const planOmissions = parseInt(planOmissionsStr, 10);
    const contractRulesTotal = contractRulesTotalStr ? parseInt(contractRulesTotalStr, 10) : 0;
    const contractRulesPassed = contractRulesPassedStr ? parseInt(contractRulesPassedStr, 10) : 0;
    const contractRulesFailed = contractRulesFailedStr ? parseInt(contractRulesFailedStr, 10) : 0;

    if (isNaN(complianceScore) || isNaN(totalCheckpoints) || isNaN(failed) || isNaN(skipped) || isNaN(planOmissions) || isNaN(contractRulesTotal) || isNaN(contractRulesPassed) || isNaN(contractRulesFailed)) {
      console.error('Error: All numeric arguments must be valid numbers');
      process.exit(1);
    }

    cmdRecord(pipelineId, feature, complianceScore, totalCheckpoints, failed, skipped, planOmissions, contractRulesTotal, contractRulesPassed, contractRulesFailed);
    return;
  }

  // --query --feature
  if (hasFlag('--query') && !hasFlag('--query-plan-describer')) {
    if (!feature) {
      console.error('Error: --query requires --feature=<name>');
      process.exit(1);
    }
    cmdQuery(feature);
    return;
  }

  // --report
  if (hasFlag('--report')) {
    cmdReport();
    return;
  }

  // --query-plan-describer
  if (hasFlag('--query-plan-describer')) {
    cmdQueryPlanDescriber();
    return;
  }

  // --check-contract-rules
  if (hasFlag('--check-contract-rules')) {
    if (!feature) {
      console.error('Error: --check-contract-rules requires --feature=<name>');
      process.exit(1);
    }
    cmdCheckContractRules(feature);
    return;
  }

  console.error('Error: Unknown command. See usage above.');
  console.error(`Received args: ${args.join(' ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (require.main === module) {
  parseArgs();
}
