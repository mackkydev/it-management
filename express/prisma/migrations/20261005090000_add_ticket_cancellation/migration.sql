-- AlterTable
ALTER TABLE "it_tickets" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancel_requested_at" TIMESTAMP(0),
ADD COLUMN     "cancel_requested_status" VARCHAR(30),
ADD COLUMN     "cancelled_at" TIMESTAMP(0),
ADD COLUMN     "cancelled_by" BIGINT;

