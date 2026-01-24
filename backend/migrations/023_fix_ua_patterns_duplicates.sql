-- Fix duplicate UA patterns and add unique constraint

-- First, delete duplicates keeping only the first occurrence
DELETE FROM security_ua_patterns a
USING security_ua_patterns b
WHERE a.id > b.id
  AND a.pattern = b.pattern
  AND a.category = b.category
  AND COALESCE(a.owner_id::text, 'system') = COALESCE(b.owner_id::text, 'system');

-- Add unique constraint to prevent future duplicates
-- For system patterns (owner_id IS NULL), pattern + category must be unique
-- For user patterns, owner_id + pattern + category must be unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_ua_patterns_unique 
ON security_ua_patterns (COALESCE(owner_id::text, 'system'), category, pattern);

