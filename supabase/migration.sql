-- ============================================================
-- Sage Personal Finance App — Supabase Migration
-- Run this in your Supabase project's SQL Editor
-- ============================================================

-- Individual transaction records
CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT         PRIMARY KEY,
  type        TEXT         NOT NULL CHECK (type IN ('income', 'expense')),
  amount      NUMERIC(12,2) NOT NULL,
  category    TEXT         NOT NULL DEFAULT '',
  date        DATE         NOT NULL,
  description TEXT                  DEFAULT '',
  earner      TEXT         NOT NULL DEFAULT 'joint',
  created_at  TIMESTAMPTZ           DEFAULT NOW()
);

-- Generic key-value store for all other app config/settings
-- (budget, loans, net worth accounts, household names, etc.)
CREATE TABLE IF NOT EXISTS app_data (
  key        TEXT  PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ    DEFAULT NOW()
);

-- No auth in this app — open access with anon key
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_data     DISABLE ROW LEVEL SECURITY;
