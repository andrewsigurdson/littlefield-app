import { useMemo } from 'react';
import type { Config } from '../types';
import { runSimulationForCash } from '../utils/simulationEngine';

interface InventoryState {
  inventory: number;
  orderInTransit: boolean;
  orderArrivalDay: number;
}

interface Recommendations {
  analysis: {
    currentDay: number;
    avgLeadTime: number;
    debt: number;
    cash: number;
    avgQueuedJobs: number;
    avgQueue1?: number;
    avgQueue2?: number;
    avgQueue3?: number;
  };
}

interface Projection {
  avgJobsPerDay: number;
  totalMachineCost?: number;
  upfrontFee?: number;
  newDebt?: number;
}

interface OptimalSettings {
  lotSize: { value: number; cash: number };
  contract: { value: number; cash: number };
  materialReorderPoint: { value: number; cash: number };
  materialOrderQty: { value: number; cash: number };
  station1Machines: { value: number; cash: number };
  station2Machines: { value: number; cash: number };
  station3Machines: { value: number; cash: number };
}

/**
 * Finds the optimal value for each setting independently
 * For each setting, keeps all other settings the same and finds the value that maximizes cash
 */
export function useOptimalSettings(
  recommendations: Recommendations | null,
  projection: Projection | null,
  currentSettings: Config,
  inventoryState: InventoryState,
  avgArrivalRate: number
): OptimalSettings | null {
  return useMemo(() => {
    if (!recommendations || !projection) return null;

    const optimal: OptimalSettings = {
      lotSize: { value: currentSettings.lotSize, cash: 0 },
      contract: { value: currentSettings.contract, cash: 0 },
      materialReorderPoint: { value: currentSettings.materialReorderPoint, cash: 0 },
      materialOrderQty: { value: currentSettings.materialOrderQty, cash: 0 },
      station1Machines: { value: currentSettings.station1Machines, cash: 0 },
      station2Machines: { value: currentSettings.station2Machines, cash: 0 },
      station3Machines: { value: currentSettings.station3Machines, cash: 0 }
    };

    // Test lot sizes
    const lotSizes = [15, 20, 30, 60];
    for (const lotSize of lotSizes) {
      const testConfig = { ...currentSettings, lotSize };
      const finalCash = runSimulationForCash(recommendations, projection, testConfig, inventoryState, avgArrivalRate);
      if (finalCash > optimal.lotSize.cash) {
        optimal.lotSize = { value: lotSize, cash: finalCash };
      }
    }

    // Test contracts
    const contracts = [1, 2, 3];
    for (const contract of contracts) {
      const testConfig = { ...currentSettings, contract };
      const finalCash = runSimulationForCash(recommendations, projection, testConfig, inventoryState, avgArrivalRate);
      if (finalCash > optimal.contract.cash) {
        optimal.contract = { value: contract, cash: finalCash };
      }
    }

    // Test Station 1 Machines (1-5)
    for (let machines = 1; machines <= 5; machines++) {
      const testConfig = { ...currentSettings, station1Machines: machines };
      const finalCash = runSimulationForCash(recommendations, projection, testConfig, inventoryState, avgArrivalRate);
      if (finalCash > optimal.station1Machines.cash) {
        optimal.station1Machines = { value: machines, cash: finalCash };
      }
    }

    // Test Station 2 Machines (1-5)
    for (let machines = 1; machines <= 5; machines++) {
      const testConfig = { ...currentSettings, station2Machines: machines };
      const finalCash = runSimulationForCash(recommendations, projection, testConfig, inventoryState, avgArrivalRate);
      if (finalCash > optimal.station2Machines.cash) {
        optimal.station2Machines = { value: machines, cash: finalCash };
      }
    }

    // Test Station 3 Machines (1-5)
    for (let machines = 1; machines <= 5; machines++) {
      const testConfig = { ...currentSettings, station3Machines: machines };
      const finalCash = runSimulationForCash(recommendations, projection, testConfig, inventoryState, avgArrivalRate);
      if (finalCash > optimal.station3Machines.cash) {
        optimal.station3Machines = { value: machines, cash: finalCash };
      }
    }

    // Test Material Reorder Point (test around current value)
    const currentROP = currentSettings.materialReorderPoint;
    const ropTestValues = [
      Math.max(0, currentROP - 1000),
      Math.max(0, currentROP - 500),
      currentROP,
      currentROP + 500,
      currentROP + 1000,
      currentROP + 2000,
      0, // Also test 0
      500,
      1000,
      1500,
      2000,
      3000
    ];
    for (const rop of ropTestValues) {
      const testConfig = { ...currentSettings, materialReorderPoint: rop };
      const finalCash = runSimulationForCash(recommendations, projection, testConfig, inventoryState, avgArrivalRate);
      if (finalCash > optimal.materialReorderPoint.cash) {
        optimal.materialReorderPoint = { value: rop, cash: finalCash };
      }
    }

    // Test Material Order Quantity (test around current value)
    const currentQty = currentSettings.materialOrderQty;
    const qtyTestValues = [
      Math.max(1000, currentQty - 3000),
      Math.max(1000, currentQty - 1000),
      currentQty,
      currentQty + 1000,
      currentQty + 3000,
      currentQty + 5000,
      1000,
      2000,
      3000,
      5000,
      7000,
      10000
    ];
    for (const qty of qtyTestValues) {
      const testConfig = { ...currentSettings, materialOrderQty: qty };
      const finalCash = runSimulationForCash(recommendations, projection, testConfig, inventoryState, avgArrivalRate);
      if (finalCash > optimal.materialOrderQty.cash) {
        optimal.materialOrderQty = { value: qty, cash: finalCash };
      }
    }

    return optimal;
  }, [recommendations, projection, currentSettings, inventoryState, avgArrivalRate]);
}
