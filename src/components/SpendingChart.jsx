import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
]

export default function SpendingChart({ transactions }) {
  const expenses = transactions.filter(tx => tx.type === 'expense')

  if (expenses.length === 0) {
    return (
      <div className="card chart-card empty-state">
        <h2>Spending by Category</h2>
        <p>No expenses this month to chart.</p>
      </div>
    )
  }

  const categoryTotals = {}
  expenses.forEach(tx => {
    categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount
  })

  const data = Object.entries(categoryTotals)
    .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value)

  const total = data.reduce((s, d) => s + d.value, 0)

  function renderLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
    if (percent < 0.05) return null
    const RADIAN = Math.PI / 180
    const r = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight="600">
        {(percent * 100).toFixed(0)}%
      </text>
    )
  }

  function customTooltip({ active, payload }) {
    if (!active || !payload?.length) return null
    const { name, value } = payload[0].payload
    return (
      <div className="chart-tooltip">
        <strong>{name}</strong>
        <span>${value.toFixed(2)} ({((value / total) * 100).toFixed(1)}%)</span>
      </div>
    )
  }

  return (
    <div className="card chart-card">
      <h2>Spending by Category</h2>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={110}
            dataKey="value"
            labelLine={false}
            label={renderLabel}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={customTooltip} />
          <Legend
            formatter={(value) => <span style={{ fontSize: 13 }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>

      <table className="category-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Amount</th>
            <th>% of Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={row.name}>
              <td>
                <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
                {row.name}
              </td>
              <td>${row.value.toFixed(2)}</td>
              <td>{((row.value / total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
