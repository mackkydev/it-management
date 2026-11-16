-- audit_logs: เบราว์เซอร์/อุปกรณ์ที่ใช้ (User-Agent ของผู้ใช้ ที่หน้าเว็บส่งต่อมาใน X-Client-Agent) — แถวเดิมเป็น NULL
ALTER TABLE `audit_logs` ADD COLUMN `user_agent` VARCHAR(255) NULL;
