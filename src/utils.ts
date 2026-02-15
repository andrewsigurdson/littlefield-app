import { Config, ParsedData } from './types';

// Random number generator for simulation (seeded for consistency)
export const randomExponential = (lambda: number, seed: number) => {
  const x = Math.sin(seed) * 10000;
  const random = x - Math.floor(x);
  return -Math.log(1 - random) / lambda;
};

export const randomPoisson = (lambda: number, seed: number) => {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;

  do {
    k++;
    const x = Math.sin(seed + k) * 10000;
    const u = x - Math.floor(x);
    p *= u;
  } while (p > L);

  return k - 1;
};

// Calculate profit projection with lead time penalties, material costs, and M/M/c queuing
export const calculateProfitProjection = (
  config: Config,
  currentDay: number,
  currentCash: number,
  currentDebt: number,
  parsedData: ParsedData[],
  currentSettings: Config
) => {
  const recentData = parsedData.slice(-14);
  const daysRemaining = 318 - currentDay;

  // M/M/c Queuing parameters
  const avgArrivalRate = 10; // λ = 10 jobs/day average (variable with exponential inter-arrival)

  // Station service rates (jobs per day per machine) - approximated from historical data
  const serviceRates = {
    station1: 4.0, // μ1 = 4 jobs/day per machine (Stuffer)
    station2: 3.5, // μ2 = 3.5 jobs/day per machine (Tester)
    station3: 4.2  // μ3 = 4.2 jobs/day per machine (Tuner)
  };

  // Calculate effective throughput considering queuing and capacity
  const calculateDailyThroughput = () => {
    // Use M/M/c formula to estimate throughput
    // IMPORTANT: Station 2 processes each job TWICE (Step 2 and Step 4)
    // So its effective capacity for the system is halved
    const bottleneck = Math.min(
      config.station1Machines * serviceRates.station1,
      (config.station2Machines * serviceRates.station2) / 2, // Divided by 2 because each job uses it twice
      config.station3Machines * serviceRates.station3
    );

    // Effective throughput is min of arrival rate and bottleneck capacity
    // With queuing, we approach bottleneck capacity but with variability
    return Math.min(avgArrivalRate, bottleneck * 0.95); // 95% efficiency due to variability
  };

  const avgJobsPerDay = calculateDailyThroughput();

  // Material costs
  const kitsPerJob = 60;
  const costPerKit = 0.010; // $10 per kit = $0.010k
  const fixedOrderCost = 1.0; // $1,000 per order = $1k
  const orderQuantity = 7.2; // 7,200 kits = 7.2k kits

  // Calculate total material costs over remaining days
  const totalKitsNeeded = avgJobsPerDay * kitsPerJob * daysRemaining;
  const numberOfOrders = Math.ceil(totalKitsNeeded / (orderQuantity * 1000)); // Convert 7.2k to 7200
  const totalMaterialCost = (totalKitsNeeded * costPerKit) + (numberOfOrders * fixedOrderCost);
  const dailyMaterialCost = totalMaterialCost / daysRemaining;

  // Simulate lead times with Station 2 priority policy
  // Station 2 processes jobs twice: Step 2 (after S1) and Step 4 (after S3)
  const simulateLeadTime = () => {
    // Processing times per station (days per job)
    const procTime1 = 1 / serviceRates.station1; // ~0.25 days per machine
    const procTime2 = 1 / serviceRates.station2; // ~0.29 days per machine
    const procTime3 = 1 / serviceRates.station3; // ~0.24 days per machine

    // Queue waiting times depend on utilization and priority
    const util1 = avgJobsPerDay / (config.station1Machines * serviceRates.station1);
    const util2 = (avgJobsPerDay * 2) / (config.station2Machines * serviceRates.station2); // Jobs pass through twice
    const util3 = avgJobsPerDay / (config.station3Machines * serviceRates.station3);

    // M/M/c queue wait time approximation: Wq ≈ (ρ/(1-ρ)) * (1/μc) for high utilization
    const wait1 = util1 > 0.7 ? (util1 / (1 - util1)) * (procTime1 / config.station1Machines) : procTime1 * 0.1;
    const wait3 = util3 > 0.7 ? (util3 / (1 - util3)) * (procTime3 / config.station3Machines) : procTime3 * 0.1;

    // Station 2 wait time depends on priority policy
    let wait2Step2 = 0; // Wait for Step 2 jobs
    let wait2Step4 = 0; // Wait for Step 4 jobs

    if (util2 > 0.7) {
      const baseWait2 = (util2 / (1 - util2)) * (procTime2 / config.station2Machines);

      switch (config.station2Priority) {
        case 'Step 2':
          // Prioritize Step 2: they wait less, Step 4 waits more
          wait2Step2 = baseWait2 * 0.7;
          wait2Step4 = baseWait2 * 1.3;
          break;
        case 'Step 4':
          // Prioritize Step 4: they wait less, Step 2 waits more
          wait2Step2 = baseWait2 * 1.3;
          wait2Step4 = baseWait2 * 0.7;
          break;
        default: // FIFO
          wait2Step2 = baseWait2;
          wait2Step4 = baseWait2;
      }
    } else {
      wait2Step2 = procTime2 * 0.1;
      wait2Step4 = procTime2 * 0.1;
    }

    // Total lead time: S1 → S2(Step2) → S3 → S2(Step4) → Complete
    const avgLeadTime =
      wait1 + procTime1 / config.station1Machines +
      wait2Step2 + procTime2 / config.station2Machines +
      wait3 + procTime3 / config.station3Machines +
      wait2Step4 + procTime2 / config.station2Machines;

    // Standard deviation increases with queue variability
    const stdLeadTime = avgLeadTime * 0.3 * Math.sqrt(util2); // Higher utilization = more variability

    return { avgLeadTime, stdLeadTime };
  };

  const { avgLeadTime: adjustedAvgLeadTime, stdLeadTime: adjustedStdLeadTime } = simulateLeadTime();

  // Contract terms
  const contracts: Record<number, { promised: number; max: number; revenue: number }> = {
    1: { promised: 7, max: 14, revenue: 750 },
    2: { promised: 1, max: 5, revenue: 1000 },
    3: { promised: 0.5, max: 1, revenue: 1250 }
  };
  const contract = contracts[config.contract as keyof typeof contracts];

  // Calculate expected revenue per job using lead time distribution
  // Assume normal distribution of lead times
  const calculateExpectedRevenuePerJob = () => {
    // Use numerical integration over the lead time distribution
    const minLT = Math.max(0, adjustedAvgLeadTime - 4 * adjustedStdLeadTime);
    const maxLT = adjustedAvgLeadTime + 4 * adjustedStdLeadTime;
    const steps = 200;
    const dx = (maxLT - minLT) / steps;

    let totalExpectedRevenue = 0;
    let totalProbability = 0;

    for (let i = 0; i < steps; i++) {
      const leadTime = minLT + (i + 0.5) * dx;

      // Normal distribution PDF
      const z = (leadTime - adjustedAvgLeadTime) / adjustedStdLeadTime;
      const pdf = Math.exp(-0.5 * z * z) / (adjustedStdLeadTime * Math.sqrt(2 * Math.PI));
      const prob = pdf * dx;

      // Calculate revenue for this lead time
      let revenue = 0;
      if (leadTime <= contract.promised) {
        revenue = contract.revenue;
      } else if (leadTime < contract.max) {
        // Linear interpolation from full revenue to 0
        const fraction = (contract.max - leadTime) / (contract.max - contract.promised);
        revenue = contract.revenue * fraction;
      } else {
        revenue = 0; // Late jobs get $0
      }

      totalExpectedRevenue += revenue * prob;
      totalProbability += prob;
    }

    return totalExpectedRevenue / totalProbability;
  };

  const expectedRevenuePerJob = calculateExpectedRevenuePerJob();
  const contractRevenue = expectedRevenuePerJob; // Use expected revenue instead of full contract revenue

  // Calculate machine purchase costs and debt
  const machineCosts = {
    station1: (config.station1Machines - currentSettings.station1Machines) * 90,
    station2: (config.station2Machines - currentSettings.station2Machines) * 80,
    station3: (config.station3Machines - currentSettings.station3Machines) * 100
  };
  const totalMachineCost = Math.max(0, machineCosts.station1 + machineCosts.station2 + machineCosts.station3);

  // Calculate debt needed
  let newDebt = currentDebt;
  let upfrontFee = 0;
  if (totalMachineCost > currentCash) {
    const debtNeeded = totalMachineCost - currentCash;
    upfrontFee = debtNeeded * 0.05;
    newDebt = currentDebt + debtNeeded + upfrontFee;
  }

  // Daily interest rate (20% annual compounded daily)
  const dailyInterestRate = Math.pow(1.20, 1/365) - 1;

  // Calculate total interest over remaining days
  let totalInterest = 0;
  let runningDebt = newDebt;
  for (let i = 0; i < daysRemaining; i++) {
    const dailyInterest = runningDebt * dailyInterestRate;
    totalInterest += dailyInterest;
    runningDebt += dailyInterest;
  }

  // Also account for interest earned on positive cash (10% annual)
  const cashInterestRate = Math.pow(1.10, 1/365) - 1;
  const avgCashBalance = currentCash - totalMachineCost;
  let totalInterestEarned = 0;
  if (avgCashBalance > 0) {
    let runningCash = avgCashBalance;
    for (let i = 0; i < daysRemaining; i++) {
      const dailyInterest = runningCash * cashInterestRate;
      totalInterestEarned += dailyInterest;
      runningCash += dailyInterest;
    }
  }

  // Calculate probability of different outcomes using normal CDF approximation
  const normalCDF = (x: number) => {
    // Approximation of normal CDF using error function
    const z = (x - adjustedAvgLeadTime) / adjustedStdLeadTime;
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - prob : prob;
  };

  const probOnTime = normalCDF(contract.promised);
  const probLate = 1 - normalCDF(contract.max);
  const probPartial = normalCDF(contract.max) - normalCDF(contract.promised);

  // Total revenue
  const grossRevenue = avgJobsPerDay * contractRevenue * daysRemaining;
  const netRevenue = grossRevenue - totalMaterialCost - totalMachineCost - totalInterest + totalInterestEarned - upfrontFee;
  const totalProfit = netRevenue; // Net revenue after all costs

  // Daily breakdown for graphing
  const dailyRevenue = avgJobsPerDay * contractRevenue;
  const dailyProfit = dailyRevenue - dailyMaterialCost;

  return {
    grossRevenue,
    netRevenue,
    totalProfit,
    avgJobsPerDay,
    daysRemaining,
    totalMachineCost,
    totalMaterialCost,
    dailyMaterialCost,
    dailyRevenue,
    dailyProfit,
    newDebt,
    totalInterest,
    totalInterestEarned,
    upfrontFee,
    revenuePerDay: netRevenue / daysRemaining,
    // Lead time analysis
    adjustedAvgLeadTime,
    adjustedStdLeadTime,
    expectedRevenuePerJob,
    fullContractRevenue: contract.revenue,
    probOnTime,
    probPartial,
    probLate,
    contractTerms: contract
  };
};
