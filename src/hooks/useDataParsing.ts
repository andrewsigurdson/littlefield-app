import { useMemo } from 'react';

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

export function useDataParsing(csvData: string): ParsedData[] {
  return useMemo(() => {
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
}
