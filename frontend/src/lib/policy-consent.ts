/** cookie จำฉบับนโยบายที่ติ๊กยอมรับไว้ที่หน้า login (อ่านที่ /policy-accept หลังเข้าสู่ระบบครบทุกขั้น) — หลายเรื่อง = "1,4,7" */
export const POLICY_CONSENT_COOKIE = "eam_policy_consent";

/** ค่าที่ส่งมาจากฟอร์ม/ cookie → เลขฉบับ (รูปแบบผิด = ว่าง) */
export const consentVersions = (value: string | null | undefined): number[] => (value && /^\d+(,\d+)*$/.test(value) ? value.split(",").map(Number) : []);
