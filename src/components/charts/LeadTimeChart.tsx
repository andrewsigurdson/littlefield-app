import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface LeadTimeChartProps {
  data: Array<{ day: number; leadTime: number }>;
  height?: number;
  title?: string;
}

export const LeadTimeChart: React.FC<LeadTimeChartProps> = ({
  data,
  height = 300,
  title = 'Lead Time Performance (Last 30 Days)'
}) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-xl font-bold mb-4 text-gray-800">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis label={{ value: 'Lead Time (days)', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="leadTime" stroke="#10b981" strokeWidth={2} name="Lead Time" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
