-- จอง ZOOM: ผู้จองกด "รับลิงก์ / คัดลอกลิงก์" หลังฝ่าย IT ส่งลิงก์ → แจ้งผู้รับงาน (แก้ลิงก์ = ล้าง ให้กดรับใหม่)
ALTER TABLE `zoom_bookings` ADD COLUMN `link_received_at` DATETIME(0) NULL;
