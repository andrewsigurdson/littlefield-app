import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface JobFlowChartProps {
  data: Array<{
    day: number;
    arrivals?: number;
    jobsWaitingForKits?: number;
    jobsAccepted?: number;
    jobsCompleting?: number;
  }>;
  height?: number;
  title?: string;
}

export const JobFlowChart: React.FC<JobFlowChartProps> = ({
  data,
  height = 300,
  title = 'Job Flow - Daily Operations'
}) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-xl font-bold mb-4 text-gray-800">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis label={{ value: 'Jobs', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="arrivals"
            stroke="#3b82f6"
            strokeWidth={2}
            name="Jobs Arriving"
          />
          <Line
            type="monotone"
            dataKey="jobsWaitingForKits"
            stroke="#ef4444"
            strokeWidth={2}
            name="Jobs Queued (Waiting on Kits)"
          />
          <Line
            type="monotone"
            dataKey="jobsAccepted"
            stroke="#10b981"
            strokeWidth={2}
            name="Jobs Accepted (Started)"
          />
          <Line
            type="monotone"
            dataKey="jobsCompleting"
            stroke="#8b5cf6"
            strokeWidth={2}
            name="Jobs Completed"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
