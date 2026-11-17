-- ฝ่าย / แผนก: ตัวย่อ (Unit Code จาก SyteLine) + ชื่ออังกฤษ — name เดิม = ชื่อไทย
ALTER TABLE `divisions`
    ADD COLUMN `code` VARCHAR(20) NULL COLLATE utf8mb4_0900_as_ci,
    ADD COLUMN `name_en` VARCHAR(150) NULL COLLATE utf8mb4_0900_as_ci,
    ADD UNIQUE INDEX `divisions_code_unique` (`code`);

ALTER TABLE `departments`
    ADD COLUMN `code` VARCHAR(20) NULL COLLATE utf8mb4_0900_as_ci,
    ADD COLUMN `name_en` VARCHAR(150) NULL COLLATE utf8mb4_0900_as_ci,
    ADD UNIQUE INDEX `departments_code_unique` (`code`);
