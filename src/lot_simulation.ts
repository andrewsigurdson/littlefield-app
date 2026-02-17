// Lot-level discrete event simulation for Littlefield

export interface Lot {
  jobId: number;
  lotNumber: number; // 1, 2, or 3 for lot size 20
  currentStage: 1 | 2 | 3 | 4 | 'complete'; // 1=S1, 2=S2step2, 3=S3, 4=S2step4
  arrivalTimeAtStation: number;
  processingStartTime?: number;
  machineId?: number;
}

export interface Job {
  id: number;
  startDay: number; // When job was accepted (had kits available)
  lots: Lot[];
  completionDay?: number;
}

export interface Machine {
  id: number;
  stationId: 1 | 2 | 3;
  busyUntil: number;
  currentLot?: Lot;
}

export interface SimulationState {
  currentTime: number;
  jobs: Map<number, Job>;
  nextJobId: number;

  // Queues
  waitingForKits: number[]; // Job IDs waiting for materials
  station1Queue: Lot[];
  station2Queue: Lot[];
  station3Queue: Lot[];
  station2bQueue: Lot[]; // S2 step 4

  // Machines
  station1Machines: Machine[];
  station2Machines: Machine[];
  station3Machines: Machine[];

  // Inventory
  kitsInventory: number;
  orderInTransit: boolean;
  orderArrivalDay: number;

  // Cash
  cash: number;
  debt: number;
}

export function createMachines(stationId: 1 | 2 | 3, count: number, currentTime: number): Machine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    stationId,
    busyUntil: currentTime,
    currentLot: undefined
  }));
}

export function assignLotsToMachines(
  queue: Lot[],
  machines: Machine[],
  currentTime: number,
  processingTime: number
): void {
  // Find free machines and assign queued lots (FIFO)
  for (const machine of machines) {
    if (machine.busyUntil <= currentTime && queue.length > 0) {
      const lot = queue.shift()!;
      lot.processingStartTime = currentTime;
      lot.machineId = machine.id;
      machine.currentLot = lot;
      machine.busyUntil = currentTime + processingTime;
    }
  }
}

export function processCompletedLots(
  machines: Machine[],
  currentTime: number,
  nextQueue: Lot[],
  nextStage: 1 | 2 | 3 | 4 | 'complete'
): Lot[] {
  const completedLots: Lot[] = [];

  for (const machine of machines) {
    if (machine.currentLot && machine.busyUntil <= currentTime) {
      const lot = machine.currentLot;

      if (nextStage === 'complete') {
        lot.currentStage = 'complete';
        completedLots.push(lot);
      } else {
        lot.currentStage = nextStage;
        lot.arrivalTimeAtStation = currentTime;
        lot.processingStartTime = undefined;
        lot.machineId = undefined;
        nextQueue.push(lot);
      }

      machine.currentLot = undefined;
      machine.busyUntil = currentTime;
    }
  }

  return completedLots;
}

export function checkJobCompletions(
  state: SimulationState,
  currentTime: number
): Job[] {
  const completedJobs: Job[] = [];

  for (const job of state.jobs.values()) {
    if (!job.completionDay && job.lots.every(lot => lot.currentStage === 'complete')) {
      job.completionDay = currentTime;
      completedJobs.push(job);
    }
  }

  return completedJobs;
}
