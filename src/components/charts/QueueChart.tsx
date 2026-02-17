import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface QueueChartProps {
  data: Array<{ day: number; Station1: number; Station2: number; Station3: number }>;
  height?: number;
  title?: string;
}

export const QueueChart: React.FC<QueueChartProps> = ({
  data,
  height = 300,
  title = 'Queue Sizes (Last 30 Days)'
}) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-xl font-bold mb-4 text-gray-800">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis label={{ value: 'Kits in Queue', angle: -90, position: 'insideLeft' }} />
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
