-- ============================================================
-- Sage Personal Finance App — Auth Migration
-- Run this in your Supabase project's SQL Editor AFTER migration.sql
--
-- IMPORTANT: This migration adds multi-user support via Row Level
-- Security. Any existing rows without a user_id will become
-- inaccessible to authenticated users (they are treated as
-- legacy/orphaned data). The app will seed fresh sample data
-- for new users on first login.
-- ============================================================

-- ── Step 1: Add user_id columns ──────────────────────────────
-- Nullable so existing rows (pre-auth) are not immediately dropped.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE app_data
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── Step 2: Update app_data primary key ───────────────────────
-- The old primary key is just (key), which breaks with multiple users
-- (two users would conflict on the same key). We drop it and create a
-- composite unique index on (user_id, key) instead.

ALTER TABLE app_data DROP CONSTRAINT IF EXISTS app_data_pkey;

-- Composite unique index used by Supabase upsert onConflict.
-- NULL user_id rows (legacy) are still stored but not matched by auth'd users.
CREATE UNIQUE INDEX IF NOT EXISTS app_data_user_key_uidx
  ON app_data (user_id, key);

-- Performance index for transactions filtering
CREATE INDEX IF NOT EXISTS transactions_user_id_idx
  ON transactions (user_id);

-- ── Step 3: Enable Row Level Security ─────────────────────────
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data     ENABLE ROW LEVEL SECURITY;

-- ── Step 4: RLS policies for transactions ─────────────────────
-- Drop if re-running migration
DROP POLICY IF EXISTS "select_own_transactions" ON transactions;
DROP POLICY IF EXISTS "insert_own_transactions" ON transactions;
DROP POLICY IF EXISTS "update_own_transactions" ON transactions;
DROP POLICY IF EXISTS "delete_own_transactions" ON transactions;

CREATE POLICY "select_own_transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "insert_own_transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_transactions"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "delete_own_transactions"
  ON transactions FOR DELETE
  USING (auth.uid() = user_id);

-- ── Step 5: RLS policies for app_data ─────────────────────────
DROP POLICY IF EXISTS "select_own_app_data" ON app_data;
DROP POLICY IF EXISTS "insert_own_app_data" ON app_data;
DROP POLICY IF EXISTS "update_own_app_data" ON app_data;
DROP POLICY IF EXISTS "delete_own_app_data" ON app_data;

CREATE POLICY "select_own_app_data"
  ON app_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "insert_own_app_data"
  ON app_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_app_data"
  ON app_data FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "delete_own_app_data"
  ON app_data FOR DELETE
  USING (auth.uid() = user_id);
