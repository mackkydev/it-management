-- กิจกรรมในปฏิทิน: ไม่รวมเสาร์-อาทิตย์ (ช่วงวันคร่อมสุดสัปดาห์ แสดง/ส่งออกเฉพาะวันธรรมดา)
ALTER TABLE `calendar_events` ADD COLUMN `skip_weekends` BOOLEAN NOT NULL DEFAULT false;
