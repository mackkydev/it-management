-- ย้อนกลับ 20261028090000_booking_branch_scope (รันด้วย mysql client เอง) — ประวัติการย้ายรถ / ประเภทรถ / เชื้อเพลิงหาย, การจองรถไม่มีสาขา (ผู้จัดคิวทุกคนเห็นทุกคำขอ)
ALTER TABLE `vehicle_bookings` DROP FOREIGN KEY `vehicle_bookings_branch_id_foreign`;
DROP INDEX `vehicle_bookings_branch_id_index` ON `vehicle_bookings`;
ALTER TABLE `vehicle_bookings` DROP COLUMN `branch_id`;
DROP TABLE `vehicle_transfers`;
DELETE FROM `app_settings` WHERE `key` = 'booking_scope';
ALTER TABLE `vehicles` DROP COLUMN `vehicle_type`, DROP COLUMN `fuel_type`;
DELETE FROM `dropdown_options` WHERE `list` IN ('vehicle_type', 'vehicle_fuel');
