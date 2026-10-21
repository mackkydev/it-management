-- ย้อนกลับ 20261105090000_vehicle_booking_approval (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
-- การจองที่ยังรออนุมัติ → ถือว่ายืนยันแล้ว (ระบบเดิมไม่มีขั้นอนุมัติ), ไม่อนุมัติ → ยกเลิก
UPDATE `vehicle_bookings` SET `status` = 'confirmed' WHERE `status` = 'pending';
UPDATE `vehicle_bookings` SET `status` = 'cancelled', `cancelled_at` = `rejected_at`, `cancelled_by` = `rejected_by` WHERE `status` = 'rejected';
ALTER TABLE `vehicle_bookings` DROP COLUMN `approved_by`,
    DROP COLUMN `approved_at`,
    DROP COLUMN `rejected_by`,
    DROP COLUMN `rejected_at`,
    DROP COLUMN `reject_reason`;
