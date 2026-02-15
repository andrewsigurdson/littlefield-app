import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Config, Recommendations, ParsedData } from '../types';
import { calculateProfitProjection, randomPoisson } from '../utils';

interface TestingPageProps {
  recommendations: Recommendations;
  parsedData: ParsedData[];
  currentSettings: Config;
}

const TestingPage: React.FC<TestingPageProps> = ({
  recommendations,
  parsedData,
  currentSettings
}) => {
  const navigate = useNavigate();

  // Test scenario state
  const [testSettings, setTestSettings] = useState<Config>({
    lotSize: 20,
    contract: 1,
    station1Machines: 3,
    station2Machines: 1,
    station3Machines: 1,
    station2Priority: 'FIFO'
  });

  // Initialize test settings when recommendations are ready
  useEffect(() => {
    setTestSettings({
      lotSize: recommendations.lotSize,
      contract: recommendations.contract,
      station1Machines: recommendations.station1Machines,
      station2Machines: recommendations.station2Machines,
      station3Machines: recommendations.station3Machines,
      station2Priority: recommendations.station2Priority
    });
  }, [recommendations]);

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
  const recommendedProjection = calculateProfitProjection(
    recommendations,
    recommendations.analysis.currentDay,
    recommendations.analysis.cash,
    recommendations.analysis.debt,
    parsedData,
    currentSettings
  );

  const testProjection = calculateProfitProjection(
    testSettings,
    recommendations.analysis.currentDay,
    recommendations.analysis.cash,
    recommendations.analysis.debt,
    parsedData,
    currentSettings
  );

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

  return (
    <div className="w-full max-w-7xl mx-auto p-6 bg-gray-50">
      <h1 className="text-3xl font-bold mb-6 text-blue-900">Littlefield Live Optimizer - Testing</h1>

      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-6 rounded-lg shadow-lg">
          <h2 className="text-2xl font-bold mb-2">Optimization Results</h2>
          <p className="text-blue-100">Analysis based on last 14 days (Days {recommendations.analysis.currentDay - 13} - {recommendations.analysis.currentDay})</p>
        </div>

        {/* Revenue Projection for Recommended Config - Continues in next part due to length */}
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600">
            This section is currently a placeholder. The original content may have been truncated.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TestingPage;
