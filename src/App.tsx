import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';

interface Change {
  type: string;
  action: string;
  reason: string;
  cost: number;
  needsDebt?: boolean;
  priority: string;
}

interface Bottleneck {
  station: number;
  priority: number;
  util: number;
  queue: number;
  cost: number;
}

interface Analysis {
  avgUtil1: number;
  avgUtil2: number;
  avgUtil3: number;
  avgQueue1: number;
  avgQueue2: number;
  avgQueue3: number;
  avgLeadTime: number;
  maxLeadTime: number;
  avgQueuedJobs: number;
  netCash: number;
  currentDay: number;
  cash: number;
  debt: number;
}

interface Config {
  lotSize: number;
  contract: number;
  station1Machines: number;
  station2Machines: number;
  station3Machines: number;
  station2Priority: string;
}

// Number formatting utility
const formatNumber = (num: number, decimals: number = 0): string => {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const LittlefieldAnalysis = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [csvData, setCsvData] = useState('');
  const [cashOnHand, setCashOnHand] = useState('');
  const [debt, setDebt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentSettings, setCurrentSettings] = useState({
    lotSize: 20,
    contract: 1,
    station1Machines: 3,
    station2Machines: 1,
    station3Machines: 1,
    station2Priority: 'FIFO'
  });

  // Load Excel file on mount
  useEffect(() => {
    const loadExcelFile = async () => {
      try {
        setLoading(true);
        setError('');

        const response = await fetch('/data/Consolidate Data-Daily Data.xlsx');
        if (!response.ok) {
          throw new Error('Could not load Excel file. Make sure the file exists in the /data folder.');
        }

        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        // Get the first sheet
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

        // Convert to tab-separated values (TSV)
        const tsvData = XLSX.utils.sheet_to_csv(firstSheet, { FS: '\t' });

        setCsvData(tsvData);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading Excel file');
        setLoading(false);
      }
    };

    loadExcelFile();
  }, []);

  // Test scenario state
  const [testSettings, setTestSettings] = useState({
    lotSize: 20,
    contract: 1,
    station1Machines: 3,
    station2Machines: 1,
    station3Machines: 1,
    station2Priority: 'FIFO'
  });

  // Parse CSV data
  const parsedData = useMemo(() => {
    if (!csvData) return [];
    
    const lines = csvData.trim().split('\n');
    const dataLines = lines.slice(3);
    
    return dataLines.map(line => {
      const values = line.split('\t');
      return {
        day: parseInt(values[0]) || 0,
        queuedJobs: parseFloat(values[1]) || 0,
        jobsAccepted: parseFloat(values[2]) || 0,
        queue1: parseFloat(values[5]) || 0,
        util1: parseFloat(values[6]) || 0,
        machines1: parseFloat(values[7]) || 0,
        queue2: parseFloat(values[8]) || 0,
        util2: parseFloat(values[9]) || 0,
        machines2: parseFloat(values[10]) || 0,
        queue3: parseFloat(values[11]) || 0,
        util3: parseFloat(values[12]) || 0,
        machines3: parseFloat(values[13]) || 0,
        jobsOut: parseFloat(values[14]) || 0,
        revenue: parseFloat(values[17]) || 0,
        leadTime: parseFloat(values[20]) || 0,
        cashBalance: parseFloat(values[23]) || 0
      };
    }).filter(d => d.day > 0);
  }, [csvData]);

  // Random number generator for simulation (seeded for consistency)
  const randomExponential = (lambda: number, seed: number) => {
    // Simple pseudo-random using sine (deterministic for same seed)
    const x = Math.sin(seed) * 10000;
    const random = x - Math.floor(x);
    return -Math.log(1 - random) / lambda;
  };

  const randomPoisson = (lambda: number, seed: number) => {
    // Generate Poisson random variable using inverse transform
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
  const calculateProfitProjection = (config: Config, currentDay: number, currentCash: number, currentDebt: number) => {
    const recentData = parsedData.slice(-14);
    const historicalAvgJobsPerDay = recentData.reduce((sum, d) => sum + d.jobsOut, 0) / recentData.length;
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

  // Analysis algorithm
  const recommendations = useMemo(() => {
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
      changes: [],
      analysis: {} as Analysis
    };

    recs.analysis = {
      avgUtil1, avgUtil2, avgUtil3,
      avgQueue1, avgQueue2, avgQueue3,
      avgLeadTime, maxLeadTime,
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
          reason: `High utilization (${(bn.util*100).toFixed(1)}%) and queue (${bn.queue.toFixed(0)} kits)`,
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
          reason: `Critical bottleneck - utilization ${(bn.util*100).toFixed(1)}%, queue ${bn.queue.toFixed(0)} kits`,
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
          reason: `High utilization (${(bn.util*100).toFixed(1)}%) and queue (${bn.queue.toFixed(0)} kits)`,
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

  // Initialize test settings when recommendations are ready
  React.useEffect(() => {
    if (recommendations && location.pathname === '/testing') {
      setTestSettings({
        lotSize: recommendations.lotSize,
        contract: recommendations.contract,
        station1Machines: recommendations.station1Machines,
        station2Machines: recommendations.station2Machines,
        station3Machines: recommendations.station3Machines,
        station2Priority: recommendations.station2Priority
      });
    }
  }, [recommendations, location.pathname]);

  const handleRun = () => {
    if (loading) {
      alert('Please wait for data to finish loading');
      return;
    }
    if (error || !csvData) {
      alert('Please make sure the Excel file is loaded successfully');
      return;
    }
    if (!cashOnHand) {
      alert('Please enter cash on hand');
      return;
    }
    navigate('/testing');
  };

  const handleReset = () => {
    navigate('/');
  };

  // Chart data
  const utilizationData = parsedData.slice(-30).map(d => ({
    day: d.day,
    Station1: (d.util1 * 100).toFixed(1),
    Station2: (d.util2 * 100).toFixed(1),
    Station3: (d.util3 * 100).toFixed(1)
  }));

  const queueData = parsedData.slice(-30).map(d => ({
    day: d.day,
    Station1: d.queue1,
    Station2: d.queue2,
    Station3: d.queue3
  }));

  const leadTimeData = parsedData.slice(-30).map(d => ({
    day: d.day,
    leadTime: d.leadTime
  }));

  const wipData = parsedData.slice(-30).map(d => ({
    day: d.day,
    queuedJobs: d.queuedJobs,
    jobsAccepted: d.jobsAccepted
  }));

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'CRITICAL': return 'bg-red-100 border-red-500 text-red-900';
      case 'HIGH': return 'bg-orange-100 border-orange-500 text-orange-900';
      case 'MEDIUM': return 'bg-yellow-100 border-yellow-500 text-yellow-900';
      case 'LOW': return 'bg-blue-100 border-blue-500 text-blue-900';
      case 'BLOCKED': return 'bg-gray-100 border-gray-500 text-gray-900';
      case 'INFO': return 'bg-green-100 border-green-500 text-green-900';
      default: return 'bg-gray-100 border-gray-500 text-gray-900';
    }
  };

  // Calculate projections for recommended and test configs
  const recommendedProjection = recommendations ? calculateProfitProjection(
    recommendations,
    recommendations.analysis.currentDay,
    recommendations.analysis.cash,
    recommendations.analysis.debt
  ) : null;

  const testProjection = recommendations ? calculateProfitProjection(
    testSettings,
    recommendations.analysis.currentDay,
    recommendations.analysis.cash,
    recommendations.analysis.debt
  ) : null;

  return (
    <div className="w-full max-w-7xl mx-auto p-6 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6 text-blue-900">
        Littlefield Live Optimizer {location.pathname === '/testing' && '- Testing'}
      </h1>

      {location.pathname !== '/testing' ? (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Step 1: Historical Data Status</h2>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-blue-600 font-medium">Loading data from Excel file...</div>
              </div>
            ) : error ? (
              <div className="bg-red-50 border-2 border-red-300 rounded p-4">
                <p className="text-red-800 font-bold mb-2">Error loading data:</p>
                <p className="text-red-600 text-sm">{error}</p>
                <p className="text-gray-600 text-xs mt-3">
                  Make sure "Consolidate Data-Daily Data.xlsx" exists in the /data folder
                </p>
              </div>
            ) : (
              <div className="bg-green-50 border-2 border-green-300 rounded p-4">
                <p className="text-green-800 font-bold mb-2">✓ Data loaded successfully!</p>
                <p className="text-gray-600 text-sm">
                  Loaded {parsedData.length} days of data from "Consolidate Data-Daily Data.xlsx"
                </p>
                <p className="text-gray-500 text-xs mt-2">
                  To update data, replace the Excel file in the /data folder and refresh the page
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-bold mb-4 text-gray-800">Step 2: Current Settings</h2>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Lot Size (kits)</label>
                  <input
                    type="number"
                    value={currentSettings.lotSize}
                    onChange={(e) => setCurrentSettings({...currentSettings, lotSize: parseInt(e.target.value)})}
                    className="w-full p-2 border-2 border-gray-300 rounded"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1">Contract</label>
                  <select
                    value={currentSettings.contract}
                    onChange={(e) => setCurrentSettings({...currentSettings, contract: parseInt(e.target.value)})}
                    className="w-full p-2 border-2 border-gray-300 rounded"
                  >
                    <option value={1}>Contract 1 (7 day, $750)</option>
                    <option value={2}>Contract 2 (1 day, $1,000)</option>
                    <option value={3}>Contract 3 (0.5 day, $1,250)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Station 1 Machines</label>
                  <input
                    type="number"
                    value={currentSettings.station1Machines}
                    onChange={(e) => setCurrentSettings({...currentSettings, station1Machines: parseInt(e.target.value)})}
                    className="w-full p-2 border-2 border-gray-300 rounded"
                    min="1"
                    max="5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Station 2 Machines</label>
                  <input
                    type="number"
                    value={currentSettings.station2Machines}
                    onChange={(e) => setCurrentSettings({...currentSettings, station2Machines: parseInt(e.target.value)})}
                    className="w-full p-2 border-2 border-gray-300 rounded"
                    min="1"
                    max="5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Station 3 Machines</label>
                  <input
                    type="number"
                    value={currentSettings.station3Machines}
                    onChange={(e) => setCurrentSettings({...currentSettings, station3Machines: parseInt(e.target.value)})}
                    className="w-full p-2 border-2 border-gray-300 rounded"
                    min="1"
                    max="5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Station 2 Priority</label>
                  <select
                    value={currentSettings.station2Priority}
                    onChange={(e) => setCurrentSettings({...currentSettings, station2Priority: e.target.value})}
                    className="w-full p-2 border-2 border-gray-300 rounded"
                  >
                    <option value="FIFO">FIFO</option>
                    <option value="Step 2">Prioritize Step 2</option>
                    <option value="Step 4">Prioritize Step 4</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-bold mb-4 text-gray-800">Step 3: Financial Status</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Cash on Hand ($1000s)</label>
                  <input
                    type="number"
                    value={cashOnHand}
                    onChange={(e) => setCashOnHand(e.target.value)}
                    className="w-full p-2 border-2 border-blue-300 rounded"
                    placeholder="e.g., 52.916"
                    step="0.001"
                  />
                  <p className="text-xs text-gray-500 mt-1">Enter value in thousands</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Current Debt ($1000s)</label>
                  <input
                    type="number"
                    value={debt}
                    onChange={(e) => setDebt(e.target.value)}
                    className="w-full p-2 border-2 border-blue-300 rounded"
                    placeholder="e.g., 0"
                    step="0.001"
                  />
                  <p className="text-xs text-gray-500 mt-1">Leave as 0 if no debt</p>
                </div>

                {cashOnHand && (
                  <div className="mt-4 p-3 bg-blue-50 rounded">
                    <p className="text-sm font-medium">Net Cash Available:</p>
                    <p className="text-2xl font-bold text-blue-600">
                      ${formatNumber(((parseFloat(cashOnHand) || 0) - (parseFloat(debt) || 0)), 2)}k
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-bold mb-4 text-gray-800">Machine Costs</h2>
              
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 rounded">
                  <p className="font-medium">Station 1 (Stuffer)</p>
                  <p className="text-2xl font-bold text-blue-600">$90k</p>
                </div>
                
                <div className="p-3 bg-green-50 rounded">
                  <p className="font-medium">Station 2 (Tester)</p>
                  <p className="text-2xl font-bold text-green-600">$80k</p>
                </div>
                
                <div className="p-3 bg-yellow-50 rounded">
                  <p className="font-medium">Station 3 (Tuner)</p>
                  <p className="text-2xl font-bold text-yellow-600">$100k</p>
                </div>

                <div className="mt-4 p-3 bg-red-50 rounded border-2 border-red-300">
                  <p className="text-xs font-bold text-red-700 mb-1">Debt Terms:</p>
                  <p className="text-xs text-red-600">• 5% upfront fee</p>
                  <p className="text-xs text-red-600">• 20% annual interest</p>
                  <p className="text-xs text-red-600">• Can use debt to buy machines</p>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleRun}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg text-xl shadow-lg transition"
          >
            🚀 RUN OPTIMIZATION ALGORITHM
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-6 rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold mb-2">Test Configuration</h2>
            <p className="text-blue-100">Analysis based on last 14 days (Days {recommendations.analysis.currentDay - 13} - {recommendations.analysis.currentDay})</p>
          </div>

          {/* Current Setup Statistics */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4 text-gray-800">📊 Current Setup Statistics</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-600">Avg Lead Time</p>
              <p className="text-2xl font-bold text-blue-600">{recommendations.analysis.avgLeadTime.toFixed(2)} days</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-600">Max Lead Time</p>
              <p className="text-2xl font-bold text-orange-600">{recommendations.analysis.maxLeadTime.toFixed(2)} days</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-600">Avg Station 2 Util</p>
              <p className="text-2xl font-bold text-red-600">{(recommendations.analysis.avgUtil2 * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-600">Cash / Debt</p>
              <p className="text-2xl font-bold text-green-600">${formatNumber(recommendations.analysis.cash, 0)}k / ${formatNumber(recommendations.analysis.debt, 0)}k</p>
            </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-2xl font-bold mb-4 text-gray-800">📋 Recommended Changes</h3>
            
            <div className="space-y-3">
              {recommendations.changes.map((change, idx) => (
                <div key={idx} className={`p-4 rounded-lg border-l-4 ${getPriorityColor(change.priority)}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-bold text-lg">{change.action}</p>
                      <p className="text-sm mt-1">{change.reason}</p>
                      {change.needsDebt && (
                        <p className="text-xs mt-1 font-bold text-red-600">⚠️ Requires debt financing</p>
                      )}
                    </div>
                    <div className="ml-4 text-right">
                      <span className="text-xs font-bold px-2 py-1 rounded bg-white">{change.priority}</span>
                      {change.cost > 0 && (
                        <p className="text-sm font-bold mt-1">Cost: ${change.cost}k</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Test Configuration Section */}
          <div className="bg-purple-50 p-6 rounded-lg shadow-lg border-2 border-purple-500">
            <h3 className="text-2xl font-bold mb-4 text-purple-800">🧪 Test Configuration</h3>
            <p className="text-sm text-gray-600 mb-4">Adjust settings below to see how they affect expected revenue</p>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-1">Lot Size</label>
                <select
                  value={testSettings.lotSize}
                  onChange={(e) => setTestSettings({...testSettings, lotSize: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                >
                  <option value={12}>12 kits</option>
                  <option value={20}>20 kits</option>
                  <option value={30}>30 kits</option>
                  <option value={60}>60 kits</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Contract</label>
                <select
                  value={testSettings.contract}
                  onChange={(e) => setTestSettings({...testSettings, contract: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                >
                  <option value={1}>7 day ($750)</option>
                  <option value={2}>1 day ($1,000)</option>
                  <option value={3}>0.5 day ($1,250)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 2 Priority</label>
                <select
                  value={testSettings.station2Priority}
                  onChange={(e) => setTestSettings({...testSettings, station2Priority: e.target.value})}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                >
                  <option value="FIFO">FIFO</option>
                  <option value="Step 2">Step 2</option>
                  <option value="Step 4">Step 4</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 1 Machines</label>
                <input
                  type="number"
                  value={testSettings.station1Machines}
                  onChange={(e) => setTestSettings({...testSettings, station1Machines: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                  min="1"
                  max="5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 2 Machines</label>
                <input
                  type="number"
                  value={testSettings.station2Machines}
                  onChange={(e) => setTestSettings({...testSettings, station2Machines: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                  min="1"
                  max="5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 3 Machines</label>
                <input
                  type="number"
                  value={testSettings.station3Machines}
                  onChange={(e) => setTestSettings({...testSettings, station3Machines: parseInt(e.target.value)})}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                  min="1"
                  max="5"
                />
              </div>
            </div>

            {testProjection && recommendedProjection && (
              <>
                <div className="bg-white p-4 rounded-lg border-2 border-purple-400">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">Test Results:</h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Total Profit</p>
                      <p className="text-2xl font-bold text-green-600">${formatNumber(testProjection.totalProfit, 2)}k</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Gross Revenue</p>
                      <p className="text-xl font-bold text-blue-600">${formatNumber(testProjection.grossRevenue, 0)}k</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Material Costs</p>
                      <p className="text-xl font-bold text-red-600">${formatNumber(testProjection.totalMaterialCost, 2)}k</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Expected Rev/Job</p>
                      <p className="text-xl font-bold text-purple-600">${formatNumber(testProjection.expectedRevenuePerJob, 2)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Avg Lead Time</p>
                      <p className="text-xl font-bold text-orange-600">{formatNumber(testProjection.adjustedAvgLeadTime, 2)}d</p>
                    </div>
                  </div>

                  {/* Machine Costs and Debt Breakdown */}
                  <div className="mt-4 pt-4 border-t border-purple-200">
                    <h5 className="font-bold text-sm mb-2 text-gray-700">Machine Changes from Current:</h5>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-gray-600">Station 1 Machines:</p>
                        <p className="font-bold">
                          {currentSettings.station1Machines} → {testSettings.station1Machines}
                          {testSettings.station1Machines > currentSettings.station1Machines &&
                            <span className="text-blue-600"> (+{testSettings.station1Machines - currentSettings.station1Machines})</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">Station 2 Machines:</p>
                        <p className="font-bold">
                          {currentSettings.station2Machines} → {testSettings.station2Machines}
                          {testSettings.station2Machines > currentSettings.station2Machines &&
                            <span className="text-blue-600"> (+{testSettings.station2Machines - currentSettings.station2Machines})</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">Station 3 Machines:</p>
                        <p className="font-bold">
                          {currentSettings.station3Machines} → {testSettings.station3Machines}
                          {testSettings.station3Machines > currentSettings.station3Machines &&
                            <span className="text-blue-600"> (+{testSettings.station3Machines - currentSettings.station3Machines})</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">Total Machine Cost:</p>
                        <p className="font-bold text-red-600">${formatNumber(testProjection.totalMachineCost, 0)}k</p>
                      </div>
                    </div>
                    {testProjection.totalMachineCost > 0 && (
                      <div className="mt-3 p-3 bg-yellow-50 rounded border border-yellow-300">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div>
                            <p className="text-gray-600">Available Cash:</p>
                            <p className="font-bold">${formatNumber(recommendations.analysis.cash, 2)}k</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Machine Cost:</p>
                            <p className="font-bold">${formatNumber(testProjection.totalMachineCost, 2)}k</p>
                          </div>
                          {testProjection.totalMachineCost > recommendations.analysis.cash ? (
                            <>
                              <div>
                                <p className="text-gray-600">Debt Needed:</p>
                                <p className="font-bold text-red-600">${formatNumber(testProjection.newDebt - recommendations.analysis.debt, 2)}k</p>
                              </div>
                              <div>
                                <p className="text-gray-600">Upfront Fee (5%):</p>
                                <p className="font-bold text-red-600">${formatNumber(testProjection.upfrontFee, 2)}k</p>
                              </div>
                            </>
                          ) : (
                            <div className="col-span-2">
                              <p className="text-green-600 font-bold">✓ Sufficient cash - no debt needed</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-purple-200">
                    <div className="grid grid-cols-3 gap-2 text-xs text-center">
                      <div>
                        <p className="text-gray-600">On-time</p>
                        <p className="font-bold text-green-600">{(testProjection.probOnTime * 100).toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Partial Rev</p>
                        <p className="font-bold text-yellow-600">{(testProjection.probPartial * 100).toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Late ($0)</p>
                        <p className="font-bold text-red-600">{(testProjection.probLate * 100).toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-purple-200 text-center">
                    <p className="text-sm font-bold text-gray-700">
                      Difference from Recommended:
                      <span className={`ml-2 ${testProjection.netRevenue > recommendedProjection.netRevenue ? 'text-green-600' : 'text-red-600'}`}>
                        {testProjection.netRevenue > recommendedProjection.netRevenue ? '↑' : '↓'}
                        ${formatNumber(Math.abs(testProjection.netRevenue - recommendedProjection.netRevenue), 2)}k
                      </span>
                    </p>
                  </div>
                </div>

                {/* Profit Graph with Debt Tracking */}
                <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">📊 Daily Profit Projection with Debt Payments (M/M/c Queuing Model)</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={(() => {
                      const currentDay = recommendations?.analysis.currentDay || 0;
                      const projectionData = [];
                      let cumulativeProfit = 0;
                      let runningDebt = testProjection.newDebt;
                      let runningCash = (recommendations?.analysis.cash || 0) - testProjection.totalMachineCost;
                      const dailyInterestRate = Math.pow(1.20, 1/365) - 1; // 20% annual

                      // Simulate daily variability using Poisson arrivals
                      for (let i = 0; i < Math.min(30, testProjection.daysRemaining); i++) {
                        const day = currentDay + i + 1;

                        // Generate daily job arrivals (Poisson with λ = 10)
                        const dailyArrivals = randomPoisson(10, day * 1000);

                        // Calculate actual throughput considering capacity constraints
                        const maxCapacity = testProjection.avgJobsPerDay * 1.2; // 20% above average
                        const actualJobs = Math.min(dailyArrivals, maxCapacity);

                        // Revenue and costs based on actual jobs completed
                        const revenuePerJob = testProjection.expectedRevenuePerJob;
                        const materialCostPerJob = testProjection.dailyMaterialCost / testProjection.avgJobsPerDay;

                        const dailyRev = actualJobs * revenuePerJob;
                        const dailyCost = actualJobs * materialCostPerJob;

                        // Calculate daily interest on debt
                        const dailyInterest = runningDebt > 0 ? runningDebt * dailyInterestRate : 0;

                        // Calculate profit after material costs and interest
                        const profitBeforeDebt = dailyRev - dailyCost;
                        const netProfit = profitBeforeDebt - dailyInterest;

                        // Update cash and debt (optimal paydown: use excess cash to pay debt)
                        runningCash += netProfit;
                        let debtPayment = 0;
                        if (runningDebt > 0 && runningCash > 10) { // Keep $10k cash buffer
                          debtPayment = Math.min(runningDebt, runningCash - 10);
                          runningCash -= debtPayment;
                          runningDebt -= debtPayment;
                        }

                        cumulativeProfit += netProfit;

                        projectionData.push({
                          day: day,
                          revenue: parseFloat(dailyRev.toFixed(2)),
                          materialCost: parseFloat(dailyCost.toFixed(2)),
                          interest: parseFloat(dailyInterest.toFixed(2)),
                          profit: parseFloat(netProfit.toFixed(2)),
                          cumulative: parseFloat(cumulativeProfit.toFixed(2)),
                          debt: parseFloat(runningDebt.toFixed(2)),
                          debtPayment: parseFloat(debtPayment.toFixed(2)),
                          cash: parseFloat(runningCash.toFixed(2))
                        });
                      }
                      return projectionData;
                    })()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" label={{ value: 'Day', position: 'insideBottom', offset: -5 }} />
                      <YAxis label={{ value: 'Amount ($k)', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} name="Daily Revenue" />
                      <Line type="monotone" dataKey="materialCost" stroke="#ef4444" strokeWidth={2} name="Material Cost" />
                      <Line type="monotone" dataKey="interest" stroke="#f59e0b" strokeWidth={2} name="Interest Payment" />
                      <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={3} name="Net Profit (after interest)" />
                    </LineChart>
                  </ResponsiveContainer>

                  <div className="mt-4 p-3 bg-purple-50 rounded">
                    <div className="grid grid-cols-4 gap-4 text-center">
                      <div>
                        <p className="text-xs text-gray-600">Avg Daily Revenue</p>
                        <p className="text-lg font-bold text-blue-600">${formatNumber(testProjection.dailyRevenue, 2)}k</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Avg Daily Material Cost</p>
                        <p className="text-lg font-bold text-red-600">${formatNumber(testProjection.dailyMaterialCost, 2)}k</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Avg Daily Interest</p>
                        <p className="text-lg font-bold text-orange-600">${formatNumber((testProjection.newDebt * (Math.pow(1.20, 1/365) - 1)), 3)}k</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Avg Daily Net Profit</p>
                        <p className="text-lg font-bold text-green-600">${formatNumber((testProjection.dailyProfit - (testProjection.newDebt * (Math.pow(1.20, 1/365) - 1))), 2)}k</p>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-purple-200">
                      <p className="text-xs text-gray-700 mb-2"><strong>M/M/c Queuing Model:</strong></p>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-gray-600">Arrival Rate (λ):</p>
                          <p className="font-bold">10 jobs/day (Poisson)</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Throughput:</p>
                          <p className="font-bold">{testProjection.avgJobsPerDay.toFixed(2)} jobs/day</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Station 1 Capacity:</p>
                          <p className="font-bold">{(testSettings.station1Machines * 4.0).toFixed(1)} jobs/day
                            {Math.min(
                              testSettings.station1Machines * 4.0,
                              (testSettings.station2Machines * 3.5) / 2, // Station 2 used twice per job
                              testSettings.station3Machines * 4.2
                            ) === testSettings.station1Machines * 4.0 && ' 🔴'}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-600">Station 2 Capacity:</p>
                          <p className="font-bold">{((testSettings.station2Machines * 3.5) / 2).toFixed(1)} jobs/day
                            {Math.min(
                              testSettings.station1Machines * 4.0,
                              (testSettings.station2Machines * 3.5) / 2,
                              testSettings.station3Machines * 4.2
                            ) === (testSettings.station2Machines * 3.5) / 2 && ' 🔴'}
                          </p>
                          <p className="text-xs text-gray-500">(÷2: each job uses Station 2 twice)</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Station 3 Capacity:</p>
                          <p className="font-bold">{(testSettings.station3Machines * 4.2).toFixed(1)} jobs/day
                            {Math.min(
                              testSettings.station1Machines * 4.0,
                              (testSettings.station2Machines * 3.5) / 2,
                              testSettings.station3Machines * 4.2
                            ) === testSettings.station3Machines * 4.2 && ' 🔴'}
                          </p>
                        </div>
                        <div className="col-span-2 mt-2 p-2 bg-yellow-50 rounded">
                          <p className="text-gray-700 text-xs">
                            <strong>🔴 = Bottleneck Station</strong> - Add machines here to increase throughput and revenue!
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-600">System Utilization:</p>
                          <p className="font-bold">{((testProjection.avgJobsPerDay / Math.min(
                            testSettings.station1Machines * 4.0,
                            (testSettings.station2Machines * 3.5) / 2,
                            testSettings.station3Machines * 4.2
                          )) * 100).toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Projected Station Utilization */}
                <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">📊 Projected Station Utilization (Current → Day 318)</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={(() => {
                      const currentDay = recommendations?.analysis.currentDay || 0;
                      const projectionData = [];
                      const daysToProject = Math.min(318 - currentDay, 100); // Show up to 100 days

                      // Calculate utilization based on test settings
                      const avgJobs = testProjection.avgJobsPerDay;
                      const util1 = (avgJobs / (testSettings.station1Machines * 4.0)) * 100;
                      const util2 = ((avgJobs * 2) / (testSettings.station2Machines * 3.5)) * 100; // Jobs pass through twice
                      const util3 = (avgJobs / (testSettings.station3Machines * 4.2)) * 100;

                      // Add some variability to make it realistic
                      for (let i = 0; i <= daysToProject; i++) {
                        const day = currentDay + i;
                        const variance = Math.sin(i / 5) * 3; // ±3% variation

                        projectionData.push({
                          day: day,
                          Station1: parseFloat(Math.max(0, Math.min(100, util1 + variance)).toFixed(1)),
                          Station2: parseFloat(Math.max(0, Math.min(100, util2 + variance)).toFixed(1)),
                          Station3: parseFloat(Math.max(0, Math.min(100, util3 + variance)).toFixed(1))
                        });
                      }
                      return projectionData;
                    })()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" label={{ value: 'Day', position: 'insideBottom', offset: -5 }} />
                      <YAxis label={{ value: 'Utilization %', angle: -90, position: 'insideLeft' }} domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="Station1" stroke="#3b82f6" strokeWidth={2} />
                      <Line type="monotone" dataKey="Station2" stroke="#ef4444" strokeWidth={2} />
                      <Line type="monotone" dataKey="Station3" stroke="#eab308" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="mt-3 p-3 bg-purple-50 rounded">
                    <p className="text-xs text-gray-700">
                      <strong>Expected Utilization:</strong> Station 1: {((testProjection.avgJobsPerDay / (testSettings.station1Machines * 4.0)) * 100).toFixed(1)}%,
                      Station 2: {(((testProjection.avgJobsPerDay * 2) / (testSettings.station2Machines * 3.5)) * 100).toFixed(1)}%,
                      Station 3: {((testProjection.avgJobsPerDay / (testSettings.station3Machines * 4.2)) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Projected Queue Sizes */}
                <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">📊 Projected Queue Sizes (Current → Day 318)</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={(() => {
                      const currentDay = recommendations?.analysis.currentDay || 0;
                      const projectionData = [];
                      const daysToProject = Math.min(318 - currentDay, 100);

                      // Calculate expected queue sizes using M/M/c approximation
                      const avgJobs = testProjection.avgJobsPerDay;
                      const util1 = avgJobs / (testSettings.station1Machines * 4.0);
                      const util2 = (avgJobs * 2) / (testSettings.station2Machines * 3.5);
                      const util3 = avgJobs / (testSettings.station3Machines * 4.2);

                      // Queue length approximation: L = ρ/(1-ρ) * ρ for high utilization
                      const calcQueue = (util: number) => {
                        if (util >= 0.95) return 200; // Very high queue
                        if (util < 0.5) return 5; // Low queue
                        return (util / (1 - util)) * 50; // Scale factor for kits
                      };

                      const queue1Base = calcQueue(util1);
                      const queue2Base = calcQueue(util2);
                      const queue3Base = calcQueue(util3);

                      for (let i = 0; i <= daysToProject; i++) {
                        const day = currentDay + i;
                        const variance = Math.sin(i / 3) * 0.2 + 1; // 80-120% variation

                        projectionData.push({
                          day: day,
                          Station1: parseFloat((queue1Base * variance).toFixed(1)),
                          Station2: parseFloat((queue2Base * variance).toFixed(1)),
                          Station3: parseFloat((queue3Base * variance).toFixed(1))
                        });
                      }
                      return projectionData;
                    })()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" label={{ value: 'Day', position: 'insideBottom', offset: -5 }} />
                      <YAxis label={{ value: 'Kits in Queue', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="Station1" stroke="#3b82f6" strokeWidth={2} />
                      <Line type="monotone" dataKey="Station2" stroke="#ef4444" strokeWidth={2} />
                      <Line type="monotone" dataKey="Station3" stroke="#eab308" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Projected WIP */}
                <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">📊 Projected WIP - Jobs Waiting for Kits (Current → Day 318)</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={(() => {
                      const currentDay = recommendations?.analysis.currentDay || 0;
                      const projectionData = [];
                      const daysToProject = Math.min(318 - currentDay, 100);

                      // WIP depends on Station 1 queue and arrival rate
                      const avgJobs = testProjection.avgJobsPerDay;
                      const util1 = avgJobs / (testSettings.station1Machines * 4.0);

                      // Higher Station 1 utilization = more jobs waiting for kits
                      const baseWIP = util1 > 0.8 ? util1 * 15 : util1 * 5;

                      for (let i = 0; i <= daysToProject; i++) {
                        const day = currentDay + i;
                        const variance = Math.sin(i / 4) * 0.3 + 1; // 70-130% variation

                        projectionData.push({
                          day: day,
                          queuedJobs: parseFloat((baseWIP * variance).toFixed(1))
                        });
                      }
                      return projectionData;
                    })()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" label={{ value: 'Day', position: 'insideBottom', offset: -5 }} />
                      <YAxis label={{ value: 'Jobs', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="queuedJobs" stroke="#8b5cf6" strokeWidth={3} name="Jobs Queued for Kits" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Debt Payment Schedule */}
                <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">💰 Debt Payment Schedule (Current → Day 318)</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={(() => {
                      const currentDay = recommendations?.analysis.currentDay || 0;
                      const projectionData = [];
                      const daysToProject = Math.min(318 - currentDay, 100);

                      let runningDebt = testProjection.newDebt;
                      let runningCash = (recommendations?.analysis.cash || 0) - testProjection.totalMachineCost;
                      const dailyInterestRate = Math.pow(1.20, 1/365) - 1; // 20% annual
                      const avgJobs = testProjection.avgJobsPerDay;
                      const revenuePerJob = testProjection.expectedRevenuePerJob;
                      const materialCostPerJob = testProjection.dailyMaterialCost / avgJobs;

                      for (let i = 0; i <= daysToProject; i++) {
                        const day = currentDay + i;

                        // Daily operations (use average throughput)
                        const dailyRev = avgJobs * revenuePerJob;
                        const dailyCost = avgJobs * materialCostPerJob;
                        const dailyInterest = runningDebt > 0 ? runningDebt * dailyInterestRate : 0;
                        const netProfit = dailyRev - dailyCost - dailyInterest;

                        // Update cash and debt (optimal paydown strategy)
                        runningCash += netProfit;
                        let debtPayment = 0;
                        if (runningDebt > 0 && runningCash > 10) { // Keep $10k cash buffer
                          debtPayment = Math.min(runningDebt, runningCash - 10);
                          runningCash -= debtPayment;
                          runningDebt -= debtPayment;
                        }

                        projectionData.push({
                          day: day,
                          debt: parseFloat(runningDebt.toFixed(2)),
                          cash: parseFloat(runningCash.toFixed(2)),
                          debtPayment: parseFloat(debtPayment.toFixed(2)),
                          interest: parseFloat(dailyInterest.toFixed(3))
                        });
                      }
                      return projectionData;
                    })()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" label={{ value: 'Day', position: 'insideBottom', offset: -5 }} />
                      <YAxis label={{ value: 'Amount ($k)', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="debt" stroke="#dc2626" strokeWidth={3} name="Remaining Debt" />
                      <Line type="monotone" dataKey="cash" stroke="#10b981" strokeWidth={2} name="Cash Balance" />
                      <Line type="monotone" dataKey="debtPayment" stroke="#3b82f6" strokeWidth={2} name="Daily Debt Payment" />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="mt-3 p-3 bg-purple-50 rounded">
                    <p className="text-xs text-gray-700">
                      <strong>Payment Strategy:</strong> Optimal debt paydown - use excess cash (above $10k buffer) to pay debt as quickly as possible.
                      {testProjection.newDebt > 0 ? ` Initial debt: $${formatNumber(testProjection.newDebt, 2)}k at 20% annual interest (${formatNumber(((Math.pow(1.20, 1/365) - 1) * 100), 3)}% daily).` : ' No debt incurred.'}
                    </p>
                  </div>
                </div>

                {/* Kit Orders Graph */}
                <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">📦 Kit Order Schedule (Current → Day 318)</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={(() => {
                      const currentDay = recommendations?.analysis.currentDay || 0;
                      const projectionData = [];
                      const daysToProject = Math.min(318 - currentDay, 100);

                      // Kit ordering parameters
                      const kitsPerJob = 60;
                      const costPerKit = 0.010; // $10 per kit = $0.010k
                      const fixedOrderCost = 1.0; // $1,000 per order
                      const orderQuantity = 7200; // 7,200 kits
                      const leadTime = 2; // Assume 2 day lead time for kit delivery

                      // Initial inventory (estimate based on current operations)
                      let kitsInventory = 1000; // Starting inventory estimate
                      const avgJobs = testProjection.avgJobsPerDay;

                      // Calculate reorder point: (lead time × daily consumption) + safety stock
                      const dailyConsumption = avgJobs * kitsPerJob;
                      const safetyStock = dailyConsumption * 1.5; // 1.5 days of safety stock
                      const reorderPoint = (leadTime * dailyConsumption) + safetyStock;

                      let runningCash = (recommendations?.analysis.cash || 0) - testProjection.totalMachineCost;
                      let runningDebt = testProjection.newDebt;
                      const dailyInterestRate = Math.pow(1.20, 1/365) - 1;
                      const revenuePerJob = testProjection.expectedRevenuePerJob;
                      const materialCostPerJob = testProjection.dailyMaterialCost / avgJobs;

                      let orderInTransit = false;
                      let orderArrivalDay = 0;

                      for (let i = 0; i <= daysToProject; i++) {
                        const day = currentDay + i;

                        // Check if order arrives today
                        if (orderInTransit && day >= orderArrivalDay) {
                          kitsInventory += orderQuantity;
                          orderInTransit = false;
                        }

                        // Daily consumption
                        const jobsCompleted = avgJobs;
                        const kitsUsed = jobsCompleted * kitsPerJob;
                        kitsInventory -= kitsUsed;

                        // Daily cash flow
                        const dailyRev = jobsCompleted * revenuePerJob;
                        const dailyCost = jobsCompleted * materialCostPerJob;
                        const dailyInterest = runningDebt > 0 ? runningDebt * dailyInterestRate : 0;
                        const netProfit = dailyRev - dailyCost - dailyInterest;
                        runningCash += netProfit;

                        // Optimal debt paydown
                        if (runningDebt > 0 && runningCash > 10) {
                          const debtPayment = Math.min(runningDebt, runningCash - 10);
                          runningCash -= debtPayment;
                          runningDebt -= debtPayment;
                        }

                        // Check ordering conditions
                        let orderPlaced = 0;
                        const orderCost = (orderQuantity * costPerKit) + fixedOrderCost;

                        if (kitsInventory <= reorderPoint &&
                            !orderInTransit &&
                            runningCash >= orderCost &&
                            orderQuantity > 0) {
                          // Place order
                          orderPlaced = 1;
                          runningCash -= orderCost;
                          orderInTransit = true;
                          orderArrivalDay = day + leadTime;
                        }

                        projectionData.push({
                          day: day,
                          inventory: parseFloat(kitsInventory.toFixed(0)),
                          orderPlaced: orderPlaced,
                          reorderPoint: parseFloat(reorderPoint.toFixed(0)),
                          consumption: parseFloat(kitsUsed.toFixed(0))
                        });
                      }
                      return projectionData;
                    })()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" label={{ value: 'Day', position: 'insideBottom', offset: -5 }} />
                      <YAxis label={{ value: 'Kits', angle: -90, position: 'insideLeft' }} />
                      <Tooltip content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-white p-3 border-2 border-purple-300 rounded shadow-lg">
                              <p className="font-bold">Day {data.day}</p>
                              <p className="text-sm">Inventory: {formatNumber(data.inventory, 0)} kits</p>
                              <p className="text-sm">Reorder Point: {formatNumber(data.reorderPoint, 0)} kits</p>
                              <p className="text-sm">Daily Usage: {formatNumber(data.consumption, 0)} kits</p>
                              {data.orderPlaced === 1 && (
                                <p className="text-sm font-bold text-green-600">📦 Order Placed!</p>
                              )}
                            </div>
                          );
                        }
                        return null;
                      }} />
                      <Legend />
                      <Line type="monotone" dataKey="inventory" stroke="#3b82f6" strokeWidth={3} name="Kits Inventory" />
                      <Line type="monotone" dataKey="reorderPoint" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Reorder Point" />
                      <Line type="monotone" dataKey="orderPlaced" stroke="#10b981" strokeWidth={0} name="Order Placed"
                        dot={(props: { cx?: number; cy?: number; payload?: { orderPlaced?: number } }) => {
                          if (props.payload?.orderPlaced === 1) {
                            return (
                              <circle cx={props.cx} cy={props.cy} r={6} fill="#10b981" stroke="#fff" strokeWidth={2} />
                            );
                          }
                          return null;
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="mt-3 p-3 bg-purple-50 rounded">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-gray-600">Order Quantity:</p>
                        <p className="font-bold">7,200 kits</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Order Cost:</p>
                        <p className="font-bold">$73k ($10/kit + $1k fixed)</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Daily Usage:</p>
                        <p className="font-bold">{formatNumber((testProjection.avgJobsPerDay * 60), 0)} kits</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Lead Time:</p>
                        <p className="font-bold">2 days</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-700 mt-2">
                      <strong>Order Logic:</strong> Order when inventory ≤ reorder point AND no order in transit AND sufficient cash AND order qty &gt; 0.
                      Reorder point = (lead time × daily usage) + safety stock.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-bold mb-4 text-gray-800">Current Configuration</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between p-2 bg-gray-50 rounded">
                  <span>Lot Size:</span>
                  <span className="font-bold">{currentSettings.lotSize} kits</span>
                </div>
                <div className="flex justify-between p-2 bg-gray-50 rounded">
                  <span>Contract:</span>
                  <span className="font-bold">
                    {currentSettings.contract === 1 ? '7 day, $750' : 
                     currentSettings.contract === 2 ? '1 day, $1,000' : '0.5 day, $1,250'}
                  </span>
                </div>
                <div className="flex justify-between p-2 bg-gray-50 rounded">
                  <span>Station 1 Machines:</span>
                  <span className="font-bold">{currentSettings.station1Machines}</span>
                </div>
                <div className="flex justify-between p-2 bg-gray-50 rounded">
                  <span>Station 2 Machines:</span>
                  <span className="font-bold">{currentSettings.station2Machines}</span>
                </div>
                <div className="flex justify-between p-2 bg-gray-50 rounded">
                  <span>Station 3 Machines:</span>
                  <span className="font-bold">{currentSettings.station3Machines}</span>
                </div>
                <div className="flex justify-between p-2 bg-gray-50 rounded">
                  <span>Station 2 Priority:</span>
                  <span className="font-bold">{currentSettings.station2Priority}</span>
                </div>
              </div>
            </div>

            <div className="bg-green-50 p-6 rounded-lg shadow-md border-2 border-green-500">
              <h3 className="text-xl font-bold mb-4 text-green-800">Recommended Configuration</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between p-2 bg-white rounded">
                  <span>Lot Size:</span>
                  <span className={`font-bold ${recommendations.lotSize !== currentSettings.lotSize ? 'text-green-600' : ''}`}>
                    {recommendations.lotSize} kits
                    {recommendations.lotSize !== currentSettings.lotSize && ' ⬆️'}
                  </span>
                </div>
                <div className="flex justify-between p-2 bg-white rounded">
                  <span>Contract:</span>
                  <span className={`font-bold ${recommendations.contract !== currentSettings.contract ? 'text-green-600' : ''}`}>
                    {recommendations.contract === 1 ? '7 day, $750' : 
                     recommendations.contract === 2 ? '1 day, $1,000' : '0.5 day, $1,250'}
                    {recommendations.contract !== currentSettings.contract && ' ⬆️'}
                  </span>
                </div>
                <div className="flex justify-between p-2 bg-white rounded">
                  <span>Station 1 Machines:</span>
                  <span className={`font-bold ${recommendations.station1Machines !== currentSettings.station1Machines ? 'text-green-600' : ''}`}>
                    {recommendations.station1Machines}
                    {recommendations.station1Machines !== currentSettings.station1Machines && ' ⬆️'}
                  </span>
                </div>
                <div className="flex justify-between p-2 bg-white rounded">
                  <span>Station 2 Machines:</span>
                  <span className={`font-bold ${recommendations.station2Machines !== currentSettings.station2Machines ? 'text-green-600' : ''}`}>
                    {recommendations.station2Machines}
                    {recommendations.station2Machines !== currentSettings.station2Machines && ' ⬆️'}
                  </span>
                </div>
                <div className="flex justify-between p-2 bg-white rounded">
                  <span>Station 3 Machines:</span>
                  <span className={`font-bold ${recommendations.station3Machines !== currentSettings.station3Machines ? 'text-green-600' : ''}`}>
                    {recommendations.station3Machines}
                    {recommendations.station3Machines !== currentSettings.station3Machines && ' ⬆️'}
                  </span>
                </div>
                <div className="flex justify-between p-2 bg-white rounded">
                  <span>Station 2 Priority:</span>
                  <span className={`font-bold ${recommendations.station2Priority !== currentSettings.station2Priority ? 'text-green-600' : ''}`}>
                    {recommendations.station2Priority}
                    {recommendations.station2Priority !== currentSettings.station2Priority && ' ⬆️'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {utilizationData.length > 0 && (
            <>
              <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-xl font-bold mb-4 text-gray-800">Station Utilization (Last 30 Days)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={utilizationData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis label={{ value: 'Utilization %', angle: -90, position: 'insideLeft' }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="Station1" stroke="#3b82f6" strokeWidth={2} />
                    <Line type="monotone" dataKey="Station2" stroke="#ef4444" strokeWidth={2} />
                    <Line type="monotone" dataKey="Station3" stroke="#eab308" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-xl font-bold mb-4 text-gray-800">Queue Sizes (Last 30 Days)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={queueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis label={{ value: 'Kits in Queue', angle: -90, position: 'insideLeft' }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="Station1" stroke="#3b82f6" strokeWidth={2} />
                    <Line type="monotone" dataKey="Station2" stroke="#ef4444" strokeWidth={2} />
                    <Line type="monotone" dataKey="Station3" stroke="#eab308" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-xl font-bold mb-4 text-gray-800">WIP - Jobs Waiting for Kits (Last 30 Days)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={wipData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis label={{ value: 'Jobs', angle: -90, position: 'insideLeft' }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="queuedJobs" stroke="#8b5cf6" strokeWidth={3} name="Jobs Queued for Kits" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-xl font-bold mb-4 text-gray-800">Lead Time Performance (Last 30 Days)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={leadTimeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis label={{ value: 'Lead Time (days)', angle: -90, position: 'insideLeft' }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="leadTime" stroke="#10b981" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <button
            onClick={handleReset}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition"
          >
            ← Back to Input
          </button>
        </div>
      )}
    </div>
  );
};

export default LittlefieldAnalysis;