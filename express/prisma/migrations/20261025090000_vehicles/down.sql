-- ย้อนกลับ 20261025090000_vehicles (รันด้วย mysql client เอง) — ไฟล์รูปใน storage/private/vehicles/ ลบเองถ้าต้องการ
DROP TABLE IF EXISTS `vehicle_booking_extras`;
DROP TABLE IF EXISTS `vehicle_bookings`;
DROP TABLE IF EXISTS `vehicle_images`;
DROP TABLE IF EXISTS `vehicles`;
DELETE FROM `dropdown_options` WHERE `list` IN ('vehicle_purpose', 'vehicle_extra');
