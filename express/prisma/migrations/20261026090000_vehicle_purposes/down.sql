-- ย้อนกลับ 20261026090000_vehicle_purposes (รันด้วย mysql client เอง) — ลบเฉพาะที่ยังไม่มีการจองใช้
DELETE o FROM `dropdown_options` o
WHERE o.`list` = 'vehicle_purpose' AND o.`name` IN ('ใช้ชั่วคราว', 'ใช้ระหว่างรอรถซ่อม')
  AND NOT EXISTS (SELECT 1 FROM `vehicle_bookings` b WHERE b.`purpose` = o.`name`);
