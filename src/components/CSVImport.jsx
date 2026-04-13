import { useState, useRef } from 'react'

const EXPENSE_CATS = ['Food & Dining','Housing & Utilities','Transportation','Entertainment','Health & Fitness','Shopping','Education','Travel','Personal Care','Other']
const INCOME_CATS  = ['Salary','Bonus','Freelance','Investment','Business','Gift','Other']

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = splitCSVLine(lines[0])
  const rows = lines.slice(1).map(l => {
    const vals = splitCSVLine(l)
    const obj = {}
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim() })
    return obj
  }).filter(r => Object.values(r).some(v => v !== ''))
  return { headers, rows }
}

function splitCSVLine(line) {
  const result = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur.trim())
  return result
}

function guessMapping(headers) {
  const lh = headers.map(h => h.toLowerCase())
  function find(...terms) {
    for (const t of terms) {
      const i = lh.findIndex(h => h.includes(t))
      if (i !== -1) return headers[i]
    }
    return ''
  }
  return {
    date:        find('date'),
    description: find('description', 'memo', 'name', 'payee', 'merchant'),
    amount:      find('amount', 'debit', 'credit', 'sum'),
    type:        find('type', 'transaction type', 'debit/credit'),
    category:    find('category'),
  }
}

function parseAmount(str) {
  if (!str) return NaN
  return parseFloat(str.replace(/[$,\s]/g, '').replace(/[()]/g, '-'))
}

