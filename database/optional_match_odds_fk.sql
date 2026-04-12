-- Optionnel : si match_odds.match_id référence matches.id mais sans contrainte FK,
-- PostgREST ne peut pas faire matches!inner(...) dans les requêtes embed.
-- Exécuter dans Supabase SQL Editor (une fois) si tu veux activer les jointures auto :

-- ALTER TABLE match_odds
--   ADD CONSTRAINT match_odds_match_id_fkey
--   FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;

-- Vérifie d’abord les lignes orphelines :
-- SELECT mo.match_id FROM match_odds mo
-- LEFT JOIN matches m ON m.id = mo.match_id WHERE m.id IS NULL;
