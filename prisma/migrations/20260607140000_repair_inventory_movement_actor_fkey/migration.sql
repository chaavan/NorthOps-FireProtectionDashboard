ALTER TABLE inventory_movements
  ALTER COLUMN actor_user_id DROP NOT NULL;

-- Legacy rows used placeholder actor ids (e.g. "system") that are not User.id values.
UPDATE inventory_movements im
SET actor_user_id = NULL
WHERE im.actor_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "User" u WHERE u.id = im.actor_user_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_actor_user_id_fkey'
  ) THEN
    ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_actor_user_id_fkey
      FOREIGN KEY (actor_user_id) REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
