const EARNER_COLORS = { p1: '#6366f1', p2: '#ec4899', joint: '#94a3b8' }

export default function TransactionList({ transactions, onDelete, onEdit, household }) {
  const p1 = household?.p1 || 'Person 1'
  const p2 = household?.p2 || 'Person 2'

  const earnerLabel = { p1, p2, joint: 'Joint' }

  if (transactions.length === 0) {
    return (
      <div className="card empty-state">
        <p>No transactions this month.</p>
        <p className="hint">Switch to the "+ Add" tab to record one.</p>
      </div>
    )
  }

  const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date))

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function isExpired(tx) {
    if (!tx.endDate) return false
    return tx.endDate < new Date().toISOString().slice(0, 10)
  }

  function formatAmount(amount, type) {
    return `${type === 'income' ? '+' : '-'}$${amount.toFixed(2)}`
  }

  return (
    <div className="card">
      <h2>Transactions</h2>
      <ul className="tx-list">
        {sorted.map(tx => {
          const earner = tx.earner || 'joint'
          const color  = EARNER_COLORS[earner] || EARNER_COLORS.joint
          const label  = earnerLabel[earner] || 'Joint'
          return (
            <li key={tx.id} className={`tx-item ${tx.type}`}>
              <div className="tx-left">
                <div className="tx-top-row">
                  <span className="tx-category">{tx.category}</span>
                  <span className="earner-badge" style={{ background: color + '20', color }}>
                    {label}
                  </span>
                </div>
                {tx.description && <span className="tx-desc">{tx.description}</span>}
                <span className="tx-date">{formatDate(tx.date)}</span>
                {tx.recurring && (
                  <span className={`tx-recurring-badge${isExpired(tx) ? ' tx-recurring-expired' : ''}`}>
                    ↻ {tx.frequency || 'Monthly'}
                    {tx.endDate && ` · ends ${tx.endDate}`}
                    {isExpired(tx) && ' · expired'}
                  </span>
                )}
              </div>
              <div className="tx-right">
                <span className="tx-amount">{formatAmount(tx.amount, tx.type)}</span>
                <button className="edit-btn" onClick={() => onEdit(tx)}
                  aria-label="Edit transaction" title="Edit">✎</button>
                <button className="delete-btn" onClick={() => onDelete(tx.id)}
                  aria-label="Delete transaction" title="Delete">×</button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
