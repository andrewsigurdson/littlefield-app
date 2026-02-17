import type { Config } from '../types';

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

/**
 * Runs a simulation and returns the final cash value
 * This is used for optimization to test different configurations
 */
interface Change {
  type: string;
  action: string;
  cost: number;
  recommendedDay?: number;
  needsDebt?: boolean;
}

interface RecommendationsWithTiming extends Recommendations {
  changes: Change[];
  lotSize: number;
  contract: number;
  station1Machines: number;
  station2Machines: number;
  station3Machines: number;
  station2Priority: string;
  materialReorderPoint: number;
  materialOrderQty: number;
}

interface Job {
  id: number;
  startDay: number;
  contractType: number;
  promisedLeadTime: number;
  maxLeadTime: number;
  revenue: number;
  totalLots: number;
  completedLots: number;
  completionDay?: number;
}

interface Lot {
  id: number;
  jobId: number;
  currentStation: 1 | 2 | 3 | 4 | 'complete';
  arrivalAtCurrentStation: number;
}

/**
 * Simulates following the strategic timeline - applying changes on their recommended days
 * Uses the same detailed lot-based discrete-event simulation as useProjectionData
 * Returns the final cash value after following the entire strategic plan
 */
export function runTimelineSimulation(
  recommendations: RecommendationsWithTiming | null,
  initialSettings: Config,
  avgArrivalRate: number
): number {
  if (!recommendations) return 0;

  const currentDay = recommendations.analysis.currentDay;
  const daysRemaining = 318 - currentDay;
  const dailyDebtInterestRate = Math.pow(1.20, 1 / 365) - 1;
  const dailyCashInterestRate = Math.pow(1.10, 1 / 365) - 1;

  let runningCash = recommendations.analysis.cash;
  let runningDebt = recommendations.analysis.debt;
  let currentSettings = { ...initialSettings };

  const kitsPerJob = 60;
  const costPerKit = 0.010;
  const fixedOrderCost = 1.0;

  const processingTimesByLot: Record<number, { s1: number; s2: number; s3: number; s4: number }> = {
    12: { s1: 2.42/24, s2: 0.28/24, s3: 0.40/24, s4: 0.24/24 },
    15: { s1: 2.68/24, s2: 0.35/24, s3: 0.48/24, s4: 0.30/24 },
    20: { s1: 3.10/24, s2: 0.47/24, s3: 0.61/24, s4: 0.40/24 },
    30: { s1: 3.95/24, s2: 0.71/24, s3: 0.95/24, s4: 0.60/24 },
    60: { s1: 6.50/24, s2: 1.42/24, s3: 1.85/24, s4: 1.20/24 }
  };

  const contracts: Record<number, { promised: number; max: number; revenue: number }> = {
    1: { promised: 7, max: 14, revenue: 750 },
    2: { promised: 1, max: 5, revenue: 1000 },
    3: { promised: 0.5, max: 1, revenue: 1250 }
  };

  // Initialize lot-based simulation state
  const jobs = new Map<number, Job>();
  const lots: Lot[] = [];
  let nextJobId = 1;
  let nextLotId = 1;
  const waitingForKits: number[] = [];

  // Initialize material inventory
  const orderQuantity = Math.max(0, initialSettings.materialOrderQty);
  const reorderPoint = Math.max(0, initialSettings.materialReorderPoint);
  const materialLeadTimeDays = 4;

  let kitsInventory = 1000;
  let orderInTransit = false;
  let orderArrivalDay = 0;

  // Initialize WIP from historical queue data
  const avgQueue1 = recommendations.analysis.avgQueue1 || 0;
  const avgQueue2 = recommendations.analysis.avgQueue2 || 0;
  const avgQueue3 = recommendations.analysis.avgQueue3 || 0;

  const lotSize = initialSettings.lotSize || 20;
  const lotsPerJob = 60 / lotSize;

  const lotsAtS1 = Math.min(Math.round(avgQueue1 / lotSize), 200);
  const totalStation2Lots = avgQueue2 / lotSize;
  const procTimes = processingTimesByLot[lotSize] || processingTimesByLot[20];
  const test1Fraction = procTimes.s2 / (procTimes.s2 + procTimes.s4);
  const test4Fraction = procTimes.s4 / (procTimes.s2 + procTimes.s4);
  const lotsAtS2 = Math.min(Math.round(totalStation2Lots * test1Fraction), 50);
  const lotsAtS3 = Math.min(Math.round(avgQueue3 / lotSize), 50);
  const lotsAtS4 = Math.round(totalStation2Lots * test4Fraction);

  const totalWIPLots = lotsAtS1 + lotsAtS2 + lotsAtS3 + lotsAtS4;
  const totalJobs = Math.floor(totalWIPLots / lotsPerJob);
  const historicalLeadTime = recommendations.analysis.avgLeadTime || 2.0;
  const estimatedStartDay = currentDay - historicalLeadTime;

  // Create initial jobs and lots
  for (let i = 0; i < totalJobs; i++) {
    const contract = contracts[initialSettings.contract as keyof typeof contracts];
    const job: Job = {
      id: nextJobId++,
      startDay: estimatedStartDay + (i / totalJobs) * historicalLeadTime,
      contractType: initialSettings.contract,
      promisedLeadTime: contract.promised,
      maxLeadTime: contract.max,
      revenue: contract.revenue,
      totalLots: lotsPerJob,
      completedLots: 0
    };
    jobs.set(job.id, job);
  }

  const jobArray = Array.from(jobs.values()).sort((a, b) => a.startDay - b.startDay);

  // Assign lots to jobs (fill from S4 backwards to S1)
  let remainingS4 = lotsAtS4;
  let remainingS3 = lotsAtS3;
  let remainingS2 = lotsAtS2;
  let remainingS1 = lotsAtS1;

  for (let i = 0; i < totalJobs; i++) {
    const job = jobArray[i];
    let lotsNeeded = lotsPerJob;

    const lotsFromS4 = Math.min(lotsNeeded, remainingS4);
    for (let j = 0; j < lotsFromS4; j++) {
      lots.push({ id: nextLotId++, jobId: job.id, currentStation: 4, arrivalAtCurrentStation: currentDay });
    }
    remainingS4 -= lotsFromS4;
    lotsNeeded -= lotsFromS4;

    const lotsFromS3 = Math.min(lotsNeeded, remainingS3);
    for (let j = 0; j < lotsFromS3; j++) {
      lots.push({ id: nextLotId++, jobId: job.id, currentStation: 3, arrivalAtCurrentStation: currentDay });
    }
    remainingS3 -= lotsFromS3;
    lotsNeeded -= lotsFromS3;

    const lotsFromS2 = Math.min(lotsNeeded, remainingS2);
    for (let j = 0; j < lotsFromS2; j++) {
      lots.push({ id: nextLotId++, jobId: job.id, currentStation: 2, arrivalAtCurrentStation: currentDay });
    }
    remainingS2 -= lotsFromS2;
    lotsNeeded -= lotsFromS2;

    const lotsFromS1 = Math.min(lotsNeeded, remainingS1);
    for (let j = 0; j < lotsFromS1; j++) {
      lots.push({ id: nextLotId++, jobId: job.id, currentStation: 1, arrivalAtCurrentStation: currentDay });
    }
    remainingS1 -= lotsFromS1;
  }

  // Poisson random number generator
  function randomPoisson(lambda: number, seed: number): number {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    const random = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };
    do {
      k++;
      p *= random();
    } while (p > L);
    return k - 1;
  }

  // Daily simulation loop
  for (let dayOffset = 0; dayOffset < daysRemaining; dayOffset++) {
    const simulationDay = currentDay + dayOffset + 1;

    // Apply configuration changes for this day
    for (const change of recommendations.changes) {
      if (change.recommendedDay === simulationDay && change.type !== 'none') {
        if (change.type === 'capacity') {
          if (change.action.includes('Station 1')) {
            currentSettings.station1Machines++;
          } else if (change.action.includes('Station 2')) {
            currentSettings.station2Machines++;
          } else if (change.action.includes('Station 3')) {
            currentSettings.station3Machines++;
          }

          // Pay for the machine
          if (change.needsDebt) {
            runningDebt += change.cost;
          } else {
            runningCash -= change.cost;
          }
        } else if (change.type === 'contract') {
          if (change.action.includes('Contract 1')) {
            currentSettings.contract = 1;
          } else if (change.action.includes('Contract 2')) {
            currentSettings.contract = 2;
          } else if (change.action.includes('Contract 3')) {
            currentSettings.contract = 3;
          }
        } else if (change.type === 'lotSize') {
          const match = change.action.match(/to (\d+)/);
          if (match) {
            currentSettings.lotSize = parseInt(match[1]);
          }
        }
      }
    }

    // Get current processing times based on current settings
    const currentLotSize = currentSettings.lotSize || 20;
    const currentLotsPerJob = 60 / currentLotSize;
    const currentProcTimes = processingTimesByLot[currentLotSize] || processingTimesByLot[20];
    const currentContract = contracts[currentSettings.contract as keyof typeof contracts];

    // Calculate current station capacities
    const serviceRateS1Total = (1 / currentProcTimes.s1) * currentSettings.station1Machines;
    const serviceRateS3 = 1 / currentProcTimes.s3;
    const capacityS1Daily = serviceRateS1Total * 24;
    const capacityS3Daily = serviceRateS3 * 24;

    // Material order arrival
    if (orderInTransit && simulationDay >= orderArrivalDay) {
      kitsInventory += orderQuantity;
      orderInTransit = false;
    }

    // Process waiting for kits queue
    while (waitingForKits.length > 0 && kitsInventory >= kitsPerJob) {
      const jobId = waitingForKits.shift()!;
      const job = jobs.get(jobId)!;
      job.startDay = simulationDay;
      kitsInventory -= kitsPerJob;

      // Create lots for this job
      for (let l = 0; l < currentLotsPerJob; l++) {
        lots.push({
          id: nextLotId++,
          jobId: job.id,
          currentStation: 1,
          arrivalAtCurrentStation: simulationDay
        });
      }
    }

    // New job arrivals (Poisson distribution)
    const arrivals = randomPoisson(avgArrivalRate || 10, simulationDay * 137);
    const newLotsToday: Lot[] = [];

    for (let j = 0; j < arrivals; j++) {
      const job: Job = {
        id: nextJobId++,
        startDay: simulationDay,
        contractType: currentSettings.contract,
        promisedLeadTime: currentContract.promised,
        maxLeadTime: currentContract.max,
        revenue: currentContract.revenue,
        totalLots: currentLotsPerJob,
        completedLots: 0
      };
      jobs.set(job.id, job);

      if (kitsInventory >= kitsPerJob) {
        kitsInventory -= kitsPerJob;

        // Create lots
        for (let l = 0; l < currentLotsPerJob; l++) {
          newLotsToday.push({
            id: nextLotId++,
            jobId: job.id,
            currentStation: 1,
            arrivalAtCurrentStation: simulationDay + (j / arrivals)
          });
        }
      } else {
        waitingForKits.push(job.id);
      }
    }

    // Process lots through stations
    const lotsAtS4Array = lots.filter(l => l.currentStation === 4).sort((a, b) => a.arrivalAtCurrentStation - b.arrivalAtCurrentStation);
    const lotsAtS3Array = lots.filter(l => l.currentStation === 3).sort((a, b) => a.arrivalAtCurrentStation - b.arrivalAtCurrentStation);
    const lotsAtS2Array = lots.filter(l => l.currentStation === 2).sort((a, b) => a.arrivalAtCurrentStation - b.arrivalAtCurrentStation);
    const lotsAtS1Array = lots.filter(l => l.currentStation === 1).sort((a, b) => a.arrivalAtCurrentStation - b.arrivalAtCurrentStation);

    const lotsS1ToProcess = Math.min(lotsAtS1Array.length, Math.floor(capacityS1Daily));
    const lotsS3ToProcess = Math.min(lotsAtS3Array.length, Math.floor(capacityS3Daily));

    // Station 2 handles both S2 and S4
    const totalS2andS4Demand = lotsAtS2Array.length + lotsAtS4Array.length;
    let lotsS2ToProcess = 0;
    let lotsS4ToProcess = 0;

    if (totalS2andS4Demand > 0) {
      const s2FractionOfDemand = lotsAtS2Array.length / totalS2andS4Demand;
      const s4FractionOfDemand = lotsAtS4Array.length / totalS2andS4Demand;
      const timeAvailable = currentSettings.station2Machines * 24;
      const timeForS2 = timeAvailable * s2FractionOfDemand;
      const timeForS4 = timeAvailable * s4FractionOfDemand;
      const lotsS2FromTime = timeForS2 / currentProcTimes.s2;
      const lotsS4FromTime = timeForS4 / currentProcTimes.s4;
      lotsS2ToProcess = Math.min(lotsAtS2Array.length, Math.floor(lotsS2FromTime));
      lotsS4ToProcess = Math.min(lotsAtS4Array.length, Math.floor(lotsS4FromTime));
    }

    // Process lots (reverse order for cascading)
    for (let i = 0; i < lotsS4ToProcess; i++) {
      const lot = lotsAtS4Array[i];
      lot.currentStation = 'complete';
      const job = jobs.get(lot.jobId)!;
      job.completedLots++;
    }

    for (let i = 0; i < lotsS3ToProcess; i++) {
      lotsAtS3Array[i].currentStation = 4;
      lotsAtS3Array[i].arrivalAtCurrentStation = simulationDay;
    }

    for (let i = 0; i < lotsS2ToProcess; i++) {
      lotsAtS2Array[i].currentStation = 3;
      lotsAtS2Array[i].arrivalAtCurrentStation = simulationDay;
    }

    for (let i = 0; i < lotsS1ToProcess; i++) {
      lotsAtS1Array[i].currentStation = 2;
      lotsAtS1Array[i].arrivalAtCurrentStation = simulationDay;
    }

    // Add new arrivals
    lots.push(...newLotsToday);

    // Check job completions and calculate revenue
    let dailyRev = 0;
    for (const job of jobs.values()) {
      if (!job.completionDay && job.completedLots === job.totalLots) {
        job.completionDay = simulationDay;
        const leadTime = simulationDay - job.startDay;
        let revenue = 0;
        if (leadTime <= job.promisedLeadTime) {
          revenue = job.revenue;
        } else if (leadTime < job.maxLeadTime) {
          const fraction = (job.maxLeadTime - leadTime) / (job.maxLeadTime - job.promisedLeadTime);
          revenue = job.revenue * fraction;
        }
        dailyRev += revenue / 1000;
      }
    }

    // Financial calculations
    const cashInterestEarned = runningCash > 0 ? runningCash * dailyCashInterestRate : 0;
    const debtInterestPaid = runningDebt > 0 ? runningDebt * dailyDebtInterestRate : 0;
    const netInterest = cashInterestEarned - debtInterestPaid;
    const cashAfterRevenue = runningCash + dailyRev + netInterest;

    let materialCost = 0;
    const orderCost = (orderQuantity * costPerKit) + fixedOrderCost;
    if (kitsInventory <= reorderPoint && !orderInTransit && orderQuantity > 0 && cashAfterRevenue >= orderCost) {
      materialCost = orderCost;
      orderInTransit = true;
      orderArrivalDay = simulationDay + materialLeadTimeDays;
    }

    const netProfit = dailyRev + netInterest - materialCost;
    runningCash += netProfit;

    // Debt repayment
    if (runningDebt > 0 && runningCash > 10) {
      const debtPayment = Math.min(runningDebt, runningCash - 10);
      runningCash -= debtPayment;
      runningDebt -= debtPayment;
    }
  }

  return runningCash;
}

