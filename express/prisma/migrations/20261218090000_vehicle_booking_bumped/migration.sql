-- จัดคิวรถ: รถของการจองนี้ถูกผู้จัดคิวดึงไปให้การจองอื่น (ยังไม่ได้จัดรถใหม่) — หน้าจัดคิวกรอบแดงเตือน, ล้างเมื่อจัดรถให้แล้ว
ALTER TABLE `vehicle_bookings` ADD COLUMN `vehicle_bumped_at` DATETIME(0) NULL;
