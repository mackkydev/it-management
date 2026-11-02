-- ย้อนกลับ 20261115090000_vehicle_drivers (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — คนขับที่เลือกไว้และเหตุผลการยกเลิกหายไป
ALTER TABLE `vehicle_bookings` DROP FOREIGN KEY `vehicle_bookings_driver_id_foreign`;
DROP INDEX `vehicle_bookings_driver_id_start_on_end_on_index` ON `vehicle_bookings`;
ALTER TABLE `vehicle_bookings` DROP COLUMN `needs_driver`, DROP COLUMN `driver_id`, DROP COLUMN `cancel_reason`;
DROP TABLE IF EXISTS `vehicle_drivers`;
