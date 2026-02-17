import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface JobsByStationChartProps {
  data: Array<{
    day: number;
    lotsAtS1?: number;
    lotsAtS2?: number;
    lotsAtS3?: number;
  }>;
  height?: number;
  title?: string;
}

export const JobsByStationChart: React.FC<JobsByStationChartProps> = ({
  data,
  height = 300,
  title = 'Lots by Station - Daily Distribution'
}) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-xl font-bold mb-4 text-gray-800">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis label={{ value: 'Lots', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="lotsAtS1"
            stroke="#3b82f6"
            strokeWidth={2}
            name="Lots at Station 1"
          />
          <Line
            type="monotone"
            dataKey="lotsAtS2"
            stroke="#10b981"
            strokeWidth={2}
            name="Lots at Station 2"
          />
          <Line
            type="monotone"
            dataKey="lotsAtS3"
            stroke="#f59e0b"
            strokeWidth={2}
            name="Lots at Station 3"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
