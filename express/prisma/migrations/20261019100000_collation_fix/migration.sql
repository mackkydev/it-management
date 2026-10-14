-- ตารางใหม่ช่วงนี้ถูกสร้างด้วย utf8mb4_unicode_ci — ปรับให้ตรงกับมาตรฐานของฐาน (utf8mb4_0900_as_ci) เพื่อเทียบข้อความข้ามตารางได้
ALTER TABLE `it_ticket_helpers` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
ALTER TABLE `holiday_calendars` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
ALTER TABLE `contract_categories` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
