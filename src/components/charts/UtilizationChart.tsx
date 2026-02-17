import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface UtilizationChartProps {
  data: Array<{ day: number; Station1: string; Station2: string; Station3: string }>;
  height?: number;
  title?: string;
}

export const UtilizationChart: React.FC<UtilizationChartProps> = ({
  data,
  height = 300,
  title = 'Station Utilization (Last 30 Days)'
}) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-xl font-bold mb-4 text-gray-800">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis label={{ value: 'Utilization %', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="Station1" stroke="#3b82f6" strokeWidth={2} name="Station 1" />
          <Line type="monotone" dataKey="Station2" stroke="#ef4444" strokeWidth={2} name="Station 2" />
          <Line type="monotone" dataKey="Station3" stroke="#eab308" strokeWidth={2} name="Station 3" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
