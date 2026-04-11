# Sage — Personal Financial Advisor

A personal budgeting and financial planning app built with React and Vite, backed by Supabase. Track income and expenses, plan for retirement, manage debt, and get a full picture of your financial health.

## Features

- **Dashboard** — Net worth, monthly summary, 6-month income/expense trend, emergency fund status, upcoming bills, savings goal progress, and recent activity — all at a glance
- **Transactions** — Log and manage income and expense entries with spending breakdown by category
- **Cash Flow** — Short-term monthly projection and long-term multi-year forecast in one view
- **Budget & Bills** — Plan income vs. expenses and track recurring bills; toggle between detailed per-transaction tracking or a simple monthly discretionary budget
- **Net Worth** — Track assets and liabilities with 30-year growth projections
- **Investments** — Portfolio allocation, ESPP, equity/RSU grants, rental properties, and passive income
- **Planning** — Retirement calculator, tax estimator, emergency fund tracker, and savings goals
- **Debt** — Loan management with amortization and debt payoff strategy comparison (avalanche/snowball)
- **Financial Health Score** — Composite score across all financial dimensions, accessible from the header
- **Sage AI Advisor** — AI-powered financial guidance available as a slide-out chat on any page
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
