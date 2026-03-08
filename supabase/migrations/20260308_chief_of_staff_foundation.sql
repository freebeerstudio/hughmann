-- supabase/migrations/20260308_chief_of_staff_foundation.sql
-- Phase 1: Chief of Staff Foundation
-- Adds North Star + guardrails to projects, creates domain_goals table

-- 1. Extend projects table with North Star fields
ALTER TABLE projects ADD COLUMN IF NOT EXISTS north_star TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS guardrails JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS domain_goal_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS infrastructure JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS refinement_cadence TEXT DEFAULT 'weekly'
  CHECK (refinement_cadence IN ('weekly', 'biweekly', 'monthly'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_refinement_at TIMESTAMPTZ;

-- 2. Create domain_goals table
CREATE TABLE IF NOT EXISTS domain_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id),
  statement TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_goals_domain ON domain_goals(domain);
CREATE INDEX IF NOT EXISTS idx_domain_goals_customer ON domain_goals(customer_id);

-- 3. Add FK from projects to domain_goals
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_projects_domain_goal'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT fk_projects_domain_goal
      FOREIGN KEY (domain_goal_id) REFERENCES domain_goals(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. RLS for domain_goals
ALTER TABLE domain_goals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'domain_goals' AND policyname = 'Service role full access on domain_goals'
  ) THEN
    CREATE POLICY "Service role full access on domain_goals"
      ON domain_goals FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 5. Seed initial domain goals
INSERT INTO domain_goals (domain, customer_id, statement) VALUES
  ('fbs', 'fdd7ce7f-5194-4dae-91c5-fd6b1b4d6a88', 'Increase revenue daily'),
  ('omnissa', '926a785c-2964-4eef-973c-c82f768d8a56', 'Win every deal in my territory'),
  ('personal', 'fc64558e-2740-4005-883f-53388b7edad7', 'Build the life I want')
ON CONFLICT DO NOTHING;
