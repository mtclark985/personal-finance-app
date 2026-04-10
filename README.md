# Sage — Personal Financial Advisor

A personal budgeting and financial planning app built with React and Vite, backed by Supabase. Track income and expenses, plan for retirement, manage debt, and get a full picture of your financial health.

## Features

- **Dashboard** — Monthly income/expense summary with spending charts by category
- **Transactions** — Log and manage income and expense entries
- **Cash Flow** — Short-term and long-term cash flow projections
- **Budget Planner** — Plan and compare income vs. expenses by category
- **Financial Health Score** — Composite score based on your financial data
- **Retirement Calculator** — Project retirement savings and income
- **Tax Estimator** — Estimate federal tax liability
- **Emergency Fund** — Track progress toward your emergency fund target
- **Bills** — Track recurring bills and upcoming due dates
- **Savings Goals** — Set and monitor progress toward savings targets
- **Investment Allocation** — Track and balance your investment portfolio
- **ESPP & Equity** — Tools for employee stock purchase plans and equity compensation
- **Rental Properties** — Track rental income and expenses
- **Passive Income** — Monitor passive income streams
- **Debt Payoff** — Visualize debt payoff strategies (avalanche/snowball)
- **Net Worth** — Track assets and liabilities over time
- **Loans** — Manage loan balances and payments
- **Sage AI Advisor** — AI-powered financial guidance chat
- **Multi-earner support** — Filter views by household member or combined
- **Dark mode** — Toggle between light and dark themes
- **Authentication** — Email/password and Google OAuth via Supabase Auth

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8 |
| Charts | Recharts |
| Backend / DB | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email + Google OAuth) |
| Styling | Plain CSS |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project

### 1. Clone and install

```bash
git clone <repo-url>
cd personal-finance-app
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Your Supabase URL and anon key can be found in your project's **Settings > API** page.

### 3. Run database migrations

Apply the SQL migrations in the `supabase/` directory to your Supabase project via the SQL editor or the Supabase CLI:

```bash
# Using the Supabase CLI
supabase db push
```

Or paste `supabase/migration.sql` and `supabase/migration_auth.sql` into the Supabase SQL editor and run them.

### 4. Start the dev server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

### Build for production

```bash
npm run build
npm run preview
```
