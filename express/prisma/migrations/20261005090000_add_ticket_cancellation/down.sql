-- ย้อนกลับ add_ticket_cancellation (รันด้วย psql เอง) — ใบงานที่ status เป็น pending_cancel / cancelled ต้องจัดการเองก่อน
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "it_tickets" WHERE "status" IN ('pending_cancel', 'cancelled')) THEN
    RAISE EXCEPTION 'rollback stopped: cancelled / pending_cancel tickets exist';
  END IF;
END $$;
ALTER TABLE "it_tickets" DROP COLUMN IF EXISTS "cancel_reason", DROP COLUMN IF EXISTS "cancel_requested_at",
  DROP COLUMN IF EXISTS "cancel_requested_status", DROP COLUMN IF EXISTS "cancelled_at", DROP COLUMN IF EXISTS "cancelled_by";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261005090000_add_ticket_cancellation';
COMMIT;
