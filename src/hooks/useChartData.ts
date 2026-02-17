import { useMemo } from 'react';
import type { ParsedData } from './useDataParsing';

export function useChartData(parsedData: ParsedData[]) {
  const utilizationData = useMemo(() =>
    parsedData.slice(-30).map(d => ({
      day: d.day,
      Station1: (d.util1 * 100).toFixed(1),
      Station2: (d.util2 * 100).toFixed(1),
      Station3: (d.util3 * 100).toFixed(1)
    })),
    [parsedData]
  );

  const queueData = useMemo(() =>
    parsedData.slice(-30).map(d => ({
      day: d.day,
      Station1: d.queue1,
      Station2: d.queue2,
      Station3: d.queue3
    })),
    [parsedData]
  );

  const leadTimeData = useMemo(() =>
    parsedData.slice(-30).map(d => ({
      day: d.day,
      leadTime: d.leadTime
    })),
    [parsedData]
  );

  const wipData = useMemo(() =>
    parsedData.slice(-30).map(d => ({
      day: d.day,
      queuedJobs: d.queuedJobs,
      jobsAccepted: d.jobsAccepted
    })),
    [parsedData]
  );

  return {
    utilizationData,
    queueData,
    leadTimeData,
    wipData
  };
}
