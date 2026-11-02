-- จอง ZOOM: รายละเอียดประชุมที่ฝ่าย IT ดึงจากข้อความเชิญของ ZOOM (Topic / Meeting ID / Passcode) — ข้อความเชิญเต็มเก็บใน link_note
ALTER TABLE `zoom_bookings` ADD COLUMN `meeting_topic` VARCHAR(255) NULL,
    ADD COLUMN `meeting_id` VARCHAR(50) NULL,
    ADD COLUMN `passcode` VARCHAR(50) NULL;