function parseDate(str) {
  if (!str) return ''
  // Try MM/DD/YYYY
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (mdy) {
    const y = mdy[3].length === 2 ? '20' + mdy[3] : mdy[3]
    return `${y}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`
  }
  // Try YYYY-MM-DD
  const ymd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`
  // Try DD-Mon-YYYY
  const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'}
  const dmy = str.match(/^(\d{1,2})[-\s]([a-zA-Z]{3})[-\s](\d{2,4})$/)
  if (dmy) {
    const y = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3]
    return `${y}-${months[dmy[2].toLowerCase()] || '01'}-${dmy[1].padStart(2,'0')}`
  }
  return ''
}

function guessType(row, mapping, amount) {
  const typeCol = mapping.type ? row[mapping.type] : ''
  if (typeCol) {
    const t = typeCol.toLowerCase()
    if (t.includes('credit') || t.includes('income') || t.includes('deposit')) return 'income'
    if (t.includes('debit')  || t.includes('expense') || t.includes('payment')) return 'expense'
  }
  // Fall back to sign of amount
  return amount >= 0 ? 'income' : 'expense'
}

function guessCategory(description, type) {
  const d = (description || '').toLowerCase()
  if (type === 'income') {
    if (d.includes('salary') || d.includes('payroll') || d.includes('direct dep')) return 'Salary'
    if (d.includes('dividend') || d.includes('interest') || d.includes('invest'))   return 'Investment'
    if (d.includes('freelance') || d.includes('contract'))                           return 'Freelance'
    return 'Other'
  }
  if (d.match(/grocery|grocer|whole foods|trader joe|safeway|kroger|costco|walmart|target/)) return 'Food & Dining'
  if (d.match(/restaurant|café|cafe|mcdonald|starbucks|chipotle|doordash|uber eats|grubhub/)) return 'Food & Dining'
  if (d.match(/rent|mortgage|electric|gas util|water|internet|comcast|at&t|verizon/)) return 'Housing & Utilities'
  if (d.match(/uber|lyft|parking|transit|mta|metro|gas station|shell|bp|chevron/))   return 'Transportation'
  if (d.match(/netflix|spotify|hulu|amazon prime|disney|movie|concert|ticket/))      return 'Entertainment'
  if (d.match(/gym|doctor|pharmacy|cvs|walgreen|health|dental|vision/))              return 'Health & Fitness'
  if (d.match(/amazon|ebay|shop|store|clothing|apparel/))                            return 'Shopping'
  if (d.match(/hotel|airbnb|flight|airline|travel/))                                 return 'Travel'
  if (d.match(/tuition|udemy|coursera|book|school|education/))                       return 'Education'
  return 'Other'
}

export default function CSVImport({ onImport, onClose }) {
  const fileRef = useRef(null)
  const [step,     setStep]     = useState('upload')  // upload | map | preview | done
  const [headers,  setHeaders]  = useState([])
  const [rawRows,  setRawRows]  = useState([])
  const [mapping,  setMapping]  = useState({ date: '', description: '', amount: '', type: '', category: '' })
  const [preview,  setPreview]  = useState([])
  const [selected, setSelected] = useState(new Set())
  const [error,    setError]    = useState('')

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const { headers: h, rows: r } = parseCSV(ev.target.result)
        if (!h.length) { setError('Could not parse CSV — check the file format.'); return }
        setHeaders(h)
        setRawRows(r)
        setMapping(guessMapping(h))
        setStep('map')
      } catch {
        setError('Failed to read file.')
      }
    }
    reader.readAsText(file)
  }

  function buildPreview() {
    if (!mapping.date || !mapping.amount) {
      setError('Date and Amount columns are required.')
      return
    }
    setError('')
    const rows = rawRows.map((row, i) => {
      const rawAmt  = parseAmount(row[mapping.amount])
      const amt     = Math.abs(rawAmt)
      const type    = guessType(row, mapping, rawAmt)
      const desc    = mapping.description ? row[mapping.description] : ''
      const dateStr = parseDate(row[mapping.date])
      const cat     = mapping.category && row[mapping.category]
        ? row[mapping.category]
        : guessCategory(desc, type)
      return { _id: i, date: dateStr, description: desc, amount: amt, type, category: cat, valid: !!dateStr && amt > 0 }
    }).filter(r => r.valid)

    setPreview(rows)
    setSelected(new Set(rows.map(r => r._id)))
    setStep('preview')
  }

  function toggleRow(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function updatePreviewRow(id, field, value) {
    setPreview(prev => prev.map(r => r._id === id ? { ...r, [field]: value } : r))
  }

  function handleImport() {
    const toImport = preview.filter(r => selected.has(r._id)).map(({ _id, valid, ...r }) => ({
      ...r,
      id: crypto.randomUUID(),
      earner: 'joint',
      recurring: false,
      frequency: null,
      endDate: null,
    }))
    onImport(toImport)
    setStep('done')
  }

  const allSelected = preview.length > 0 && preview.every(r => selected.has(r._id))

  return (
    <div className="csv-import">

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div className="csv-upload-area">
          <h2 className="csv-title">Import Transactions</h2>
          <p className="csv-sub">Upload a CSV exported from your bank or credit card.</p>
          <div
            className="csv-dropzone"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { fileRef.current.files = e.dataTransfer.files; handleFile({ target: { files: [f] } }) } }}
          >
            <span className="csv-drop-icon">📂</span>
            <span className="csv-drop-text">Click to choose a file or drag it here</span>
            <span className="csv-drop-hint">.csv files only</span>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFile} />
          {error && <p className="csv-error">{error}</p>}
          <p className="csv-bank-note">
            Most banks: Account → Download Activity → CSV. Common formats from Chase, BofA, Wells Fargo, and Mint all work.
          </p>
        </div>
      )}

      {/* ── Step 2: Map columns ── */}
      {step === 'map' && (
        <div>
          <h2 className="csv-title">Map Columns</h2>
          <p className="csv-sub">Match your CSV columns to the fields below. We guessed where we could.</p>
          <div className="csv-mapping-grid">
            {[
              { key: 'date',        label: 'Date',        required: true  },
              { key: 'amount',      label: 'Amount',      required: true  },
              { key: 'description', label: 'Description', required: false },
              { key: 'type',        label: 'Type (income/expense)', required: false },
              { key: 'category',    label: 'Category',    required: false },
            ].map(({ key, label, required }) => (
              <div key={key} className="csv-map-row">
                <label className="csv-map-label">
                  {label}{required && <span className="csv-required"> *</span>}
                </label>
                <select
                  className="csv-map-select"
                  value={mapping[key]}
                  onChange={e => setMapping(m => ({ ...m, [key]: e.target.value }))}
                >
                  <option value="">(skip)</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <p className="csv-sub" style={{ marginTop: 8 }}>
            {rawRows.length} rows found · preview of first row: {headers.map(h => `${h}: "${rawRows[0]?.[h] ?? ''}"`).join(' | ')}
          </p>
          {error && <p className="csv-error">{error}</p>}
          <div className="csv-actions">
            <button className="csv-btn-secondary" onClick={() => setStep('upload')}>Back</button>
            <button className="csv-btn-primary"   onClick={buildPreview}>Preview →</button>
          </div>
        </div>
      )}

      {/* ── Step 3: Preview & edit ── */}
      {step === 'preview' && (
        <div>
          <h2 className="csv-title">Review Transactions</h2>
          <p className="csv-sub">
            {preview.length} transactions parsed. Uncheck any you don't want to import. You can edit fields inline.
          </p>
          <div className="csv-preview-wrap">
            <table className="csv-preview-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(preview.map(r => r._id)))} />
                  </th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.map(row => (
                  <tr key={row._id} className={selected.has(row._id) ? '' : 'csv-row-deselected'}>
                    <td>
                      <input type="checkbox" checked={selected.has(row._id)} onChange={() => toggleRow(row._id)} />
                    </td>
                    <td>
                      <input className="csv-cell-input" type="date" value={row.date}
                        onChange={e => updatePreviewRow(row._id, 'date', e.target.value)} />
                    </td>
                    <td>
                      <input className="csv-cell-input" type="text" value={row.description}
                        onChange={e => updatePreviewRow(row._id, 'description', e.target.value)} />
                    </td>
                    <td>
                      <select className="csv-cell-select" value={row.type}
                        onChange={e => updatePreviewRow(row._id, 'type', e.target.value)}>
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                    </td>
                    <td>
                      <select className="csv-cell-select" value={row.category}
                        onChange={e => updatePreviewRow(row._id, 'category', e.target.value)}>
                        {(row.type === 'income' ? INCOME_CATS : EXPENSE_CATS).map(c =>
                          <option key={c} value={c}>{c}</option>
                        )}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="csv-cell-input csv-amount-input" type="number" min="0" step="0.01"
                        value={row.amount}
                        onChange={e => updatePreviewRow(row._id, 'amount', parseFloat(e.target.value) || 0)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="csv-actions">
            <button className="csv-btn-secondary" onClick={() => setStep('map')}>Back</button>
            <span className="csv-selected-count">{selected.size} of {preview.length} selected</span>
            <button className="csv-btn-primary" onClick={handleImport} disabled={selected.size === 0}>
              Import {selected.size} transaction{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Done ── */}
      {step === 'done' && (
        <div className="csv-done">
          <span className="csv-done-icon">✓</span>
          <h2 className="csv-title">Import Complete</h2>
          <p className="csv-sub">Your transactions have been saved.</p>
          <button className="csv-btn-primary" onClick={onClose}>Done</button>
        </div>
      )}
    </div>
  )
}
