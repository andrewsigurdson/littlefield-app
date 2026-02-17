export interface Change {
  type: string;
  action: string;
  reason: string;
  cost: number;
  needsDebt?: boolean;
  priority: string;
  recommendedDay?: number;
  daysToWait?: number;
  awaitingCash?: boolean;
}

export interface Bottleneck {
  station: number;
  priority: number;
  util: number;
  queue: number;
  cost: number;
}

export interface Analysis {
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

export interface Config {
  lotSize: number;
  contract: number;
  station1Machines: number;
  station2Machines: number;
  station3Machines: number;
  station2Priority: string;
  materialReorderPoint: number;
  materialOrderQty: number;
}

export interface ParsedData {
  day: number;
  queuedJobs: number;
  jobsAccepted: number;
  queue1: number;
  util1: number;
  machines1: number;
  queue2: number;
  util2: number;
  machines2: number;
  queue3: number;
  util3: number;
  machines3: number;
  jobsOut: number;
  revenue: number;
  leadTime: number;
  cashBalance: number;
}

export interface Recommendations {
  lotSize: number;
  contract: number;
  station1Machines: number;
  station2Machines: number;
  station3Machines: number;
  station2Priority: string;
  materialReorderPoint: number;
  materialOrderQty: number;
  changes: Change[];
  analysis: Analysis;
}
