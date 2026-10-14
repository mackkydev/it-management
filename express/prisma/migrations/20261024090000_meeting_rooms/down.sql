-- ย้อนกลับ 20261024090000_meeting_rooms (รันด้วย mysql client เอง) — ไฟล์รูปใน storage/private/meeting-rooms/ ลบเองถ้าต้องการ
DROP TABLE IF EXISTS `meeting_booking_equipment`;
DROP TABLE IF EXISTS `meeting_bookings`;
DROP TABLE IF EXISTS `meeting_room_images`;
DROP TABLE IF EXISTS `meeting_rooms`;
DELETE FROM `dropdown_options` WHERE `list` IN ('meeting_purpose', 'meeting_equipment');
