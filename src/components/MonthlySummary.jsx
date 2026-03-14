const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function MonthlySummary({ transactions, year, month }) {
  const income = transactions
    .filter(tx => tx.type === 'income')
    .reduce((sum, tx) => sum + tx.amount, 0)

  const expenses = transactions
    .filter(tx => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0)

  const net = income - expenses

  function fmt(n) {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  }

  return (
    <div className="summary-section">
      <h2>{MONTH_NAMES[month - 1]} {year} Summary</h2>
      <div className="summary-cards">
        <div className="summary-card income-card">
          <span className="summary-label">Income</span>
          <span className="summary-value">{fmt(income)}</span>
        </div>
        <div className="summary-card expense-card">
          <span className="summary-label">Expenses</span>
          <span className="summary-value">{fmt(expenses)}</span>
        </div>
        <div className={`summary-card net-card ${net >= 0 ? 'positive' : 'negative'}`}>
          <span className="summary-label">Net</span>
          <span className="summary-value">{fmt(net)}</span>
        </div>
      </div>
    </div>
  )
}