export function runSimulationForCash(
  recommendations: Recommendations | null,
  projection: Projection | null,
  settings: Config,
  _inventoryState: InventoryState,
  avgArrivalRate: number
): number {
  if (!recommendations || !projection || projection.avgJobsPerDay <= 0) {
    return 0;
  }

  const currentDay = recommendations.analysis.currentDay;
  const daysRemaining = 318 - currentDay;
  const dailyDebtInterestRate = Math.pow(1.20, 1 / 365) - 1;
  const dailyCashInterestRate = Math.pow(1.10, 1 / 365) - 1;

  // Account for machine purchases and debt
  const machineCost = projection.totalMachineCost || 0;
  const upfrontFee = projection.upfrontFee || 0;
  let runningDebt = projection.newDebt || recommendations.analysis.debt;
  let runningCash = recommendations.analysis.cash - machineCost - upfrontFee;

  const kitsPerJob = 60;
  const costPerKit = 0.010;
  const fixedOrderCost = 1.0;
  const orderQuantity = Math.max(0, settings.materialOrderQty);
  const orderCost = (orderQuantity * costPerKit) + fixedOrderCost;

  // Processing times per LOT (in days)
  const processingTimesByLot: Record<number, { s1: number; s2: number; s3: number; s4: number }> = {
    12: { s1: 2.42/24, s2: 0.28/24, s3: 0.40/24, s4: 0.24/24 },
    15: { s1: 2.68/24, s2: 0.35/24, s3: 0.48/24, s4: 0.30/24 },
    20: { s1: 3.10/24, s2: 0.47/24, s3: 0.61/24, s4: 0.40/24 },
    30: { s1: 3.95/24, s2: 0.71/24, s3: 0.95/24, s4: 0.60/24 },
    60: { s1: 6.50/24, s2: 1.42/24, s3: 1.85/24, s4: 1.20/24 }
  };

  const lotSize = settings.lotSize || 20;
  const lotsPerJob = 60 / lotSize;
  const procTimes = processingTimesByLot[lotSize] || processingTimesByLot[20];

  // Contract terms
  const contracts: Record<number, { promised: number; max: number; revenue: number }> = {
    1: { promised: 7, max: 14, revenue: 750 },
    2: { promised: 1, max: 5, revenue: 1000 },
    3: { promised: 0.5, max: 1, revenue: 1250 }
  };
  const contract = contracts[settings.contract as keyof typeof contracts];

  // Calculate capacities
  const capacityS1 = settings.station1Machines / procTimes.s1;
  const capacityS3 = settings.station3Machines / procTimes.s3;
  const totalStation2TimePerLot = procTimes.s2 + procTimes.s4;
  const station2TotalCapacity = settings.station2Machines / totalStation2TimePerLot;

  // Simple revenue estimation based on throughput
  const bottleneckThroughput = Math.min(capacityS1, station2TotalCapacity, capacityS3);
  const avgJobsPerDay = Math.min(avgArrivalRate, bottleneckThroughput / lotsPerJob);

  // Estimate daily revenue and costs
  const avgJobRevenue = contract.revenue / 1000; // Convert to $k
  const dailyRevenue = avgJobsPerDay * avgJobRevenue;
  const kitsNeededPerDay = avgJobsPerDay * kitsPerJob;
  const avgOrdersPerDay = kitsNeededPerDay / (orderQuantity || 1);
  const dailyMaterialCost = avgOrdersPerDay * orderCost;

  // Run simulation for remaining days
  for (let day = 0; day < daysRemaining; day++) {
    const revenue = dailyRevenue;
    const materialCost = dailyMaterialCost;
    const machineCostToday = day === 0 ? machineCost : 0;

    // Calculate interest
    const debtInterestPaid = runningDebt > 0.001 ? runningDebt * dailyDebtInterestRate : 0;
    const cashInterestEarned = runningCash > 0.001 ? runningCash * dailyCashInterestRate : 0;

    // Daily profit/loss
    const netProfit = revenue - materialCost - machineCostToday - debtInterestPaid + cashInterestEarned;

    // Update cash
    runningCash += netProfit;

    // Debt repayment strategy: pay down debt with excess cash
    if (runningDebt > 0.001 && runningCash > 50) {
      const excessCash = runningCash - 50;
      const debtPayment = Math.min(excessCash, runningDebt);
      runningCash -= debtPayment;
      runningDebt -= debtPayment;
    }
  }

  return runningCash;
}
