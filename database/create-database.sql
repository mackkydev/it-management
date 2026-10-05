-- สำหรับติดตั้ง MySQL 8.4 เองโดยไม่ใช้ Docker (ใน Docker ใช้ docker/mysql/init.sh แทน)
-- รันด้วย root:  mysql -u root -p < database/create-database.sql
-- แล้วสร้างตาราง: cd express && npx prisma migrate deploy && npx prisma db seed
-- ตั้งค่าเซิร์ฟเวอร์ (my.cnf): character-set-server=utf8mb4, collation-server=utf8mb4_0900_as_ci, default-time-zone='+00:00'

-- utf8mb4_0900_as_ci = ไม่สนตัวพิมพ์เล็ก-ใหญ่ แต่แยกวรรณยุกต์/สระไทย (ai_ci / unicode_ci ถือว่า "ขาย" = "ข่าย")
CREATE DATABASE IF NOT EXISTS it_system CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
-- เฉพาะเครื่องพัฒนา: ฐานเทสต์ และฐานชั่วคราวของ prisma migrate dev
CREATE DATABASE IF NOT EXISTS it_system_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
CREATE DATABASE IF NOT EXISTS it_system_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- บัญชีของแอป (ไม่ใช่ root) — เปลี่ยนรหัสผ่านให้ตรงกับ DB_PASSWORD ใน express/.env
CREATE USER IF NOT EXISTS 'it_app'@'%' IDENTIFIED BY 'change_me_strong_password';
GRANT ALL PRIVILEGES ON it_system.* TO 'it_app'@'%';
GRANT ALL PRIVILEGES ON it_system_test.* TO 'it_app'@'%';
GRANT ALL PRIVILEGES ON it_system_shadow.* TO 'it_app'@'%';
FLUSH PRIVILEGES;
