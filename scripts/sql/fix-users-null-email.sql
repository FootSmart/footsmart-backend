-- Fix pour l'erreur TypeORM:
-- QueryFailedError: column "email" of relation "users" contains null values
--
-- Option A (recommandé): supprimer les lignes invalides (users sans email)
-- ATTENTION: exécuter uniquement si ces comptes ne doivent pas exister.
DELETE FROM "users" WHERE "email" IS NULL;

-- Option B (si tu veux les garder): attribuer des emails "placeholder" uniques
-- Décommente si nécessaire.
-- UPDATE "users"
-- SET "email" = CONCAT('unknown+', "id", '@example.invalid')
-- WHERE "email" IS NULL;

