-- Runs before `prisma db push` (the `push` script in packages/db/package.json). Products come only from /setup
-- (2026-11-07): Products imported from config.json `contexts` (source = 'config') and their chats are deleted while the
-- `source` column still tells them apart, then the column, the ProductSource type and the SearchContext table are
-- dropped, so the push has nothing left to drop and never needs --accept-data-loss. One statement, so all or nothing;
-- on a fresh or already upgraded database it does nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Product' AND column_name = 'source') THEN
    -- Chat.productId holds the slug (no foreign key), so a later Product with that slug starts with no chats
    DELETE FROM "Chat" WHERE "productId" IN (SELECT "slug" FROM "Product" WHERE "source"::text = 'config');
    DELETE FROM "Product" WHERE "source"::text = 'config';
    ALTER TABLE "Product" DROP COLUMN "source";
  END IF;
  DROP TABLE IF EXISTS "SearchContext";
  DROP TYPE IF EXISTS "ProductSource";
END $$;
