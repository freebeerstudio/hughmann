-- Domain Progress Tracking: add current_state and state_updates to domain_goals
ALTER TABLE domain_goals ADD COLUMN IF NOT EXISTS current_state TEXT;
ALTER TABLE domain_goals ADD COLUMN IF NOT EXISTS state_updates JSONB DEFAULT '[]'::jsonb;
