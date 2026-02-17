import React, { useState, useMemo, useTransition } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import * as XLSX from 'xlsx';
import type { Change, Bottleneck, Analysis, Config } from '../types';
import { JobFlowChart } from '../components/charts/JobFlowChart';
import { JobsByStationChart } from '../components/charts/JobsByStationChart';
import { AsyncChart } from '../components/charts/AsyncChart';
import { useProjectionData } from '../hooks/useProjectionData';
import { runSimulationForCash, runTimelineSimulation } from '../utils/simulationEngine';

// Number formatting utility
const formatNumber = (num: number, decimals: number = 0): string => {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

type InventoryState = {
  inventory: number;
  orderInTransit: boolean;
  orderArrivalDay: number;
};

const LittlefieldAnalysis = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [,] = useTransition();

  const [csvData, setCsvData] = useState('');
  const [dataFileName, setDataFileName] = useState('');
  const [transactionData, setTransactionData] = useState('');
  const [transactionFileName, setTransactionFileName] = useState('');
  const [cashOnHand, setCashOnHand] = useState('');
  const [debt, setDebt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Initial system defaults (before any transactions)
  const initialDefaults = {
    lotSize: 60,
    contract: 1,
    station1Machines: 3,
    station2Machines: 1,
    station3Machines: 1,
    station2Priority: 'FIFO',
    materialReorderPoint: 1200,
    materialOrderQty: 7200
  };

  const [currentSettings, setCurrentSettings] = useState(initialDefaults);

  const handleFileUpload = async (file: File) => {
    try {
      setLoading(true);
      setError('');
      setDataFileName(file.name);

      const arrayBuffer = await file.arrayBuffer();
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

  const handleTransactionFileUpload = async (file: File) => {
    try {
      setTransactionFileName(file.name);

      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Get the first sheet
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

      // Convert to tab-separated values (TSV)
      const tsvData = XLSX.utils.sheet_to_csv(firstSheet, { FS: '\t' });

      setTransactionData(tsvData);
    } catch (err) {
      // Don't set error state - transaction history is optional
    }
  };

  // Test scenario state
  const [testSettings, setTestSettings] = useState(() => ({
    ...currentSettings
  }));

  // Active test settings (only set when user clicks "Run")
  const [activeTestSettings, setActiveTestSettings] = useState<Config | null>(null);

  // Handler for running test simulation
  const handleRunTestSimulation = () => {
    setActiveTestSettings({...testSettings});
  };

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

  // Parse transaction history
  const parsedTransactions = useMemo(() => {
    if (!transactionData) return [];

    const lines = transactionData.trim().split('\n');
    const dataLines = lines.slice(1); // Skip header row

    return dataLines.map(line => {
      const values = line.split('\t');
      // Remove commas from value before parsing (e.g., "1,500" -> "1500")
      const rawValue = (values[3] || '').replace(/,/g, '');
      return {
        day: parseFloat(values[0]) || 0, // Use parseFloat to preserve fractional days like 50.02, 50.04
        parameter: (values[2] || '').trim(),
        value: parseFloat(rawValue) || 0
      };
    }).filter(t => t.day > 0 && t.parameter);
  }, [transactionData]);

  // Calculate adjustments from transaction history and extract latest settings
  const transactionAdjustments = useMemo(() => {
    const machinePurchases: { day: number; station: number; count: number }[] = [];
    const settingChanges: { day: number; parameter: string; value: number }[] = [];

    // Track latest values for each setting
    const latestSettings = { ...initialDefaults };
    let hasChanges = false;

    // Sort transactions by day to ensure we process them chronologically
    const sortedTransactions = [...parsedTransactions].sort((a, b) => a.day - b.day);

    sortedTransactions.forEach(t => {

      // Machine counts
      if (t.parameter.includes('machine count')) {
        const stationMatch = t.parameter.match(/Station (\d+)/);
        if (stationMatch) {
          const station = parseInt(stationMatch[1]);
          machinePurchases.push({ day: t.day, station, count: t.value });

          // Update latest machine count
          if (station === 1) latestSettings.station1Machines = t.value;
          else if (station === 2) latestSettings.station2Machines = t.value;
          else if (station === 3) latestSettings.station3Machines = t.value;
          hasChanges = true;
        }
      }
      // Reorder point (values are already in actual kits, e.g., 1500 kits)
      else if (t.parameter.includes('Reorder point')) {
        settingChanges.push({ day: t.day, parameter: t.parameter, value: t.value });
        latestSettings.materialReorderPoint = Math.round(t.value);
        hasChanges = true;
      }
      // Reorder quantity (values are already in actual kits, e.g., 7200 kits)
      else if (t.parameter.includes('Reorder quantity')) {
        settingChanges.push({ day: t.day, parameter: t.parameter, value: t.value });
        latestSettings.materialOrderQty = Math.round(t.value);
        hasChanges = true;
      }
      // Lots per job (lot size) - handle both "Lots per job" and "Lots per order"
      else if (t.parameter.includes('Lots per job') || t.parameter.includes('Lots per order')) {
        settingChanges.push({ day: t.day, parameter: t.parameter, value: t.value });
        // Lots per job = 60 / lotSize, so lotSize = 60 / lotsPerJob
        if (t.value > 0) {
          latestSettings.lotSize = Math.round(60 / t.value);
          hasChanges = true;
        }
      }
    });

    // Calculate total machine cost (compare to initial defaults)
    const machineCostPerUnit = 90; // $90k per machine
    const totalMachineCost =
      (latestSettings.station1Machines - initialDefaults.station1Machines) * machineCostPerUnit +
      (latestSettings.station2Machines - initialDefaults.station2Machines) * machineCostPerUnit +
      (latestSettings.station3Machines - initialDefaults.station3Machines) * machineCostPerUnit;

    return {
      machinePurchases,
      settingChanges,
      totalMachineCost: Math.max(0, totalMachineCost),
      latestSettings,
      hasChanges
    };
  }, [parsedTransactions, initialDefaults]);

  // Function to get settings at a specific day based on transaction history
  const getSettingsAtDay = (day: number): Config => {
    const settings = { ...initialDefaults };

    // Apply all transactions up to and including this day (including fractional days like 50.02, 50.04)
    parsedTransactions
      .filter(t => t.day < day + 1)
      .forEach(t => {
        if (t.parameter.includes('machine count')) {
          const stationMatch = t.parameter.match(/Station (\d+)/);
          if (stationMatch) {
            const station = parseInt(stationMatch[1]);
            if (station === 1) settings.station1Machines = t.value;
            else if (station === 2) settings.station2Machines = t.value;
            else if (station === 3) settings.station3Machines = t.value;
          }
        } else if (t.parameter.includes('Reorder point')) {
          settings.materialReorderPoint = Math.round(t.value);
        } else if (t.parameter.includes('Reorder quantity')) {
          settings.materialOrderQty = Math.round(t.value);
        } else if (t.parameter.includes('Lots per job') || t.parameter.includes('Lots per order')) {
          if (t.value > 0) {
            settings.lotSize = Math.round(60 / t.value);
          }
        }
      });

    return settings;
  };

  // Auto-update current settings when transaction history is loaded (only once)
  const hasUpdatedFromTransactions = React.useRef(false);
  React.useEffect(() => {
    if (transactionAdjustments.hasChanges && !hasUpdatedFromTransactions.current) {
      setCurrentSettings(transactionAdjustments.latestSettings);
      hasUpdatedFromTransactions.current = true;
    }
  }, [transactionAdjustments.hasChanges, transactionAdjustments.latestSettings]);

  React.useEffect(() => {
    if (parsedData.length > 0) {
      const last = parsedData[parsedData.length - 1];
      setCashOnHand(String(last.cashBalance));
    } else {
      setCashOnHand('');
    }
  }, [parsedData]);

  // Download projection data as Excel in historical format
  const downloadProjectionExcel = (projectionData: any[], settings: Config, filename: string) => {
    if (!projectionData || projectionData.length === 0) {
      alert('No projection data available to download');
      return;
    }

    // Create header rows to match original Excel structure
    const header1 = [
      'Days',
      '', 'Customer Orders', '', '',
      '', 'Station 1', '', '',
      '', 'Station 2', '', '',
      '', 'Station 3', '', '',
      'Average number of installed machines',
      'Number of completed jobs each day',
      '', 'Completed Jobs', '', '', '', '', '', '',
      'Daily average job lead time',
      '', 'Cash', '', ''
    ];

    const header2 = [
      '',
      'Daily average customer orders waiting for kits', 'Number of jobs accepted each day', '', '',
      'Average kits in queue', 'Utilization of station', 'Average number of installed machines', '',
      'Average kits in queue', 'Utilization of station', 'Average number of installed machines', '',
      'Average kits in queue', 'Utilization of station', 'Average number of installed machines', '',
      '',
      '',
      'Daily average revenue per job', 'Jobs out 1', 'Jobs out 2', 'Jobs out 3', 'Revenue 1', 'Revenue 2', 'Revenue 3',
      '',
      'Cash balance at end of day ($1000)', 'Lead time 1', 'Lead time 2', 'Lead time 3'
    ];

    // Format data rows
    const dataRows = projectionData.map(d => [
      d.day,
      d.jobsWaitingForKits || 0,
      d.jobsAccepted || 0,
      '', // Empty
      '', // Empty
      d.lotsWaitingS1 || 0, // Station 1 queue
      d.lotsProcessingS1 || 0, // Station 1 utilization
      settings.station1Machines, // Station 1 machines
      '', // Empty
      d.lotsWaitingS2 || 0, // Station 2 queue
      d.lotsProcessingS2 || 0, // Station 2 utilization
      settings.station2Machines, // Station 2 machines
      '', // Empty
      d.lotsWaitingS3 || 0, // Station 3 queue
      d.lotsProcessingS3 || 0, // Station 3 utilization
      settings.station3Machines, // Station 3 machines
      '', // Empty
      settings.station1Machines + settings.station2Machines + settings.station3Machines, // Total machines
      d.jobsCompleting || 0, // Jobs completed
      d.jobsCompleting > 0 ? ((d.revenue * 1000) / d.jobsCompleting) : 0, // Avg revenue per job
      '', // Jobs out 1
      '', // Jobs out 2
      '', // Jobs out 3
      '', // Revenue 1
      '', // Revenue 2
      d.revenue || 0, // Revenue 3 (total)
      d.avgLeadTime || 0, // Lead time
      d.cash || 0, // Cash balance
      '', // Lead time 1
      '', // Lead time 2
      '' // Lead time 3
    ]);

    // Combine headers and data
    const allData = [header1, header2, ...dataRows];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(allData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Projection');

    // Download
    XLSX.writeFile(workbook, filename);
  };

  // Calculate profit projection with lead time penalties, material costs, and M/M/c queuing
  const calculateProfitProjection = (
    config: Config,
    currentDay: number,
    currentCash: number,
    currentDebt: number,
    inventoryState: InventoryState
  ) => {
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

    // Material costs (order-based)
    const kitsPerJob = 60;
    const costPerKit = 0.010; // $10 per kit = $0.010k
    const fixedOrderCost = 1.0; // $1,000 per order = $1k
    const orderQuantity = Math.max(0, config.materialOrderQty);
    const reorderPoint = Math.max(0, config.materialReorderPoint);
    const materialLeadTimeDays = 3;
    const orderCost = (orderQuantity * costPerKit) + fixedOrderCost;

    let totalMaterialCost = 0;
    let kitsInventory = inventoryState.inventory;
    let orderInTransit = inventoryState.orderInTransit;
    let orderArrivalDay = inventoryState.orderArrivalDay;
    let queuedJobs = 0; // Jobs waiting for kits in projection
    let runningCashForMaterials = currentCash - totalMachineCost - upfrontFee;

    const revenuePerJob = expectedRevenuePerJob;
    const dailyInterestRateForCash = Math.pow(1.20, 1/365) - 1;

    for (let i = 0; i < daysRemaining; i++) {
      const day = currentDay + i + 1;

      if (orderInTransit && day >= orderArrivalDay) {
        kitsInventory += orderQuantity;
        orderInTransit = false;
      }

      // Process kit consumption with queue tracking (similar to historical)
      // 1. Release queued jobs first
      const jobsFromQueue = Math.min(queuedJobs, Math.floor(kitsInventory / kitsPerJob));
      kitsInventory -= jobsFromQueue * kitsPerJob;
      queuedJobs -= jobsFromQueue;

      // 2. Try to start new jobs (avgJobsPerDay demand)
      const maxNewJobs = Math.floor(kitsInventory / kitsPerJob);
      const newJobsStarted = Math.min(avgJobsPerDay, maxNewJobs);
      kitsInventory -= newJobsStarted * kitsPerJob;

      // 3. Jobs that can't start go to queue
      const jobsAddedToQueue = avgJobsPerDay - newJobsStarted;
      queuedJobs += jobsAddedToQueue;

      // Total jobs completed (for revenue calculation)
      const jobsCompleted = jobsFromQueue + newJobsStarted;

      const dailyRev = jobsCompleted * revenuePerJob;
      const dailyInterest = currentDebt > 0 ? currentDebt * dailyInterestRateForCash : 0;
      runningCashForMaterials += (dailyRev - dailyInterest);

      if (kitsInventory <= reorderPoint &&
          !orderInTransit &&
          runningCashForMaterials >= orderCost &&
          orderQuantity > 0) {
        totalMaterialCost += orderCost;
        runningCashForMaterials -= orderCost;
        orderInTransit = true;
        orderArrivalDay = day + materialLeadTimeDays;
      }
    }

    const dailyMaterialCost = daysRemaining > 0 ? totalMaterialCost / daysRemaining : 0;
    
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
      materialReorderPoint: currentSettings.materialReorderPoint,
      materialOrderQty: currentSettings.materialOrderQty,
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

    // Station 2 Priority: Not recommended because simulation doesn't model queuing priority effects

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
    if (location.pathname === '/testing') {
      setTestSettings({
        lotSize: currentSettings.lotSize,
        contract: currentSettings.contract,
        station1Machines: currentSettings.station1Machines,
        station2Machines: currentSettings.station2Machines,
        station3Machines: currentSettings.station3Machines,
        station2Priority: currentSettings.station2Priority,
        materialReorderPoint: currentSettings.materialReorderPoint,
        materialOrderQty: currentSettings.materialOrderQty
      });
    }
  }, [currentSettings, location.pathname]);

  const handleRun = () => {
    if (loading) {
      alert('Please wait for data to finish loading');
      return;
    }
    if (error || !csvData) {
      alert('Please make sure the Excel file is loaded successfully');
      return;
    }
    navigate('/testing');
  };

  const handleReset = () => {
    navigate('/');
  };

  React.useEffect(() => {
    if (location.pathname === '/testing' && parsedData.length === 0) {
      navigate('/');
    }
  }, [location.pathname, parsedData.length, navigate]);

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
  const historicalMaterialSimulation = useMemo(() => {
    if (parsedData.length === 0) {
      return {
        financialSeries: [],
        inventorySeries: [],
        inventoryState: { inventory: 7200, orderInTransit: false, orderArrivalDay: 0 }
      };
    }

    const kitsPerJob = 60;
    const costPerKit = 0.010; // $10 per kit = $0.010k
    const fixedOrderCost = 1.0; // $1,000 per order
    const materialLeadTimeDays = 3;

    let kitsInventory = 7200;
    let orderInTransit = false;
    let orderArrivalDay = 0;
    let queuedJobs = 0; // Jobs waiting for kits

    const financialSeries: Array<{
      day: number;
      cash: number;
      revenue: number;
      materialCost: number;
      machineCost: number;
      interest: number;
    }> = [];
    const inventorySeries: Array<{
      day: number;
      inventory: number;
      reorderPoint: number;
      orderPlaced: number;
    }> = [];
    const dailyCashInterestRate = Math.pow(1.10, 1 / 365) - 1;
    let runningCash = 0;
    let prevDaySettings = initialDefaults;

    for (const d of parsedData) {
      // Get settings at this day based on transaction history
      const settingsAtDay = getSettingsAtDay(d.day);
      const orderQuantity = Math.max(0, settingsAtDay.materialOrderQty);
      const reorderPoint = Math.max(0, settingsAtDay.materialReorderPoint);
      const orderCost = (orderQuantity * costPerKit) + fixedOrderCost;

      // Calculate machine purchases (compare to previous day's settings)
      const machineCosts = { station1: 90, station2: 80, station3: 100 };
      let machineCost = 0;

      if (settingsAtDay.station1Machines > prevDaySettings.station1Machines) {
        machineCost += (settingsAtDay.station1Machines - prevDaySettings.station1Machines) * machineCosts.station1;
      }
      if (settingsAtDay.station2Machines > prevDaySettings.station2Machines) {
        machineCost += (settingsAtDay.station2Machines - prevDaySettings.station2Machines) * machineCosts.station2;
      }
      if (settingsAtDay.station3Machines > prevDaySettings.station3Machines) {
        machineCost += (settingsAtDay.station3Machines - prevDaySettings.station3Machines) * machineCosts.station3;
      }

      // Calculate revenue and cash FIRST (before receiving orders or consuming)
      const contractRevenue =
        settingsAtDay.contract === 1 ? 750 :
        settingsAtDay.contract === 2 ? 1000 : 1250;
      const revenueFromJobs = (d.jobsOut * contractRevenue) / 1000; // $k
      const interestEarned = runningCash * dailyCashInterestRate;
      const cashAfterInterest = runningCash + interestEarned;
      const cashAfterRevenue = cashAfterInterest + revenueFromJobs;

      prevDaySettings = settingsAtDay;

      // Check if order arrives today
      if (orderInTransit && d.day >= orderArrivalDay) {
        kitsInventory += orderQuantity;
        orderInTransit = false;
      }

      // Process kit consumption with queue tracking
      // 1. First, try to release queued jobs (jobs waiting for kits from previous days)
      const jobsFromQueue = Math.min(queuedJobs, Math.floor(kitsInventory / kitsPerJob));
      const kitsForQueuedJobs = jobsFromQueue * kitsPerJob;
      kitsInventory -= kitsForQueuedJobs;
      queuedJobs -= jobsFromQueue;

      // 2. Then process newly accepted jobs today
      const newJobsAccepted = d.jobsAccepted;
      const maxNewJobsFromInventory = Math.floor(kitsInventory / kitsPerJob);
      const newJobsStarted = Math.min(newJobsAccepted, maxNewJobsFromInventory);
      const kitsForNewJobs = newJobsStarted * kitsPerJob;
      kitsInventory -= kitsForNewJobs;

      // 3. Jobs that couldn't start due to insufficient kits go into the queue
      const jobsAddedToQueue = newJobsAccepted - newJobsStarted;
      queuedJobs += jobsAddedToQueue;

      // Check if we need to order (AFTER consuming, with updated cash available)
      let materialCost = 0;
      let orderPlaced = 0;
      const canAfford = cashAfterRevenue >= orderCost;

      // Order if: current inventory <= ROP AND no existing order in transit AND can afford
      // Key insight: We check CURRENT inventory after consumption, not projected
      if (kitsInventory <= reorderPoint &&
          !orderInTransit &&
          canAfford &&
          orderQuantity > 0) {
        materialCost = orderCost;
        orderPlaced = 1;
        orderInTransit = true;
        orderArrivalDay = d.day + materialLeadTimeDays;
      }

      runningCash = cashAfterRevenue - materialCost - machineCost;

      financialSeries.push({
        day: d.day,
        cash: parseFloat(runningCash.toFixed(2)),
        revenue: parseFloat(revenueFromJobs.toFixed(2)),
        materialCost: parseFloat(materialCost.toFixed(2)),
        machineCost: parseFloat(machineCost.toFixed(2)),
        interest: parseFloat(interestEarned.toFixed(3))
      });

      inventorySeries.push({
        day: d.day,
        inventory: parseFloat(kitsInventory.toFixed(0)),
        reorderPoint,
        orderPlaced
      });
    }

    return {
      financialSeries,
      inventorySeries,
      inventoryState: { inventory: kitsInventory, orderInTransit, orderArrivalDay }
    };
  }, [parsedData, currentSettings.materialOrderQty, currentSettings.materialReorderPoint, currentSettings.contract]);

  const historicalFinancialData = historicalMaterialSimulation.financialSeries;
  const historicalInventoryData = historicalMaterialSimulation.inventorySeries;
  const inventoryState = historicalMaterialSimulation.inventoryState;

  const currentProjection = recommendations ? calculateProfitProjection(
    currentSettings,
    recommendations.analysis.currentDay,
    recommendations.analysis.cash,
    recommendations.analysis.debt,
    inventoryState
  ) : null;

  // Only calculate test projection when user has clicked "Run"
  const testProjection = (recommendations && activeTestSettings) ? calculateProfitProjection(
    activeTestSettings,
    recommendations.analysis.currentDay,
    recommendations.analysis.cash,
    recommendations.analysis.debt,
    inventoryState
  ) : null;

  // Lot-based projection with job flow data for CURRENT settings
  const currentLotProjectionData = useProjectionData(
    recommendations,
    currentProjection,
    currentSettings,
    inventoryState,
    10 // avgArrivalRate
  );

  // Calculate projection for RECOMMENDED settings to show potential improvement
  const recommendedProjection = recommendations ? calculateProfitProjection(
    {
      lotSize: recommendations.lotSize,
      contract: recommendations.contract,
      station1Machines: recommendations.station1Machines,
      station2Machines: recommendations.station2Machines,
      station3Machines: recommendations.station3Machines,
      station2Priority: recommendations.station2Priority,
      materialReorderPoint: recommendations.materialReorderPoint,
      materialOrderQty: recommendations.materialOrderQty
    },
    recommendations.analysis.currentDay,
    recommendations.analysis.cash,
    recommendations.analysis.debt,
    inventoryState
  ) : null;

  // No longer used - replaced by timelineSimulationCash
  // Kept to maintain hook call order
  useProjectionData(
    recommendations,
    recommendedProjection,
    recommendations || currentSettings,
    inventoryState,
    10 // avgArrivalRate
  );

  // Lot-based projection with job flow data for TEST settings (only when Run is clicked)
  // IMPORTANT: Always call hook (Rules of Hooks), but pass null when not ready
  const testLotProjectionData = useProjectionData(
    recommendations,
    activeTestSettings && testProjection ? testProjection : null,
    activeTestSettings || currentSettings, // Always pass a valid config
    inventoryState,
    10 // avgArrivalRate
  );

  // Validate and enhance recommendations with timing information
  const recommendationsWithTiming = useMemo(() => {
    if (!recommendations || !currentProjection) return recommendations;

    try {
      const currentDay = recommendations.analysis.currentDay;
      const cash = recommendations.analysis.cash;

      // STEP 1: Calculate baseline final cash with current settings
      const baselineCash = runSimulationForCash(
        recommendations,
        currentProjection,
        currentSettings,
        inventoryState,
        10 // avgArrivalRate
      );

      console.log(`Baseline cash with current settings: $${baselineCash.toFixed(0)}k`);

      // STEP 2: Validate each change - only keep if it improves final cash
      // TEMPORARILY DISABLED - Just return all changes without validation
      const validatedChanges = recommendations.changes;

      /* VALIDATION DISABLED FOR DEBUGGING
      const validatedChanges_ORIGINAL = recommendations.changes.filter(change => {
      // Always keep info messages
      if (change.type === 'none' || change.priority === 'INFO') {
        return true;
      }

      // Create test configuration with this change applied
      const testConfig = { ...currentSettings };

      if (change.type === 'capacity') {
        // Machine addition - parse station number from action
        if (change.action.includes('Station 1')) {
          testConfig.station1Machines = currentSettings.station1Machines + 1;
        } else if (change.action.includes('Station 2')) {
          testConfig.station2Machines = currentSettings.station2Machines + 1;
        } else if (change.action.includes('Station 3')) {
          testConfig.station3Machines = currentSettings.station3Machines + 1;
        }
      } else if (change.type === 'contract') {
        // Contract change - parse contract number from action
        if (change.action.includes('Contract 1')) {
          testConfig.contract = 1;
        } else if (change.action.includes('Contract 2')) {
          testConfig.contract = 2;
        } else if (change.action.includes('Contract 3')) {
          testConfig.contract = 3;
        }
      } else if (change.type === 'lotSize') {
        // Lot size change - parse from action
        const match = change.action.match(/to (\d+)/);
        if (match) {
          testConfig.lotSize = parseInt(match[1]);
        }
      }

      // Calculate projection for test config
      const testProjectionForChange = calculateProfitProjection(
        testConfig,
        currentDay,
        cash,
        recommendations.analysis.debt,
        inventoryState
      );

      // Get final cash with this change
      const testCash = runSimulationForCash(
        recommendations,
        testProjectionForChange,
        testConfig,
        inventoryState,
        10 // avgArrivalRate
      );

      // Only keep if it improves final cash
      const improvement = testCash - baselineCash;

      // Debug log to see what's being filtered
      if (improvement <= 0) {
        console.log(`Filtering out ${change.action}: would decrease cash by $${Math.abs(improvement).toFixed(0)}k (baseline: $${baselineCash.toFixed(0)}k, with change: $${testCash.toFixed(0)}k)`);
      }

      return improvement > 0;
    });

    // If all changes were filtered out, add an info message
    if (validatedChanges.length === 0) {
      validatedChanges.push({
        type: 'none',
        action: 'No profitable changes found',
        reason: 'All potential changes would decrease final cash',
        cost: 0,
        priority: 'INFO'
      });
    }
      END OF VALIDATION LOGIC */

    // STEP 3: Add timing information to validated changes
    const enhanced = { ...recommendations };
    enhanced.changes = validatedChanges.map(change => {
      const enhancedChange = { ...change };

      if (change.cost === 0) {
        // Free changes - do immediately
        enhancedChange.recommendedDay = currentDay;
        enhancedChange.daysToWait = 0;
        enhancedChange.awaitingCash = false;
        enhancedChange.needsDebt = false;
      } else {
        // Machine purchases - consider debt availability (day 150+)
        const debtAvailable = currentDay >= 150;

        if (cash >= change.cost) {
          // Can afford now with cash
          enhancedChange.recommendedDay = currentDay;
          enhancedChange.daysToWait = 0;
          enhancedChange.awaitingCash = false;
          enhancedChange.needsDebt = false;
        } else if (debtAvailable) {
          // After day 150: Can use debt financing
          // Still prefer to wait if we'll have cash soon to avoid interest
          const affordableDay = currentLotProjectionData.find(d => d.cash >= change.cost);

          if (affordableDay && affordableDay.day - currentDay <= 30) {
            // Will have cash within 30 days - worth waiting to avoid debt interest
            enhancedChange.recommendedDay = affordableDay.day;
            enhancedChange.daysToWait = Math.max(0, affordableDay.day - currentDay);
            enhancedChange.awaitingCash = true;
            enhancedChange.needsDebt = false;
          } else {
            // Take debt now (won't have cash soon enough, or it's critical)
            enhancedChange.recommendedDay = currentDay;
            enhancedChange.daysToWait = 0;
            enhancedChange.awaitingCash = false;
            enhancedChange.needsDebt = true;
          }
        } else {
          // Before day 150: Must wait for cash (debt not available yet)
          const affordableDay = currentLotProjectionData.find(d => d.cash >= change.cost);

          if (affordableDay && affordableDay.day < 150) {
            // Will have cash before day 150
            enhancedChange.recommendedDay = affordableDay.day;
            enhancedChange.daysToWait = Math.max(0, affordableDay.day - currentDay);
            enhancedChange.awaitingCash = true;
            enhancedChange.needsDebt = false;
          } else if (affordableDay) {
            // Won't have cash until after day 150 - can take debt then
            enhancedChange.recommendedDay = 150;
            enhancedChange.daysToWait = Math.max(0, 150 - currentDay);
            enhancedChange.awaitingCash = false;
            enhancedChange.needsDebt = true;
          } else {
            // Never have enough cash - wait until day 150 and take debt
            enhancedChange.recommendedDay = 150;
            enhancedChange.daysToWait = Math.max(0, 150 - currentDay);
            enhancedChange.awaitingCash = false;
            enhancedChange.needsDebt = true;
          }
        }
      }

      return enhancedChange;
    });

      // Sort by recommended day, then by priority
      enhanced.changes.sort((a, b) => {
        const dayDiff = (a.recommendedDay || 0) - (b.recommendedDay || 0);
        if (dayDiff !== 0) return dayDiff;

        const priorityOrder: Record<string, number> = {
          'CRITICAL': 1,
          'HIGH': 2,
          'MEDIUM': 3,
          'LOW': 4,
          'INFO': 5
        };
        return (priorityOrder[a.priority] || 5) - (priorityOrder[b.priority] || 5);
      });

      return enhanced;
    } catch (error) {
      console.error('Error in recommendations validation:', error);
      // Return recommendations without validation if there's an error
      return recommendations;
    }
  }, [recommendations, currentProjection, currentLotProjectionData, currentSettings, inventoryState]);

  // Timeline simulation now uses detailed lot-based engine (same as test configuration)
  const timelineSimulationCash = useMemo(() => {
    if (!recommendationsWithTiming || !currentSettings) return null;

    try {
      return runTimelineSimulation(
        recommendationsWithTiming as any,
        currentSettings,
        10 // avgArrivalRate
      );
    } catch (error) {
      console.error('Timeline simulation error:', error);
      return null;
    }
  }, [recommendationsWithTiming, currentSettings]);

  // Calculate summary statistics from lot-based projection
  const testLotProjectionSummary = useMemo(() => {
    if (!testLotProjectionData || testLotProjectionData.length === 0) {
      return {
        dailyRevenue: 0,
        dailyMaterialCost: 0,
        totalMaterialCost: 0,
        totalProfit: 0,
        grossRevenue: 0,
        finalCash: 0
      };
    }

    const totalRevenue = testLotProjectionData.reduce((sum, d) => sum + (d.revenue || 0), 0);
    const totalMaterialCost = testLotProjectionData.reduce((sum, d) => sum + (d.materialCost || 0), 0);
    const totalProfit = testLotProjectionData.reduce((sum, d) => sum + (d.profit || 0), 0);
    const dailyRevenue = totalRevenue / testLotProjectionData.length;
    const dailyMaterialCost = totalMaterialCost / testLotProjectionData.length;
    const finalCash = testLotProjectionData[testLotProjectionData.length - 1]?.cash || 0;

    return {
      dailyRevenue,
      dailyMaterialCost,
      totalMaterialCost,
      totalProfit,
      grossRevenue: totalRevenue,
      finalCash
    };
  }, [testLotProjectionData]);

  const currentLotProjectionSummary = useMemo(() => {
    if (!currentLotProjectionData || currentLotProjectionData.length === 0) {
      return {
        finalCash: 0
      };
    }

    const finalCash = currentLotProjectionData[currentLotProjectionData.length - 1]?.cash || 0;

    return {
      finalCash
    };
  }, [currentLotProjectionData]);

  const header = (
    <h1 className="text-3xl font-bold mb-6 text-blue-900">
      Littlefield Live Optimizer {location.pathname === '/testing' && '- Testing'}
    </h1>
  );

  if (location.pathname !== '/testing') {
    return (
      <div className="w-full max-w-7xl mx-auto p-6 bg-gray-50">
        {header}

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Step 1: Historical Data Status</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Upload Historical Data (.xlsx)</label>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleFileUpload(file);
                  }
                }}
                className="w-full p-2 border-2 border-gray-300 rounded bg-white"
              />
              <p className="text-xs text-gray-500 mt-2">
                Upload the latest Littlefield export. No repo update required.
              </p>
            </div>

            {/* Transaction History Upload */}
            <div className="mb-4 pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium mb-2">Upload Transaction History (.xlsx) - Optional</label>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleTransactionFileUpload(file);
                  }
                }}
                className="w-full p-2 border-2 border-gray-300 rounded bg-white"
              />
              <p className="text-xs text-gray-500 mt-2">
                Upload transaction history to account for historical machine purchases and setting changes.
              </p>
              {transactionFileName && (
                <p className="text-xs text-green-600 mt-1 font-medium">
                  ✓ Loaded: {transactionFileName}
                </p>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-blue-600 font-medium">Loading data from Excel file...</div>
              </div>
            ) : error ? (
              <div className="bg-red-50 border-2 border-red-300 rounded p-4">
                <p className="text-red-800 font-bold mb-2">Error loading data:</p>
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            ) : !csvData ? (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded p-4 mt-4">
                <p className="text-yellow-800 font-bold mb-1">No data loaded yet</p>
                <p className="text-yellow-700 text-sm">Please upload a .xlsx file to continue.</p>
              </div>
            ) : (
              <div className="bg-green-50 border-2 border-green-300 rounded p-4">
                <p className="text-green-800 font-bold mb-2">✓ Data loaded successfully!</p>
                <p className="text-gray-600 text-sm">
                  Loaded {parsedData.length} days of data from "{dataFileName || 'uploaded file'}"
                </p>
                <p className="text-gray-500 text-xs mt-2">
                  To update data, upload a new Excel file here.
                </p>
              </div>
            )}

            {/* Transaction History Summary */}
            {parsedTransactions.length > 0 && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
                <h3 className="font-bold text-sm text-blue-900 mb-2">📋 Transaction History Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-gray-600">Total Transactions</p>
                    <p className="font-bold text-blue-800">{parsedTransactions.length}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Machine Purchases</p>
                    <p className="font-bold text-blue-800">{transactionAdjustments.machinePurchases.length}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Setting Changes</p>
                    <p className="font-bold text-blue-800">{transactionAdjustments.settingChanges.length}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Est. Machine Costs</p>
                    <p className="font-bold text-blue-800">${transactionAdjustments.totalMachineCost}k</p>
                  </div>
                </div>
                {transactionAdjustments.machinePurchases.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-blue-200">
                    <p className="text-xs font-semibold text-gray-700 mb-1">Recent Machine Changes:</p>
                    <div className="space-y-1">
                      {transactionAdjustments.machinePurchases.slice(-5).reverse().map((purchase, idx) => (
                        <p key={idx} className="text-xs text-gray-600">
                          Day {purchase.day}: Station {purchase.station} → {purchase.count} machines
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-bold mb-4 text-gray-800">Step 2: Current Settings (View Only)</h2>
              <p className="text-xs text-gray-600 mb-4">These settings are auto-populated from transaction history or system defaults.</p>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Lot Size (kits)</label>
                  <input
                    type="number"
                    value={currentSettings.lotSize}
                    readOnly
                    className="w-full p-2 border-2 border-gray-200 rounded bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Contract</label>
                  <input
                    type="text"
                    value={currentSettings.contract === 1 ? '7 day ($750)' : currentSettings.contract === 2 ? '1 day ($1,000)' : '0.5 day ($1,250)'}
                    readOnly
                    className="w-full p-2 border-2 border-gray-200 rounded bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Station 1 Machines</label>
                  <input
                    type="number"
                    value={currentSettings.station1Machines}
                    readOnly
                    className="w-full p-2 border-2 border-gray-200 rounded bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Station 2 Machines</label>
                  <input
                    type="number"
                    value={currentSettings.station2Machines}
                    readOnly
                    className="w-full p-2 border-2 border-gray-200 rounded bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Station 3 Machines</label>
                  <input
                    type="number"
                    value={currentSettings.station3Machines}
                    readOnly
                    className="w-full p-2 border-2 border-gray-200 rounded bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Station 2 Priority</label>
                  <input
                    type="text"
                    value={currentSettings.station2Priority}
                    readOnly
                    className="w-full p-2 border-2 border-gray-200 rounded bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Material Reorder Point (kits)</label>
                  <input
                    type="number"
                    value={currentSettings.materialReorderPoint}
                    readOnly
                    className="w-full p-2 border-2 border-gray-200 rounded bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Material Order Quantity (kits)</label>
                  <input
                    type="number"
                    value={currentSettings.materialOrderQty}
                    readOnly
                    className="w-full p-2 border-2 border-gray-200 rounded bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-bold mb-4 text-gray-800">Step 3: Financial Status</h2>
              
              <div className="space-y-4">
                <div className="p-3 bg-blue-50 rounded">
                  <p className="text-sm font-medium">Cash on Hand (from latest data)</p>
                  <p className="text-2xl font-bold text-blue-600">
                    ${formatNumber((parseFloat(cashOnHand) || 0), 2)}k
                  </p>
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

                <div className="mt-4 p-3 bg-blue-50 rounded">
                  <p className="text-sm font-medium">Net Cash Available:</p>
                  <p className="text-2xl font-bold text-blue-600">
                    ${formatNumber(((parseFloat(cashOnHand) || 0) - (parseFloat(debt) || 0)), 2)}k
                  </p>
                </div>
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
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-6 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={handleReset}
          className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition"
        >
          ← Back to Input
        </button>
      </div>
      {header}

      {/* Loading Banner */}
      {!recommendations && (
        <div className="bg-blue-100 border-l-4 border-blue-500 text-blue-700 p-4 mb-6 rounded">
          <div className="flex items-center">
            <div className="py-1">
              <svg className="animate-spin h-5 w-5 mr-3 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <div>
              <p className="font-bold">Loading Recommendations...</p>
              <p className="text-sm">Historical data is loading. Recommendations and projections will appear when ready.</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {recommendations && (
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-6 rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold mb-2">Test Configuration</h2>
            <p className="text-blue-100">Analysis based on last 14 days (Days {recommendations.analysis.currentDay - 13} - {recommendations.analysis.currentDay})</p>
          </div>
        )}

          {recommendations && (
            /* Current Setup Statistics */
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
          )}

          {/* Historical Data Section */}
          <div className="bg-gradient-to-r from-green-600 to-green-800 text-white p-6 rounded-lg shadow-lg mt-6">
            <h2 className="text-2xl font-bold mb-2">📊 Historical Data</h2>
            <p className="text-green-100">Actual performance data from simulation</p>
          </div>

          <AsyncChart
            height={380}
            title="Historical Cash At Hand"
            delay={400}
          >
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-bold mb-4 text-gray-800">
                Historical Cash At Hand (Day 1 → {parsedData[parsedData.length - 1]?.day ?? 'N/A'})
              </h3>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={historicalFinancialData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis label={{ value: 'Amount ($k)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="cash" stroke="#10b981" strokeWidth={3} name="Cash On Hand" />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} name="Daily Revenue" />
                  <Line type="monotone" dataKey="materialCost" stroke="#ef4444" strokeWidth={2} name="Material Cost" />
                  <Line type="monotone" dataKey="machineCost" stroke="#f59e0b" strokeWidth={2} name="Machine Payments" />
                  <Line type="monotone" dataKey="interest" stroke="#8b5cf6" strokeWidth={2} name="Cash Interest" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AsyncChart>

          {/* Historical Job Flow Chart */}
          <AsyncChart
            height={380}
            title="Historical Job Flow"
            delay={500}
          >
            <JobFlowChart
              data={parsedData.map((d, i, arr) => {
                // Calculate arrivals as accepted + change in queue
                const prevQueued = i > 0 ? arr[i - 1].queuedJobs : d.queuedJobs;
                const queueChange = d.queuedJobs - prevQueued;
                const arrivals = d.jobsAccepted + queueChange;

                return {
                  day: d.day,
                  arrivals: Math.max(0, arrivals),
                  jobsWaitingForKits: d.queuedJobs,
                  jobsAccepted: d.jobsAccepted,
                  jobsCompleting: d.jobsOut
                };
              })}
              title={`Historical Job Flow (Day 1 → ${parsedData[parsedData.length - 1]?.day ?? 'N/A'})`}
              height={320}
            />
          </AsyncChart>

          <AsyncChart
            height={380}
            title="Historical Inventory"
            delay={600}
          >
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-bold mb-4 text-gray-800">
                Historical Inventory (Day 1 → {parsedData[parsedData.length - 1]?.day ?? 'N/A'})
              </h3>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={historicalInventoryData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis label={{ value: 'Kits', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="inventory" stroke="#10b981" strokeWidth={3} name="Inventory" />
                  <Line type="monotone" dataKey="reorderPoint" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Reorder Point" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AsyncChart>

          {recommendations && (
            <>
              {/* System Initialization State */}
              <div className="bg-blue-50 p-6 rounded-lg shadow-md border-2 border-blue-300">
                <h3 className="text-xl font-bold mb-4 text-gray-800">
                  📊 System State at Start of Day {recommendations.analysis.currentDay + 1}
                </h3>
            <p className="text-sm text-gray-600 mb-4">
              This shows the initial state before any processing happens on day {recommendations.analysis.currentDay + 1}
            </p>

            {(() => {
              const lotSize = testSettings.lotSize || 20;
              const lotsPerJob = 60 / lotSize;
              const historicalLeadTime = recommendations.analysis.avgLeadTime || 2.0;

              // Use ACTUAL historical queue data (same as useProjectionData)
              const avgQueue1 = recommendations.analysis.avgQueue1 || 0;
              const avgQueue2 = recommendations.analysis.avgQueue2 || 0;
              const avgQueue3 = recommendations.analysis.avgQueue3 || 0;

              // Convert kits to lots for each station (with safety cap)
              const lotsAtS1 = Math.min(Math.round(avgQueue1 / lotSize), 200);
              const lotsAtS2 = Math.min(Math.round(avgQueue2 / lotSize), 50);
              const lotsAtS3 = Math.min(Math.round(avgQueue3 / lotSize), 50);

              // Estimate Station 4 (final stage before completion)
              // Use higher estimate to account for jobs near completion: ~25% of total WIP
              const estimatedLotsAtS4 = Math.min(Math.round((lotsAtS1 + lotsAtS2 + lotsAtS3) * 0.25), 50);
              const lotsAtS4 = estimatedLotsAtS4;

              // Calculate total WIP from actual queue data
              const totalWIPLots = lotsAtS1 + lotsAtS2 + lotsAtS3 + lotsAtS4;
              const jobsInProcess = Math.round(totalWIPLots / lotsPerJob);
              const jobsWaitingForKits = Math.round(recommendations.analysis.avgQueuedJobs || 0);
              const totalWIPJobs = jobsInProcess + jobsWaitingForKits;

              const jobsAtS4 = Math.floor(lotsAtS4 / lotsPerJob);
              const jobsAtS3 = Math.floor(lotsAtS3 / lotsPerJob);
              const jobsAtS2 = Math.floor(lotsAtS2 / lotsPerJob);
              const jobsAtS1 = Math.floor(lotsAtS1 / lotsPerJob);

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="bg-white p-4 rounded shadow">
                      <h4 className="font-semibold text-lg mb-2">Overall WIP</h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span>Total WIP Jobs:</span>
                          <span className="font-bold">{totalWIPJobs} jobs</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Jobs Waiting for Kits:</span>
                          <span className="font-bold text-red-600">{jobsWaitingForKits} jobs</span>
                        </div>
                        <div className="flex justify-between border-t pt-1">
                          <span>Jobs In Process:</span>
                          <span className="font-bold text-green-600">{jobsInProcess} jobs</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Lots:</span>
                          <span className="font-bold">{totalWIPLots} lots</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded shadow">
                      <h4 className="font-semibold text-lg mb-2">Configuration</h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span>Lot Size:</span>
                          <span className="font-bold">{lotSize} kits</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Lots per Job:</span>
                          <span className="font-bold">{lotsPerJob} lots</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Avg Lead Time:</span>
                          <span className="font-bold">{historicalLeadTime.toFixed(2)} days</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded shadow">
                    <h4 className="font-semibold text-lg mb-2">Distribution Across Stations</h4>
                    <div className="space-y-3">
                      <div className="border-l-4 border-blue-500 pl-3">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">Station 1:</span>
                          <span className="font-bold">{jobsAtS1} jobs ({lotsAtS1} lots)</span>
                        </div>
                        <div className="text-xs text-gray-500">{testSettings.station1Machines} machines</div>
                      </div>
                      <div className="border-l-4 border-green-500 pl-3">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">Station 2:</span>
                          <span className="font-bold">{jobsAtS2} jobs ({lotsAtS2} lots)</span>
                        </div>
                        <div className="text-xs text-gray-500">{testSettings.station2Machines} machines</div>
                      </div>
                      <div className="border-l-4 border-orange-500 pl-3">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">Station 3:</span>
                          <span className="font-bold">{jobsAtS3} jobs ({lotsAtS3} lots)</span>
                        </div>
                        <div className="text-xs text-gray-500">{testSettings.station3Machines} machines</div>
                      </div>
                      <div className="border-l-4 border-purple-500 pl-3">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">Station 4:</span>
                          <span className="font-bold text-purple-600">{jobsAtS4} jobs ({lotsAtS4} lots)</span>
                        </div>
                        <div className="text-xs text-gray-500">{testSettings.station2Machines} machines (shared)</div>
                        <div className="text-xs text-green-600 font-medium mt-1">
                          ✓ These {jobsAtS4} jobs should complete on day {recommendations.analysis.currentDay + 1}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Expected Current Settings Section */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-6 rounded-lg shadow-lg mt-6">
            <h2 className="text-2xl font-bold mb-2">📈 Expected Current Settings Projected</h2>
            <p className="text-blue-100">Projected performance with current configuration (Day {recommendations.analysis.currentDay + 1} → 318)</p>
          </div>

          <AsyncChart
            height={380}
            title="Expected Cash Under Current Settings"
            delay={0}
          >
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">
                  Expected Cash Under Current Settings (Day {recommendations.analysis.currentDay + 1} → 318)
                </h3>
                <button
                  onClick={() => downloadProjectionExcel(currentLotProjectionData, currentSettings, `projection-current-settings-day${recommendations.analysis.currentDay + 1}-318.xlsx`)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                >
                  📥 Download Excel
                </button>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={currentLotProjectionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis label={{ value: 'Amount ($k)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="cash" stroke="#10b981" strokeWidth={3} name="Cash On Hand" />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} name="Daily Revenue" />
                  <Line type="monotone" dataKey="materialCost" stroke="#ef4444" strokeWidth={2} name="Material Cost" />
                  <Line type="monotone" dataKey="machineCost" stroke="#f59e0b" strokeWidth={2} name="Machine Payments" />
                  <Line type="monotone" dataKey="interest" stroke="#8b5cf6" strokeWidth={2} name="Interest" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AsyncChart>

          <AsyncChart
            height={380}
            title="Expected Job Flow Under Current Settings"
            delay={100}
          >
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-bold text-gray-800 mb-4">
                Expected Job Flow Under Current Settings (Day {recommendations.analysis.currentDay + 1} → 318)
              </h3>
              <JobFlowChart
                data={currentLotProjectionData}
                height={300}
              />
            </div>
          </AsyncChart>

          <AsyncChart
            height={380}
            title="Expected Lots by Station Under Current Settings"
            delay={200}
          >
            <JobsByStationChart
              data={currentLotProjectionData.map(d => ({
                day: d.day,
                lotsAtS1: d.lotsWaitingS1 || 0,
                lotsAtS2: d.lotsWaitingS2 || 0,
                lotsAtS3: d.lotsWaitingS3 || 0
              }))}
              height={300}
              title={`Expected Lots by Station Under Current Settings (Day ${recommendations.analysis.currentDay + 1} → 318)`}
            />
          </AsyncChart>

          <AsyncChart
            height={380}
            title="Expected Inventory Under Current Settings"
            delay={300}
          >
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-bold text-gray-800 mb-4">
                Expected Inventory Under Current Settings (Day {recommendations.analysis.currentDay + 1} → 318)
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={currentLotProjectionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis label={{ value: 'Kits', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="inventory" stroke="#3b82f6" strokeWidth={3} name="Inventory" />
                  <Line type="monotone" dataKey="reorderPoint" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Reorder Point" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AsyncChart>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-2xl font-bold mb-4 text-gray-800">📋 Strategic Plan - Recommended Changes</h3>
            <p className="text-sm text-gray-600 mb-4">Optimized timeline to maximize revenue while managing cash flow</p>

            {/* Current vs Recommended Projection Summary */}
            {currentLotProjectionData && currentLotProjectionData.length > 0 && (
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border-2 border-blue-200">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Current Settings</p>
                    <p className="text-3xl font-bold text-blue-600">
                      ${formatNumber(currentLotProjectionData[currentLotProjectionData.length - 1]?.cash || 0, 0)}k
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      No changes (Day 318)
                    </p>
                  </div>
                  {timelineSimulationCash !== null &&
                   recommendationsWithTiming && recommendationsWithTiming.changes.length > 0 &&
                   recommendationsWithTiming.changes[0].type !== 'none' && (
                    <>
                      <div>
                        <p className="text-sm text-gray-600">With Recommendations</p>
                        <p className="text-3xl font-bold text-green-600">
                          ${formatNumber(timelineSimulationCash, 0)}k
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Following strategic timeline (Day 318)
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Expected Increase</p>
                        <p className="text-3xl font-bold text-emerald-600">
                          +${formatNumber(
                            timelineSimulationCash -
                            (currentLotProjectionData[currentLotProjectionData.length - 1]?.cash || 0),
                            0
                          )}k
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {Math.round((
                            (timelineSimulationCash -
                            (currentLotProjectionData[currentLotProjectionData.length - 1]?.cash || 0)) /
                            (currentLotProjectionData[currentLotProjectionData.length - 1]?.cash || 1) * 100
                          ))}% improvement
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {recommendationsWithTiming?.changes.map((change, idx) => (
                <div key={idx} className={`p-4 rounded-lg border-l-4 ${getPriorityColor(change.priority)}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {change.recommendedDay !== undefined && (
                          <span className="text-xs font-bold px-2 py-1 rounded bg-blue-100 text-blue-800">
                            📅 Day {change.recommendedDay}
                            {change.daysToWait ? ` (in ${change.daysToWait} days)` : ' (Now)'}
                          </span>
                        )}
                        <span className="text-xs font-bold px-2 py-1 rounded bg-white">{change.priority}</span>
                      </div>
                      <p className="font-bold text-lg">{change.action}</p>
                      <p className="text-sm mt-1">{change.reason}</p>
                      {change.awaitingCash && (
                        <p className="text-xs mt-1 font-bold text-orange-600">💰 Wait for sufficient cash to avoid 20% debt interest</p>
                      )}
                      {change.needsDebt && change.recommendedDay && change.recommendedDay >= 150 && (
                        <p className="text-xs mt-1 font-bold text-red-600">⚠️ Finance with debt (20% annual interest, available day 150+)</p>
                      )}
                      {change.needsDebt && change.recommendedDay && change.recommendedDay < 150 && (
                        <p className="text-xs mt-1 font-bold text-purple-600">⏳ Wait until day 150 when debt financing becomes available</p>
                      )}
                    </div>
                    <div className="ml-4 text-right">
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
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setTestSettings(prev => ({...prev, lotSize: value}));
                  }}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                >
                  <option value={15}>15 kits</option>
                  <option value={20}>20 kits</option>
                  <option value={30}>30 kits</option>
                  <option value={60}>60 kits</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Contract</label>
                <select
                  value={testSettings.contract}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setTestSettings(prev => ({...prev, contract: value}));
                  }}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                >
                  <option value={1}>7 day ($750)</option>
                  <option value={2}>1 day ($1,000)</option>
                  <option value={3}>0.5 day ($1,250)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Material Reorder Point (kits)</label>
                <input
                  type="number"
                  value={testSettings.materialReorderPoint || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                    if (!isNaN(value)) {
                      setTestSettings(prev => ({...prev, materialReorderPoint: value}));
                    }
                  }}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                  min="0"
                  placeholder="e.g., 2000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Material Order Quantity (kits)</label>
                <input
                  type="number"
                  value={testSettings.materialOrderQty || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                    if (!isNaN(value)) {
                      setTestSettings(prev => ({...prev, materialOrderQty: value}));
                    }
                  }}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                  min="0"
                  placeholder="e.g., 4000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 1 Machines</label>
                <input
                  type="number"
                  value={testSettings.station1Machines || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                    if (!isNaN(value) && value >= 0 && value <= 5) {
                      setTestSettings(prev => ({...prev, station1Machines: value}));
                    }
                  }}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                  min="1"
                  max="5"
                  placeholder="1-5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 2 Machines</label>
                <input
                  type="number"
                  value={testSettings.station2Machines || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                    if (!isNaN(value) && value >= 0 && value <= 5) {
                      setTestSettings(prev => ({...prev, station2Machines: value}));
                    }
                  }}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                  min="1"
                  max="5"
                  placeholder="1-5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Station 3 Machines</label>
                <input
                  type="number"
                  value={testSettings.station3Machines || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                    if (!isNaN(value) && value >= 0 && value <= 5) {
                      setTestSettings(prev => ({...prev, station3Machines: value}));
                    }
                  }}
                  className="w-full p-2 border-2 border-purple-300 rounded"
                  min="1"
                  max="5"
                  placeholder="1-5"
                />
              </div>
            </div>

            {/* Run Button */}
            <div className="mt-6">
              <button
                onClick={handleRunTestSimulation}
                className="w-full bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition transform hover:scale-105"
              >
                🚀 Run Simulation
              </button>
            </div>

            {activeTestSettings && testProjection && currentProjection && (
              <>
                <div className="bg-white p-4 rounded-lg border-2 border-purple-400">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">Test Results:</h4>

                  {/* Primary Results: Final Cash Comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg">
                    <div className="text-center">
                      <p className="text-xs font-semibold text-gray-700 mb-1">Final Cash (Test Config)</p>
                      <p className="text-3xl font-bold text-purple-600">${formatNumber(testLotProjectionSummary.finalCash, 2)}k</p>
                      <p className="text-xs text-gray-500 mt-1">Day 318</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-semibold text-gray-700 mb-1">Final Cash (Current)</p>
                      <p className="text-3xl font-bold text-blue-600">${formatNumber(currentLotProjectionSummary.finalCash, 2)}k</p>
                      <p className="text-xs text-gray-500 mt-1">Day 318</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-semibold text-gray-700 mb-1">Difference</p>
                      <p className={`text-3xl font-bold ${testLotProjectionSummary.finalCash > currentLotProjectionSummary.finalCash ? 'text-green-600' : 'text-red-600'}`}>
                        {testLotProjectionSummary.finalCash > currentLotProjectionSummary.finalCash ? '↑' : '↓'}
                        ${formatNumber(Math.abs(testLotProjectionSummary.finalCash - currentLotProjectionSummary.finalCash), 2)}k
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {currentLotProjectionSummary.finalCash > 0 ? (
                          testLotProjectionSummary.finalCash > currentLotProjectionSummary.finalCash
                            ? `+${Math.round((testLotProjectionSummary.finalCash - currentLotProjectionSummary.finalCash) / currentLotProjectionSummary.finalCash * 100)}%`
                            : `${Math.round((testLotProjectionSummary.finalCash - currentLotProjectionSummary.finalCash) / currentLotProjectionSummary.finalCash * 100)}%`
                        ) : 'N/A'}
                      </p>
                    </div>
                  </div>

                  {/* Secondary Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-purple-200">
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Gross Revenue</p>
                      <p className="text-lg font-semibold text-blue-600">${formatNumber(testLotProjectionSummary.grossRevenue, 0)}k</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Material Costs</p>
                      <p className="text-lg font-semibold text-red-600">${formatNumber(testLotProjectionSummary.totalMaterialCost, 2)}k</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Expected Rev/Job</p>
                      <p className="text-lg font-semibold text-purple-600">${formatNumber(testProjection.expectedRevenuePerJob, 2)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-600">Avg Lead Time</p>
                      <p className="text-lg font-semibold text-orange-600">{formatNumber(testProjection.adjustedAvgLeadTime, 2)}d</p>
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

                </div>

                {/* Expected Cash Under Test Settings */}
                <AsyncChart
                  height={420}
                  title="Expected Cash Under Test Settings"
                  delay={700}
                >
                  <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-bold text-lg text-purple-800">📊 Expected Cash Under Test Settings (Day {recommendations.analysis.currentDay + 1} → 318)</h4>
                      <button
                        onClick={() => downloadProjectionExcel(testLotProjectionData, testSettings, `projection-test-settings-day${recommendations.analysis.currentDay + 1}-318.xlsx`)}
                        className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm font-medium"
                      >
                        📥 Download Excel
                      </button>
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={testLotProjectionData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis label={{ value: 'Amount ($k)', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="cash" stroke="#10b981" strokeWidth={3} name="Cash On Hand" />
                      <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} name="Daily Revenue" />
                      <Line type="monotone" dataKey="materialCost" stroke="#ef4444" strokeWidth={2} name="Material Cost" />
                      <Line type="monotone" dataKey="machineCost" stroke="#f59e0b" strokeWidth={2} name="Machine Payments" />
                      <Line type="monotone" dataKey="debtInterest" stroke="#dc2626" strokeWidth={2} name="Debt Interest (20%)" />
                      <Line type="monotone" dataKey="cashInterest" stroke="#059669" strokeWidth={2} name="Cash Interest (10%)" />
                      <Line type="monotone" dataKey="debtPayment" stroke="#7c2d12" strokeWidth={2} name="Debt Payment" />
                    </LineChart>
                  </ResponsiveContainer>

                  <div className="mt-4 p-3 bg-purple-50 rounded">
                    <div className="grid grid-cols-4 gap-4 text-center text-xs">
                      <div>
                        <p className="text-gray-600">Avg Daily Revenue</p>
                        <p className="text-lg font-bold text-blue-600">${formatNumber(testLotProjectionSummary.dailyRevenue, 2)}k</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Avg Daily Material Cost</p>
                        <p className="text-lg font-bold text-red-600">${formatNumber(testLotProjectionSummary.dailyMaterialCost, 2)}k</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Total Machine Cost</p>
                        <p className="text-lg font-bold text-orange-600">${formatNumber(testProjection.totalMachineCost, 2)}k</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Avg Daily Interest</p>
                        <p className="text-lg font-bold text-purple-600">${formatNumber((testProjection.newDebt * (Math.pow(1.20, 1/365) - 1)), 3)}k</p>
                      </div>
                    </div>
                  </div>
                  </div>
                </AsyncChart>

                {/* Debt Schedule Table */}
                {testProjection.totalMachineCost > 0 && testProjection.newDebt > recommendations.analysis.debt && (
                  <AsyncChart
                    height={400}
                    title="Debt Payment Schedule"
                    delay={750}
                  >
                    <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                      <h4 className="font-bold text-lg mb-3 text-purple-800">💰 Debt Payment Schedule (Days {recommendations.analysis.currentDay + 1} → 318)</h4>
                      <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="min-w-full text-xs">
                          <thead className="bg-purple-100 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left">Day</th>
                              <th className="px-3 py-2 text-right">Debt Balance</th>
                              <th className="px-3 py-2 text-right">Interest Paid</th>
                              <th className="px-3 py-2 text-right">Principal Paid</th>
                              <th className="px-3 py-2 text-right">Cash Interest Earned</th>
                              <th className="px-3 py-2 text-right">Net Cash Flow</th>
                            </tr>
                          </thead>
                          <tbody>
                            {testLotProjectionData
                              .filter(d => d.debtInterest > 0.001 || d.debtPayment > 0.001 || d.cashInterest > 0.001)
                              .slice(0, 50) // Show first 50 days with activity
                              .map((d, idx) => (
                              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-3 py-2">{d.day}</td>
                                <td className="px-3 py-2 text-right font-medium">${formatNumber(d.debt, 2)}k</td>
                                <td className="px-3 py-2 text-right text-red-600">-${formatNumber(d.debtInterest, 3)}k</td>
                                <td className="px-3 py-2 text-right text-green-600">
                                  {d.debtPayment > 0 ? `-$${formatNumber(d.debtPayment, 2)}k` : '-'}
                                </td>
                                <td className="px-3 py-2 text-right text-green-600">
                                  +${formatNumber(d.cashInterest, 3)}k
                                </td>
                                <td className="px-3 py-2 text-right font-medium">
                                  ${formatNumber(d.revenue - d.materialCost - d.debtInterest + d.cashInterest - d.debtPayment, 2)}k
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-4 p-3 bg-purple-50 rounded text-xs">
                        <p className="font-bold text-purple-800 mb-2">Debt Summary:</p>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-gray-600">Initial Debt:</p>
                            <p className="font-bold text-red-600">${formatNumber(testProjection.newDebt, 2)}k</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Final Debt:</p>
                            <p className="font-bold">${formatNumber(testLotProjectionData[testLotProjectionData.length - 1]?.debt || 0, 2)}k</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Total Interest Paid:</p>
                            <p className="font-bold text-red-600">
                              ${formatNumber(testLotProjectionData.reduce((sum, d) => sum + (d.debtInterest || 0), 0), 2)}k
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </AsyncChart>
                )}

                {/* Expected Job Flow Under Test Settings */}
                <AsyncChart
                  height={380}
                  title="Expected Job Flow Under Test Settings"
                  delay={800}
                >
                  <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                    <h4 className="font-bold text-lg mb-3 text-purple-800">
                      Expected Job Flow Under Test Settings (Day {recommendations.analysis.currentDay + 1} → 318)
                    </h4>
                    <JobFlowChart
                      data={testLotProjectionData}
                      height={300}
                    />
                  </div>
                </AsyncChart>

                {/* Expected Lots by Station Under Test Settings */}
                <AsyncChart
                  height={380}
                  title="Expected Lots by Station Under Test Settings"
                  delay={900}
                >
                  <JobsByStationChart
                    data={testLotProjectionData.map(d => ({
                      day: d.day,
                      lotsAtS1: d.lotsWaitingS1 || 0,
                      lotsAtS2: d.lotsWaitingS2 || 0,
                      lotsAtS3: d.lotsWaitingS3 || 0
                    }))}
                    height={300}
                    title={`Expected Lots by Station Under Test Settings (Day ${recommendations.analysis.currentDay + 1} → 318)`}
                  />
                </AsyncChart>

                {/* Projected Station Utilization Under Test Settings */}
                <AsyncChart
                  height={380}
                  title="Projected Station Utilization Under Test Settings"
                  delay={950}
                >
                  <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                    <h4 className="font-bold text-lg mb-3 text-purple-800">📊 Projected Station Utilization (Day {recommendations.analysis.currentDay + 1} → 318)</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={testLotProjectionData.map(d => ({
                        day: d.day,
                        Station1: ((d.lotsProcessingS1 || 0) / (activeTestSettings?.station1Machines || 1) * 100).toFixed(1),
                        Station2: ((d.lotsProcessingS2 || 0) / (activeTestSettings?.station2Machines || 1) * 100).toFixed(1),
                        Station3: ((d.lotsProcessingS3 || 0) / (activeTestSettings?.station3Machines || 1) * 100).toFixed(1)
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="day" label={{ value: 'Day', position: 'insideBottom', offset: -5 }} />
                        <YAxis label={{ value: 'Utilization (%)', angle: -90, position: 'insideLeft' }} domain={[0, 100]} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="Station1" stroke="#3b82f6" strokeWidth={2} name="Station 1 (Stuffer)" />
                        <Line type="monotone" dataKey="Station2" stroke="#10b981" strokeWidth={2} name="Station 2 (Tester)" />
                        <Line type="monotone" dataKey="Station3" stroke="#f59e0b" strokeWidth={2} name="Station 3 (Tuner)" />
                        <ReferenceLine y={85} stroke="#ef4444" strokeDasharray="3 3" label="85% Target" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </AsyncChart>

                {/* Expected Inventory Under Test Settings */}
                <AsyncChart
                  height={380}
                  title="Expected Inventory Under Test Settings"
                  delay={1000}
                >
                  <div className="bg-white p-6 rounded-lg border-2 border-purple-400 mt-4">
                  <h4 className="font-bold text-lg mb-3 text-purple-800">📦 Expected Inventory Under Test Settings (Day {recommendations.analysis.currentDay + 1} → 318)</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={testLotProjectionData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis label={{ value: 'Kits', angle: -90, position: 'insideLeft' }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="inventory" stroke="#3b82f6" strokeWidth={3} name="Inventory" />
                      <Line type="monotone" dataKey="reorderPoint" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Reorder Point" />
                    </LineChart>
                  </ResponsiveContainer>
                  </div>
                </AsyncChart>

              </>
            )}
          </div>

          </>
        )}

        </div>
      </div>
    );
};

export default LittlefieldAnalysis;
