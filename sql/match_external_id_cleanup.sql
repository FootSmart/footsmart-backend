-- ============================================================
-- FootSmart – external_id cleanup & deduplication guide
-- ============================================================
-- Run these queries MANUALLY inside Supabase SQL editor.
-- Nothing below executes any destructive operation automatically.
-- Destructive steps are provided as commented-out examples only.
-- ============================================================

-- ─── 1. DIAGNOSTIC: find rows with bad external_id patterns ────────────────
-- These are rows saved before the fix, where the scraper embedded status
-- (res / fix) inside external_id, making deduplication impossible.

SELECT
  id,
  external_id,
  status,
  home_goals,
  away_goals,
  result,
  match_date,
  match_time,
  created_at
FROM matches
WHERE
  external_id ILIKE '%_res_%'
  OR external_id ILIKE '%_fix_%'
ORDER BY match_date DESC;


-- ─── 2. DIAGNOSTIC: find pairs of duplicate matches ────────────────────────
-- For every match scraped twice (once as fixture, once as result),
-- both rows will appear here ordered by created_at.
-- The OLDER row (scheduled) is typically the "clean" one to keep.

WITH normalized AS (
  SELECT
    id,
    external_id,
    status,
    home_goals,
    away_goals,
    result,
    match_date,
    created_at,
    -- Strip leading prefix: remove _res_ or _fix_ segment
    REGEXP_REPLACE(external_id, '_(res|fix)_', '_', 'g') AS normalized_ext_id
  FROM matches
  WHERE external_id IS NOT NULL
)
SELECT
  n1.id            AS row_1_id,
  n1.external_id   AS row_1_ext,
  n1.status        AS row_1_status,
  n1.created_at    AS row_1_created,
  n2.id            AS row_2_id,
  n2.external_id   AS row_2_ext,
  n2.status        AS row_2_status,
  n2.created_at    AS row_2_created
FROM normalized n1
JOIN normalized n2
  ON  n1.normalized_ext_id = n2.normalized_ext_id
  AND n1.id < n2.id
ORDER BY n1.match_date DESC;


-- ─── 3. DIAGNOSTIC: find matches that have no goals but status=finished ─────
-- These may have been saved from a result scrape where goals were not written.

SELECT
  id,
  external_id,
  status,
  home_goals,
  away_goals,
  match_date
FROM matches
WHERE status = 'finished'
  AND (home_goals IS NULL OR away_goals IS NULL)
ORDER BY match_date DESC;


-- ─── 4. DIAGNOSTIC: find matches with goals but status≠finished ─────────────
-- These may be stale rows where status was not updated by the upsert.

SELECT
  id,
  external_id,
  status,
  home_goals,
  away_goals,
  match_date
FROM matches
WHERE (home_goals IS NOT NULL AND away_goals IS NOT NULL)
  AND status != 'finished'
ORDER BY match_date DESC;


-- ─── 5. SAFE MIGRATION: fix status on rows that have goals ─────────────────
-- Run this ONLY after verifying the rows from query 4 above are correct.
-- Review results first, then uncomment UPDATE.

-- UPDATE matches
-- SET status = 'finished'
-- WHERE (home_goals IS NOT NULL AND away_goals IS NOT NULL)
--   AND status != 'finished';


-- ─── 6. MERGE: copy result data from duplicate res_ row to the fix_ row ────
-- For each duplicate pair, update the fixture row with the result data,
-- then delete the result row. Do this row-by-row after visual inspection.
--
-- Example (replace the two UUIDs with real IDs from query 2):
--
-- UPDATE matches
-- SET
--   status        = src.status,
--   home_goals    = src.home_goals,
--   away_goals    = src.away_goals,
--   ht_home_goals = src.ht_home_goals,
--   ht_away_goals = src.ht_away_goals,
--   ft_home_goals = src.ft_home_goals,
--   ft_away_goals = src.ft_away_goals,
--   result        = src.result,
--   updated_at    = NOW()
-- FROM (
--   SELECT * FROM matches WHERE id = '<RESULT_ROW_ID>'
-- ) AS src
-- WHERE matches.id = '<FIXTURE_ROW_ID>';
--
-- -- Then delete the now-redundant result row:
-- DELETE FROM matches WHERE id = '<RESULT_ROW_ID>';


-- ─── 7. AFTER SCRAPER IS FIXED: normalise remaining bad external_ids ────────
-- Once the new upsert logic is deployed, rename old bad external_ids
-- so they match the stable format. This prevents future duplicates.
-- Review the output of query 1 first, then adapt & run.
--
-- UPDATE matches
-- SET
--   external_id = REGEXP_REPLACE(external_id, '_(res|fix)_', '_', 'g'),
--   updated_at  = NOW()
-- WHERE
--   external_id ILIKE '%_res_%'
--   OR external_id ILIKE '%_fix_%';


-- ─── 8. VERIFY: no remaining bad external_id rows ───────────────────────────
-- Run after migration steps to confirm cleanup is complete.

SELECT COUNT(*) AS bad_external_ids_remaining
FROM matches
WHERE
  external_id ILIKE '%_res_%'
  OR external_id ILIKE '%_fix_%';

-- Expected result: 0
