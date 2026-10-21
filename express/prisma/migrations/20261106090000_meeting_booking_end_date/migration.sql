-- ห้องประชุม: จองหลายวัน (ช่วงเวลาเดียวกันทุกวัน) — end_date = วันสุดท้าย, ข้อมูลเดิมเติม = booking_date (วันเดียว)

-- AlterTable
ALTER TABLE `meeting_bookings` ADD COLUMN `end_date` DATE NULL;

UPDATE `meeting_bookings` SET `end_date` = `booking_date` WHERE `end_date` IS NULL;

-- CreateIndex
CREATE INDEX `meeting_bookings_room_id_end_date_index` ON `meeting_bookings`(`room_id`, `end_date`);
