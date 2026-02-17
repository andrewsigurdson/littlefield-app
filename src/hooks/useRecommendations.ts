import { useMemo } from 'react';
import type { Config, Change, Analysis, Bottleneck } from '../types';
import type { ParsedData } from './useDataParsing';

export function useRecommendations(
  parsedData: ParsedData[],
  cashOnHand: string,
  debt: string,
  currentSettings: Config
) {
  return useMemo(() => {
    if (parsedData.length === 0) return null;

    const recentData = parsedData.slice(-14);
    const lastDay = parsedData[parsedData.length - 1];

    const avgUtil1 = recentData.reduce((sum, d) => sum + d.util1, 0) / recentData.length;
    const avgUtil2 = recentData.reduce((sum, d) => sum + d.util2, 0) / recentData.length;
    const avgUtil3 = recentData.reduce((sum, d) => sum + d.util3, 0) / recentData.length;

    const avgQueue1 = recentData.reduce((sum, d) => sum + d.queue1, 0) / recentData.length;
    const avgQueue2 = recentData.reduce((sum, d) => sum + d.queue2, 0) / recentData.length;
    const avgQueue3 = recentData.reduce((sum, d) => sum + d.queue3, 0) / recentData.length;

    const avgLeadTime = recentData.reduce((sum, d) => sum + d.leadTime, 0) / recentData.length;
    const maxLeadTime = Math.max(...recentData.map(d => d.leadTime));

    const avgQueuedJobs = recentData.reduce((sum, d) => sum + d.queuedJobs, 0) / recentData.length;

    const cash = parseFloat(cashOnHand) || 0;
    const debtAmt = parseFloat(debt) || 0;
    const netCash = cash - debtAmt;

    const machineCosts = { station1: 90, station2: 80, station3: 100 };

    const recs: Config & { changes: Change[]; analysis: Analysis } = {
      lotSize: currentSettings.lotSize,
      contract: currentSettings.contract,
      station1Machines: currentSettings.station1Machines,
      station2Machines: currentSettings.station2Machines,
      station3Machines: currentSettings.station3Machines,
      station2Priority: currentSettings.station2Priority,
      materialReorderPoint: currentSettings.materialReorderPoint,
      materialOrderQty: currentSettings.materialOrderQty,
      changes: [],
      analysis: {} as Analysis
    };

    recs.analysis = {
      avgUtil1,
      avgUtil2,
      avgUtil3,
      avgQueue1,
      avgQueue2,
      avgQueue3,
      avgLeadTime,
      maxLeadTime,
      avgQueuedJobs,
      netCash,
      currentDay: lastDay.day,
      cash,
      debt: debtAmt
    };

    const bottlenecks: Bottleneck[] = [];

    if (avgUtil2 > 0.85 && avgQueue2 > 100) {
      bottlenecks.push({
        station: 2,
        priority: 1,
        util: avgUtil2,
        queue: avgQueue2,
        cost: machineCosts.station2
      });
    }

    if (avgUtil1 > 0.85 && avgQueue1 > 100) {
      bottlenecks.push({
        station: 1,
        priority: 2,
        util: avgUtil1,
        queue: avgQueue1,
        cost: machineCosts.station1
      });
    }

    if (avgUtil3 > 0.85 && avgQueue3 > 50) {
      bottlenecks.push({
        station: 3,
        priority: 3,
        util: avgUtil3,
        queue: avgQueue3,
        cost: machineCosts.station3
      });
    }

    bottlenecks.sort((a, b) => a.priority - b.priority);

    // Can use debt to purchase machines
    for (const bn of bottlenecks) {
      if (bn.station === 1 && recs.station1Machines < 5) {
        recs.station1Machines++;
        const needsDebt = cash < bn.cost;
        recs.changes.push({
          type: 'capacity',
          action: `Add 1 machine to Station 1 (Stuffer)`,
          reason: `High utilization (${(bn.util * 100).toFixed(1)}%) and queue (${bn.queue.toFixed(0)} kits)`,
          cost: bn.cost,
          needsDebt,
          priority: 'HIGH'
        });
      } else if (bn.station === 2 && recs.station2Machines < 5) {
        recs.station2Machines++;
        const needsDebt = cash < bn.cost;
        recs.changes.push({
          type: 'capacity',
          action: `Add 1 machine to Station 2 (Tester)`,
          reason: `Critical bottleneck - utilization ${(bn.util * 100).toFixed(1)}%, queue ${bn.queue.toFixed(0)} kits`,
          cost: bn.cost,
          needsDebt,
          priority: 'CRITICAL'
        });
      } else if (bn.station === 3 && recs.station3Machines < 5) {
        recs.station3Machines++;
        const needsDebt = cash < bn.cost;
        recs.changes.push({
          type: 'capacity',
          action: `Add 1 machine to Station 3 (Tuner)`,
          reason: `High utilization (${(bn.util * 100).toFixed(1)}%) and queue (${bn.queue.toFixed(0)} kits)`,
          cost: bn.cost,
          needsDebt,
          priority: 'HIGH'
        });
      }
    }

    if (avgQueuedJobs > 2 || avgQueue1 > 200) {
      if (currentSettings.station2Priority !== 'Step 2') {
        recs.station2Priority = 'Step 2';
        recs.changes.push({
          type: 'priority',
          action: 'Change Station 2 priority to Step 2 (first test)',
          reason: `${avgQueuedJobs.toFixed(1)} jobs waiting for kits on average`,
          cost: 0,
          priority: 'MEDIUM'
        });
      }
    } else {
      if (currentSettings.station2Priority !== 'Step 4') {
        recs.station2Priority = 'Step 4';
        recs.changes.push({
          type: 'priority',
          action: 'Change Station 2 priority to Step 4 (final test)',
          reason: 'Prioritize completing jobs faster',
          cost: 0,
          priority: 'MEDIUM'
        });
      }
    }

    if (avgLeadTime < 0.8 && maxLeadTime < 1.0) {
      if (currentSettings.contract !== 3) {
        recs.contract = 3;
        recs.changes.push({
          type: 'contract',
          action: 'UPGRADE to Contract 3 (0.5 day, $1,250)',
          reason: `Avg lead time ${avgLeadTime.toFixed(2)} days, max ${maxLeadTime.toFixed(2)} days`,
          cost: 0,
          priority: 'HIGH'
        });
      }
    } else if (avgLeadTime < 1.5 && maxLeadTime < 3.0) {
      if (currentSettings.contract === 1) {
        recs.contract = 2;
        recs.changes.push({
          type: 'contract',
          action: 'UPGRADE to Contract 2 (1 day, $1,000)',
          reason: `Avg lead time ${avgLeadTime.toFixed(2)} days`,
          cost: 0,
          priority: 'HIGH'
        });
      }
    } else if (avgLeadTime > 5.0 || maxLeadTime > 10.0) {
      if (currentSettings.contract !== 1) {
        recs.contract = 1;
        recs.changes.push({
          type: 'contract',
          action: 'DOWNGRADE to Contract 1 (7 day, $750)',
          reason: `Lead time too high (avg ${avgLeadTime.toFixed(2)}, max ${maxLeadTime.toFixed(2)})`,
          cost: 0,
          priority: 'CRITICAL'
        });
      }
    }

    if (avgQueue1 > 300 && avgQueue2 > 300 && avgQueue3 > 100) {
      if (currentSettings.lotSize < 30) {
        recs.lotSize = 30;
        recs.changes.push({
          type: 'lotSize',
          action: 'INCREASE lot size to 30 kits',
          reason: 'High queues across all stations',
          cost: 0,
          priority: 'MEDIUM'
        });
      }
    } else if (avgLeadTime > 3.0 && avgUtil1 < 0.7 && avgUtil2 < 0.7 && avgUtil3 < 0.7) {
      if (currentSettings.lotSize > 12) {
        recs.lotSize = 12;
        recs.changes.push({
          type: 'lotSize',
          action: 'DECREASE lot size to 12 kits',
          reason: 'High lead time but low utilization',
          cost: 0,
          priority: 'LOW'
        });
      }
    }

    if (recs.changes.length === 0) {
      recs.changes.push({
        type: 'none',
        action: 'No changes recommended',
        reason: 'Current configuration appears optimal',
        cost: 0,
        priority: 'INFO'
      });
    }

    return recs;
  }, [parsedData, cashOnHand, debt, currentSettings]);
}
