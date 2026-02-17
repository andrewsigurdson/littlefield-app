import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface CashFlowChartProps {
  data: Array<{ day: number; cash: number; debt: number }>;
  height?: number;
  title?: string;
}

export const CashFlowChart: React.FC<CashFlowChartProps> = ({
  data,
  height = 320,
  title
}) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {title && <h3 className="text-xl font-bold mb-4 text-gray-800">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis label={{ value: 'Amount ($k)', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="cash" stroke="#10b981" strokeWidth={2} name="Cash" />
          <Line type="monotone" dataKey="debt" stroke="#ef4444" strokeWidth={2} name="Debt" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
