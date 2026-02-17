import { useMemo } from 'react';
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

export function useProjectionData(
  recommendations: Recommendations | null,
  projection: Projection | null,
  settings: Config,
  inventoryState: InventoryState,
  avgArrivalRate: number
) {
  return useMemo(() => {
    if (!recommendations || !projection) return [];

    const currentDay = recommendations.analysis.currentDay;
    const daysRemaining = 318 - currentDay;
    const dailyDebtInterestRate = Math.pow(1.20, 1 / 365) - 1;
    const dailyCashInterestRate = Math.pow(1.10, 1 / 365) - 1;

    // Account for machine purchases and debt
    const machineCost = projection.totalMachineCost || 0;
    const upfrontFee = projection.upfrontFee || 0;
    let runningDebt = projection.newDebt || recommendations.analysis.debt;
    let runningCash = recommendations.analysis.cash - machineCost - upfrontFee;

    if (projection.avgJobsPerDay <= 0) return [];

    const projectionData = [];
    const kitsPerJob = 60;
    const costPerKit = 0.010;
    const fixedOrderCost = 1.0;
    const orderQuantity = Math.max(0, settings.materialOrderQty);
    const reorderPoint = Math.max(0, settings.materialReorderPoint);
    const materialLeadTimeDays = 4;
    const orderCost = (orderQuantity * costPerKit) + fixedOrderCost;

    // Processing times per LOT (in days)
    const processingTimesByLot: Record<number, { s1: number; s2: number; s3: number; s4: number }> = {
      12: { s1: 2.42/24, s2: 0.28/24, s3: 0.40/24, s4: 0.24/24 },
      15: { s1: 2.68/24, s2: 0.35/24, s3: 0.48/24, s4: 0.30/24 }, // Interpolated between 12 and 20
      20: { s1: 3.10/24, s2: 0.47/24, s3: 0.61/24, s4: 0.40/24 }, // Updated s3 to 0.61 (correct average)
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

    // Calculate daily capacity for each station (lots/day)
    const capacityS1 = settings.station1Machines / procTimes.s1;
    const capacityS3 = settings.station3Machines / procTimes.s3;

    // CRITICAL: Station 2 handles BOTH test1 (s2) and test4 (s4) for each lot
    // Each lot visits Station 2 twice, so total time = s2 + s4
    const totalStation2TimePerLot = procTimes.s2 + procTimes.s4;
    const station2TotalCapacity = settings.station2Machines / totalStation2TimePerLot; // lots/day throughput

    // Initialize simulation state
    let kitsInventory = inventoryState.inventory;
    let orderInTransit = inventoryState.orderInTransit;
    let orderArrivalDay = inventoryState.orderArrivalDay;

    // Inventory tracking initialized

    const jobs = new Map<number, Job>();
    const lots: Lot[] = [];
    let nextJobId = 1;
    let nextLotId = 1;
    const waitingForKits: number[] = [];

    // Initialize WIP from ACTUAL historical queue data (not Little's Law)
    // This is more accurate because it reflects the actual state of the system
    const avgQueue1 = recommendations.analysis.avgQueue1 || 0; // kits (includes waiting + processing)
    const avgQueue2 = recommendations.analysis.avgQueue2 || 0; // kits
    const avgQueue3 = recommendations.analysis.avgQueue3 || 0; // kits

    // Convert kits to lots for each station (with safety cap)
    const lotsAtS1 = Math.min(Math.round(avgQueue1 / lotSize), 200); // Cap at 200 lots

    // IMPORTANT: avgQueue2 includes BOTH test1 and test4 lots (Station 2 serves both)
    // Split based on processing time ratio
    const totalStation2Lots = avgQueue2 / lotSize;
    const test1Fraction = procTimes.s2 / (procTimes.s2 + procTimes.s4); // time fraction for test1
    const test4Fraction = procTimes.s4 / (procTimes.s2 + procTimes.s4); // time fraction for test4
    const lotsAtS2 = Math.min(Math.round(totalStation2Lots * test1Fraction), 50); // test1 queue

    // SMOOTH COMPLETIONS FIX: Add pipeline buffer at each stage for continuous flow
    // Target: 7-8 jobs/day = 21-24 lots/day steady completions
    // Need sufficient WIP at each downstream stage to sustain this rate

    const bottleneckThroughput = Math.min(capacityS1, station2TotalCapacity, capacityS3);
    const expectedDailyJobCompletions = bottleneckThroughput / lotsPerJob;
    const dailyLotThroughput = expectedDailyJobCompletions * lotsPerJob;

    // Add 2-3 days of pipeline buffer at each stage for smooth flow
    const pipelineBuffer = 2.5; // days

    const lotsAtS3 = Math.max(
      Math.min(Math.round(avgQueue3 / lotSize), 50),
      Math.round(dailyLotThroughput * pipelineBuffer * 0.3) // 30% of buffer at S3
    );

    const lotsAtS4 = Math.max(
      Math.round(totalStation2Lots * test4Fraction) + Math.round(expectedDailyJobCompletions * lotsPerJob * 1.0),
      Math.round(dailyLotThroughput * pipelineBuffer * 0.4) // 40% of buffer at S4 (closer to completion)
    );

    // Calculate total WIP from actual queue data (not Little's Law)
    const totalWIPLots = lotsAtS1 + lotsAtS2 + lotsAtS3 + lotsAtS4;

    // Safety check - if WIP is unreasonably large, use Little's Law instead
    if (totalWIPLots > 300) {
      return [];
    }

    // Jobs waiting for kits (from historical data)
    const jobsWaitingForKits = Math.round(recommendations.analysis.avgQueuedJobs || 0);

    const historicalLeadTime = recommendations.analysis.avgLeadTime || 2.0;

    // LOT-BASED MODEL: Create lots and assign to jobs
    // Lots flow independently through stations, jobs complete when all their lots finish

    const totalJobs = Math.floor(totalWIPLots / lotsPerJob);
    const estimatedStartDay = currentDay - historicalLeadTime;

    // Creating lot-based model

    // Create all jobs first
    for (let i = 0; i < totalJobs; i++) {
      const job: Job = {
        id: nextJobId++,
        startDay: estimatedStartDay + (i / totalJobs) * historicalLeadTime,
        contractType: settings.contract,
        promisedLeadTime: contract.promised,
        maxLeadTime: contract.max,
        revenue: contract.revenue,
        totalLots: lotsPerJob,
        completedLots: 0
      };
      jobs.set(job.id, job);
    }

    const jobArray = Array.from(jobs.values()).sort((a, b) => a.startDay - b.startDay);

    // Assign lots to jobs carefully - each job should get exactly lotsPerJob lots
    // Strategy: Fill jobs from oldest to newest, prioritizing later stations

    let remainingS4 = lotsAtS4;
    let remainingS3 = lotsAtS3;
    let remainingS2 = lotsAtS2;
    let remainingS1 = lotsAtS1;

    for (let i = 0; i < totalJobs; i++) {
      const job = jobArray[i];
      let lotsNeeded = lotsPerJob;

      // Fill from S4 first (furthest along)
      const lotsFromS4 = Math.min(lotsNeeded, remainingS4);
      for (let j = 0; j < lotsFromS4; j++) {
        lots.push({
          id: nextLotId++,
          jobId: job.id,
          currentStation: 4,
          arrivalAtCurrentStation: currentDay
        });
      }
      remainingS4 -= lotsFromS4;
      lotsNeeded -= lotsFromS4;

      // Then S3
      const lotsFromS3 = Math.min(lotsNeeded, remainingS3);
      for (let j = 0; j < lotsFromS3; j++) {
        lots.push({
          id: nextLotId++,
          jobId: job.id,
          currentStation: 3,
          arrivalAtCurrentStation: currentDay
        });
      }
      remainingS3 -= lotsFromS3;
      lotsNeeded -= lotsFromS3;

      // Then S2
      const lotsFromS2 = Math.min(lotsNeeded, remainingS2);
      for (let j = 0; j < lotsFromS2; j++) {
        lots.push({
          id: nextLotId++,
          jobId: job.id,
          currentStation: 2,
          arrivalAtCurrentStation: currentDay
        });
      }
      remainingS2 -= lotsFromS2;
      lotsNeeded -= lotsFromS2;

      // Finally S1
      const lotsFromS1 = Math.min(lotsNeeded, remainingS1);
      for (let j = 0; j < lotsFromS1; j++) {
        lots.push({
          id: nextLotId++,
          jobId: job.id,
          currentStation: 1,
          arrivalAtCurrentStation: currentDay
        });
      }
      remainingS1 -= lotsFromS1;
      lotsNeeded -= lotsFromS1;
    }

    // Verify lot distribution
    const lotsByJob = new Map<number, number>();
    for (const lot of lots) {
      lotsByJob.set(lot.jobId, (lotsByJob.get(lot.jobId) || 0) + 1);
    }

    // Initial lots created and assigned to jobs

    // Create jobs waiting for kits
    for (let i = 0; i < jobsWaitingForKits; i++) {
      const job: Job = {
        id: nextJobId++,
        startDay: currentDay - 0.5,
        contractType: settings.contract,
        promisedLeadTime: contract.promised,
        maxLeadTime: contract.max,
        revenue: contract.revenue,
        totalLots: lotsPerJob,
        completedLots: 0
      };
      jobs.set(job.id, job);
      waitingForKits.push(job.id);
    }

    // Poisson random number generator (simple approximation)
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

    // QUEUING THEORY CONSTANTS
    // Service rates (lots per hour) at each station
    const serviceRateS1PerMachine = 1 / procTimes.s1; // lots/hour per machine
    const serviceRateS1Total = serviceRateS1PerMachine * settings.station1Machines; // total lots/hour
    // const serviceRateS2 = 1 / procTimes.s2; // lots/hour (test1)
    const serviceRateS3 = 1 / procTimes.s3; // lots/hour
    // const serviceRateS4 = 1 / procTimes.s4; // lots/hour (test4)

    // Station 2 combined rate (for capacity constraint - same machine does both test1 and test4)
    // const serviceRateS2Combined = 1 / (procTimes.s2 + procTimes.s4); // lots/hour for full cycle

    // Daily simulation loop with HOURLY TIMESTEPS for continuous flow
    for (let i = 0; i < daysRemaining; i++) {
      const day = currentDay + i + 1;

      // 1. Material order arrives (at start of day)
      if (orderInTransit && day >= orderArrivalDay) {
        kitsInventory += orderQuantity;
        orderInTransit = false;
      }

      // 2. Process waiting for kits queue (at start of day)
      // const waitingBeforeProcessing = waitingForKits.length;
      while (waitingForKits.length > 0 && kitsInventory >= kitsPerJob) {
        const jobId = waitingForKits.shift()!;
        const job = jobs.get(jobId)!;
        job.startDay = day;
        kitsInventory -= kitsPerJob;

        // Create lots for this job at S1
        for (let l = 0; l < lotsPerJob; l++) {
          const lot: Lot = {
            id: nextLotId++,
            jobId: job.id,
            currentStation: 1,
            arrivalAtCurrentStation: day
          };
          lots.push(lot);
        }
      }
      // const jobsAcceptedFromQueue = waitingBeforeProcessing - waitingForKits.length;

      // 3. New arrivals (spread throughout the day using Poisson)
      const arrivals = randomPoisson(avgArrivalRate || 10, day * 137);
      let newJobsAccepted = 0;
      const newLotsToday: Lot[] = [];

      for (let j = 0; j < arrivals; j++) {
        const job: Job = {
          id: nextJobId++,
          startDay: day,
          contractType: settings.contract,
          promisedLeadTime: contract.promised,
          maxLeadTime: contract.max,
          revenue: contract.revenue,
          totalLots: lotsPerJob,
          completedLots: 0
        };
        jobs.set(job.id, job);

        if (kitsInventory >= kitsPerJob) {
          kitsInventory -= kitsPerJob;
          newJobsAccepted++;

          // Create lots - they'll enter S1 queue throughout the day
          for (let l = 0; l < lotsPerJob; l++) {
            const lot: Lot = {
              id: nextLotId++,
              jobId: job.id,
              currentStation: 1,
              arrivalAtCurrentStation: day + (j / arrivals) // Spread arrivals across the day
            };
            newLotsToday.push(lot);
          }
        } else {
          waitingForKits.push(job.id);
        }
      }

      // 4. QUEUING THEORY FLOW MODEL - Use M/M/c formulas for continuous daily flow
      // IMPORTANT: Process existing lots FIRST, then add new arrivals
      // This creates realistic queue buildup at the bottleneck (S1)

      // Get lots at each station (FIFO sorted) - BEFORE adding new arrivals
      const lotsAtS4 = lots.filter(l => l.currentStation === 4).sort((a, b) => a.arrivalAtCurrentStation - b.arrivalAtCurrentStation);
      const lotsAtS3 = lots.filter(l => l.currentStation === 3).sort((a, b) => a.arrivalAtCurrentStation - b.arrivalAtCurrentStation);
      const lotsAtS2 = lots.filter(l => l.currentStation === 2).sort((a, b) => a.arrivalAtCurrentStation - b.arrivalAtCurrentStation);
      const lotsAtS1 = lots.filter(l => l.currentStation === 1).sort((a, b) => a.arrivalAtCurrentStation - b.arrivalAtCurrentStation);

      // QUEUING THEORY FLOW CALCULATION
      // Calculate utilization and queue times using M/M/c formulas

      // Service rates in lots/day (already calculated above as lots/hour * 24)
      const capacityS1Daily = serviceRateS1Total * 24;
      // const capacityS2Daily = serviceRateS2 * 24;
      const capacityS3Daily = serviceRateS3 * 24;
      // const capacityS4Daily = serviceRateS4 * 24;

      // Calculate utilization (ρ = λ/μ)
      // Arrival rate at each station = throughput from previous station
      // const arrivalRateS1 = newLotsToday.length; // lots arriving at S1 today
      // const utilizationS1 = Math.min(0.99, (lotsAtS1.length + arrivalRateS1) / capacityS1Daily);

      // Steady-state throughput (can't exceed capacity or available lots)
      // const throughputS1 = Math.min(lotsAtS1.length, capacityS1Daily);
      // const utilizationS2 = Math.min(0.99, (lotsAtS2.length + throughputS1) / capacityS2Daily);

      // const throughputS2 = Math.min(lotsAtS2.length, capacityS2Daily);
      // const utilizationS3 = Math.min(0.99, (lotsAtS3.length + throughputS2) / capacityS3Daily);

      // const throughputS3 = Math.min(lotsAtS3.length, capacityS3Daily);
      // const utilizationS4 = Math.min(0.99, (lotsAtS4.length + throughputS3) / capacityS4Daily);

      // Calculate avg queue time using M/M/c formulas (in days)
      // For M/M/c: W_q ≈ (ρ^√(2(c+1))) / (c×μ×(1-ρ)) - Kingman approximation
      // For M/M/1: W_q = ρ/(μ(1-ρ))

      // function calcMM1QueueTime(utilization: number, procTimeHours: number): number {
      //   if (utilization >= 1) return 999; // Unstable
      //   const mu = 24 / procTimeHours; // service rate in lots/day
      //   return utilization / (mu * (1 - utilization)); // queue time in days
      // }

      // function calcMM3QueueTime(utilization: number, procTimeHours: number, numMachines: number): number {
      //   if (utilization >= 1) return 999;
      //   const mu = 24 / procTimeHours; // service rate per machine in lots/day
      //   // Simplified approximation for M/M/c
      //   const c = numMachines;
      //   const rho = utilization;
      //   // Erlang-C approximation
      //   const waitTime = (Math.pow(rho, Math.sqrt(2 * (c + 1)))) / (c * mu * (1 - rho));
      //   return Math.max(0, waitTime);
      // }

      // const queueTimeS1 = calcMM3QueueTime(utilizationS1, procTimes.s1, settings.station1Machines);
      // const queueTimeS2 = calcMM1QueueTime(utilizationS2, procTimes.s2);
      // const queueTimeS3 = calcMM1QueueTime(utilizationS3, procTimes.s3);
      // const queueTimeS4 = calcMM1QueueTime(utilizationS4, procTimes.s4);

      // Total time through system (in days)
      // const totalTimeS1 = queueTimeS1 + (procTimes.s1 / 24);
      // const totalTimeS2 = queueTimeS2 + (procTimes.s2 / 24);
      // const totalTimeS3 = queueTimeS3 + (procTimes.s3 / 24);
      // const totalTimeS4 = queueTimeS4 + (procTimes.s4 / 24);
      // const totalSystemTime = totalTimeS1 + totalTimeS2 + totalTimeS3 + totalTimeS4;

      // FLOW MODEL: Lots flow through system at steady-state rates
      // Since total system time < 1 day, lots can move through multiple stations per day

      // Calculate how many lots to process at each station
      // CRITICAL FIX: Each station processes INDEPENDENTLY based on its own queue and capacity
      // Removing upstream dependencies that were causing 0 completions!

      const lotsS1ToProcess = Math.min(lotsAtS1.length, Math.floor(capacityS1Daily));
      const lotsS3ToProcess = Math.min(lotsAtS3.length, Math.floor(capacityS3Daily));

      // Station 2 must handle both S2 and S4 with same physical machine
      // Allocate capacity proportionally based on queue lengths
      const totalS2andS4Demand = lotsAtS2.length + lotsAtS4.length;

      let lotsS2ToProcess: number;
      let lotsS4ToProcess: number;

      if (totalS2andS4Demand === 0) {
        // No work at Station 2
        lotsS2ToProcess = 0;
        lotsS4ToProcess = 0;
      } else {
        const s2FractionOfDemand = lotsAtS2.length / totalS2andS4Demand;
        const s4FractionOfDemand = lotsAtS4.length / totalS2andS4Demand;

        // Allocate Station 2 machine time proportionally
        const timeAvailable = settings.station2Machines * 24; // machine-hours per day
        const timeForS2 = timeAvailable * s2FractionOfDemand;
        const timeForS4 = timeAvailable * s4FractionOfDemand;

        // Calculate how many lots can be processed with allocated time
        const lotsS2FromTime = timeForS2 / procTimes.s2;
        const lotsS4FromTime = timeForS4 / procTimes.s4;

        lotsS2ToProcess = Math.min(lotsAtS2.length, Math.floor(lotsS2FromTime));
        lotsS4ToProcess = Math.min(lotsAtS4.length, Math.floor(lotsS4FromTime));
      }

      // Process lots (REVERSE order to allow same-day cascading: S4→S3→S2→S1)
      for (let i = 0; i < lotsS4ToProcess; i++) {
        const lot = lotsAtS4[i];
        lot.currentStation = 'complete';
        const job = jobs.get(lot.jobId)!;
        job.completedLots++;
      }

      for (let i = 0; i < lotsS3ToProcess; i++) {
        lotsAtS3[i].currentStation = 4;
        lotsAtS3[i].arrivalAtCurrentStation = day;
      }

      for (let i = 0; i < lotsS2ToProcess; i++) {
        lotsAtS2[i].currentStation = 3;
        lotsAtS2[i].arrivalAtCurrentStation = day;
      }

      for (let i = 0; i < lotsS1ToProcess; i++) {
        lotsAtS1[i].currentStation = 2;
        lotsAtS1[i].arrivalAtCurrentStation = day;
      }

      // 5. Add new arrivals AFTER processing existing lots
      // This ensures arrivals join the queue and wait for next day processing
      // Creating realistic queue buildup at bottleneck stations
      lots.push(...newLotsToday);

      // Log END of day state for days 73-75
      // 5. Check job completions (job completes when all its lots are complete)
      const completedJobs: Job[] = [];
      let totalLeadTime = 0;

      for (const job of jobs.values()) {
        if (!job.completionDay && job.completedLots === job.totalLots) {
          job.completionDay = day;
          completedJobs.push(job);
          totalLeadTime += day - job.startDay;
        }
      }

      const avgCompletedLeadTime = completedJobs.length > 0 ? totalLeadTime / completedJobs.length : 0;

      // 6. Calculate revenue (based on job's contract and lead time)
      let dailyRev = 0;
      for (const job of completedJobs) {
        const leadTime = job.completionDay! - job.startDay;
        let revenue = 0;
        if (leadTime <= job.promisedLeadTime) {
          revenue = job.revenue;
        } else if (leadTime < job.maxLeadTime) {
          const fraction = (job.maxLeadTime - leadTime) / (job.maxLeadTime - job.promisedLeadTime);
          revenue = job.revenue * fraction;
        }
        // else revenue = 0 (late, no payment)
        dailyRev += revenue / 1000;
      }

      // 7. Cash update and material ordering
      const cashInterestEarned = runningCash > 0 ? runningCash * dailyCashInterestRate : 0;
      const debtInterestPaid = runningDebt > 0 ? runningDebt * dailyDebtInterestRate : 0;
      const netInterest = cashInterestEarned - debtInterestPaid;
      const cashAfterRevenue = runningCash + dailyRev + netInterest;

      let materialCost = 0;
      if (kitsInventory <= reorderPoint && !orderInTransit && orderQuantity > 0 && cashAfterRevenue >= orderCost) {
        materialCost = orderCost;
        orderInTransit = true;
        orderArrivalDay = day + materialLeadTimeDays;
        // Material order placed
      }

      const netProfit = dailyRev + netInterest - materialCost;
      runningCash += netProfit;

      let debtPayment = 0;
      if (runningDebt > 0 && runningCash > 10) {
        debtPayment = Math.min(runningDebt, runningCash - 10);
        runningCash -= debtPayment;
        runningDebt -= debtPayment;
      }

      // 8. Count lots and jobs for metrics
      const totalLotsAtS1 = lots.filter(l => l.currentStation === 1).length;
      const totalLotsAtS2 = lots.filter(l => l.currentStation === 2).length;
      const totalLotsAtS3 = lots.filter(l => l.currentStation === 3).length;
      const totalLotsAtS4 = lots.filter(l => l.currentStation === 4).length;

      // Count jobs at each station (job is "at" the station where it has the most lots)
      const jobStationCounts = new Map<number, { s1: number; s2: number; s3: number; s4: number }>();
      for (const lot of lots) {
        if (lot.currentStation === 'complete') continue;
        if (!jobStationCounts.has(lot.jobId)) {
          jobStationCounts.set(lot.jobId, { s1: 0, s2: 0, s3: 0, s4: 0 });
        }
        const counts = jobStationCounts.get(lot.jobId)!;
        if (lot.currentStation === 1) counts.s1++;
        else if (lot.currentStation === 2) counts.s2++;
        else if (lot.currentStation === 3) counts.s3++;
        else if (lot.currentStation === 4) counts.s4++;
      }

      let jobsAtS1 = 0, jobsAtS2 = 0, jobsAtS3 = 0, jobsAtS4 = 0;
      for (const counts of jobStationCounts.values()) {
        const maxCount = Math.max(counts.s1, counts.s2, counts.s3, counts.s4);
        if (counts.s4 === maxCount) jobsAtS4++;
        else if (counts.s3 === maxCount) jobsAtS3++;
        else if (counts.s2 === maxCount) jobsAtS2++;
        else if (counts.s1 === maxCount) jobsAtS1++;
      }

      const jobsInSystem = Array.from(jobs.values()).filter(j => !j.completionDay).length;
      const jobsAcceptedToday = arrivals - waitingForKits.filter(id => {
        const job = jobs.get(id);
        return job && job.startDay === day;
      }).length;

      // 9. Record metrics
      projectionData.push({
        day,
        revenue: parseFloat(dailyRev.toFixed(2)),
        materialCost: parseFloat(materialCost.toFixed(2)),
        machineCost: i === 0 ? machineCost : 0, // Apply machine cost only on first day
        interest: parseFloat(netInterest.toFixed(3)),
        debtInterest: parseFloat(debtInterestPaid.toFixed(3)),
        cashInterest: parseFloat(cashInterestEarned.toFixed(3)),
        debtPayment: parseFloat(debtPayment.toFixed(2)),
        profit: parseFloat(netProfit.toFixed(2)),
        debt: parseFloat(runningDebt.toFixed(2)),
        cash: parseFloat(runningCash.toFixed(2)),
        arrivals: arrivals,
        jobsAccepted: jobsAcceptedToday,
        jobsCompleting: completedJobs.length,
        jobsWaitingForKits: waitingForKits.length,
        jobsInSystem: jobsInSystem,
        avgLeadTime: parseFloat(avgCompletedLeadTime.toFixed(2)),
        lotsWaitingS1: totalLotsAtS1,
        lotsProcessingS1: Math.min(totalLotsAtS1, settings.station1Machines),
        lotsWaitingS2: totalLotsAtS2,
        lotsProcessingS2: Math.min(totalLotsAtS2, settings.station2Machines),
        lotsWaitingS3: totalLotsAtS3,
        lotsProcessingS3: Math.min(totalLotsAtS3, settings.station3Machines),
        lotsWaitingS4: totalLotsAtS4,
        jobsAtS1: jobsAtS1,
        jobsAtS2: jobsAtS2,
        jobsAtS3: jobsAtS3,
        jobsAtS4: jobsAtS4,
        inventory: parseFloat(kitsInventory.toFixed(0)),
        reorderPoint: reorderPoint,
        orderInTransit: orderInTransit ? 1 : 0
      });
    }

    return projectionData;
  }, [
    recommendations,
    projection,
    settings.lotSize,
    settings.materialOrderQty,
    settings.materialReorderPoint,
    settings.station1Machines,
    settings.station2Machines,
    settings.station3Machines,
    settings.contract,
    inventoryState.inventory,
    inventoryState.orderInTransit,
    inventoryState.orderArrivalDay,
    avgArrivalRate
  ]);
}
