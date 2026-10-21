-- จองรถ: ผู้จัดคิวรถอนุมัติก่อนขึ้นปฏิทิน — status pending (รออนุมัติ) → confirmed / rejected
-- การจองเดิมทั้งหมดคงสถานะเดิม (confirmed / cancelled) — ถือว่าอนุมัติแล้ว

-- AlterTable
ALTER TABLE `vehicle_bookings` ADD COLUMN `approved_by` BIGINT NULL,
    ADD COLUMN `approved_at` DATETIME(0) NULL,
    ADD COLUMN `rejected_by` BIGINT NULL,
    ADD COLUMN `rejected_at` DATETIME(0) NULL,
    ADD COLUMN `reject_reason` VARCHAR(1000) NULL;
