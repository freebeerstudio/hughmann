-- Add Health, ICA Research, and Masonic domains
-- Creates customer entries + tenant_members for Wayne

-- Step 1: Insert customers
INSERT INTO customers (name, slug, color, tenant_type) VALUES
  ('Health', 'health', '#30D158', 'personal'),
  ('ICA Research', 'ica_research', '#5856D6', 'personal'),
  ('Masonic', 'masonic', '#007AFF', 'personal')
ON CONFLICT (slug) DO NOTHING;

-- Step 2: Link to Wayne's user account
INSERT INTO tenant_members (user_id, tenant_id, role, is_default)
SELECT 'ee2a626f-9e23-490c-a561-31a805e1b4d1', id, 'owner', false
FROM customers
WHERE slug IN ('health', 'ica_research', 'masonic')
ON CONFLICT DO NOTHING;

-- Step 3: Create domain goals (so they show on Plan page)
INSERT INTO domain_goals (domain, statement, guardrails)
SELECT slug, '', '[]'::jsonb
FROM customers
WHERE slug IN ('health', 'ica_research', 'masonic')
AND NOT EXISTS (
  SELECT 1 FROM domain_goals WHERE domain_goals.domain = customers.slug
);
