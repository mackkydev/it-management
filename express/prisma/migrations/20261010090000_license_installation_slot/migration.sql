-- การติดตั้ง license: ช่องในฟอร์มเครื่องคอมพิวเตอร์ (os / office / antivirus) — NULL = Software อื่นๆ หรือบันทึกจากหน้าการติดตั้ง License
ALTER TABLE `license_installations` ADD COLUMN `slot` VARCHAR(20) NULL;
