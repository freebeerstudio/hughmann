-- Fix context_docs.id to TEXT for deterministic string IDs (soul, owner, domain-fbs, etc.)
ALTER TABLE context_docs ALTER COLUMN id SET DATA TYPE TEXT;
ALTER TABLE context_docs ALTER COLUMN id DROP DEFAULT;
