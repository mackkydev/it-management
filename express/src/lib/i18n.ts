/**
 * ข้อความของ API — สำเนาจาก Laravel (backend/lang/{th,en}/eam.php, lang/th/validation.php และข้อความ en ตั้งต้นของ Laravel)
 * แก้ข้อความที่นี่ต้องแก้ใน Laravel ให้ตรงกันด้วย เพื่อให้สลับ backend กันได้
 */
export type Locale = "th" | "en";

const eamTh = {
  status: { active: "ใช้งาน", in_storage: "เก็บในคลัง", in_repair: "ส่งซ่อม", lost: "สูญหาย", disposed: "จำหน่ายแล้ว" },
  movement_type: { registered: "ลงทะเบียน", transfer: "โอนย้าย" },
  movement: {
    nothing_to_change: "กรุณาระบุสถานที่หรือผู้ถือครองที่ต้องการโอนย้าย",
    no_change: "สถานที่และผู้ถือครองเหมือนเดิม ไม่มีการโอนย้าย",
    future_date: "วันที่โอนย้ายต้องไม่เกินเวลาปัจจุบัน",
  },
  location: {
    has_children: "ลบไม่ได้ เพราะยังมีสถานที่ย่อยอยู่ — ย้ายหรือลบสถานที่ย่อยก่อน",
    has_assets: "ลบไม่ได้ เพราะยังมีสินทรัพย์อยู่ในสถานที่นี้ — ย้ายสินทรัพย์ออกก่อน หรือปิดใช้งานแทน",
    invalid_parent: "สถานที่แม่ต้องไม่ใช่ตัวเองหรือสถานที่ย่อยของตัวเอง",
    code_format: "รหัสสถานที่ใช้ได้เฉพาะ A-Z, 0-9, - _ /",
  },
  user: {
    self_lock: "ไม่สามารถลดบทบาทหรือปิดใช้งานบัญชีของตัวเองได้",
    self_delete: "ไม่สามารถลบบัญชีของตัวเองได้",
    has_history: "ลบไม่ได้ เพราะผู้ใช้นี้มีประวัติในระบบ (ถือครอง/บันทึกสินทรัพย์ หรือการโอนย้าย) — ให้ปิดใช้งานแทน",
  },
  auth: { failed: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
  branch: { in_use: "ลบไม่ได้ เพราะยังมีผู้ใช้หรือใบแจ้งงานในสาขานี้ — ให้ปิดใช้งานแทน" },
  ticket: { signature_invalid: "ลายเซ็นไม่ถูกต้อง กรุณาเซ็นใหม่" },
  kpi: { future_date: "วันที่ปฏิบัติงานต้องไม่เป็นวันในอนาคต" },
  expiring: {
    subject: "แจ้งเตือน: รายการใกล้หมดอายุ :count รายการ",
    greeting: "เรียน ฝ่าย IT",
    intro: "รายการต่อไปนี้ใกล้หมดอายุหรือหมดอายุแล้ว กรุณาตรวจสอบและดำเนินการต่ออายุ",
    type: { contract: "สัญญา", credential: "บัญชี/รหัสผ่าน" },
    expired: "หมดอายุแล้ว",
    days_left: "เหลืออีก :days วัน",
    open: "เปิดดูในระบบ",
  },
  validation: {
    asset_tag_regex: "เลขครุภัณฑ์ใช้ได้เฉพาะ A-Z, 0-9, - _ /",
    asset_tag_unique: "เลขครุภัณฑ์นี้มีอยู่ในระบบแล้ว",
    purchase_date_future: "วันที่ซื้อต้องไม่เกินวันนี้",
  },
};

type Eam = typeof eamTh;

const eamEn: Eam = {
  status: { active: "Active", in_storage: "In storage", in_repair: "In repair", lost: "Lost", disposed: "Disposed" },
  movement_type: { registered: "Registered", transfer: "Transfer" },
  movement: {
    nothing_to_change: "Please specify a location or custodian to transfer to.",
    no_change: "Location and custodian are unchanged; nothing to transfer.",
    future_date: "The transfer date cannot be in the future.",
  },
  location: {
    has_children: "Cannot delete: this location still has sub-locations. Move or delete them first.",
    has_assets: "Cannot delete: assets are still assigned here. Move them out first or deactivate the location instead.",
    invalid_parent: "The parent location cannot be itself or one of its sub-locations.",
    code_format: "Location code may only contain A-Z, 0-9, - _ /",
  },
  user: {
    self_lock: "You cannot demote or deactivate your own account.",
    self_delete: "You cannot delete your own account.",
    has_history: "Cannot delete: this user has history (assets held/created or transfers). Deactivate the account instead.",
  },
  auth: { failed: "Invalid email or password." },
  branch: { in_use: "Cannot delete: users or tickets still belong to this branch. Deactivate it instead." },
  ticket: { signature_invalid: "Invalid signature. Please sign again." },
  kpi: { future_date: "The work date cannot be in the future." },
  expiring: {
    subject: "Reminder: :count item(s) expiring soon",
    greeting: "Dear IT team,",
    intro: "The following items are expiring soon or have expired. Please review and renew them.",
    type: { contract: "Contract", credential: "Account/password" },
    expired: "expired",
    days_left: ":days days left",
    open: "Open in IT-SYSTEM",
  },
  validation: {
    asset_tag_regex: "Asset tag may only contain A-Z, 0-9, - _ /",
    asset_tag_unique: "This asset tag already exists.",
    purchase_date_future: "The purchase date cannot be in the future.",
  },
};

/** ข้อความ validation — key เดียวกับ Laravel (max/min แยกตามชนิดข้อมูล) */
type ValidationMessages = Record<string, string | Record<string, string>>;

const validationTh: ValidationMessages = {
  required: "กรุณากรอก:attribute",
  string: ":attributeต้องเป็นข้อความ",
  integer: ":attributeต้องเป็นจำนวนเต็ม",
  numeric: ":attributeต้องเป็นตัวเลข",
  boolean: ":attributeต้องเป็นจริงหรือเท็จ",
  email: "รูปแบบ:attributeไม่ถูกต้อง",
  date: "รูปแบบ:attributeไม่ถูกต้อง",
  regex: "รูปแบบ:attributeไม่ถูกต้อง",
  in: ":attributeที่เลือกไม่ถูกต้อง",
  enum: ":attributeที่เลือกไม่ถูกต้อง",
  exists: "ไม่พบ:attributeที่เลือก",
  unique: ":attributeนี้มีอยู่ในระบบแล้ว",
  confirmed: "การยืนยัน:attributeไม่ตรงกัน",
  current_password: "รหัสผ่านปัจจุบันไม่ถูกต้อง",
  required_if: "กรุณากรอก:attribute",
  image: ":attributeต้องเป็นไฟล์รูปภาพ",
  mimes: ":attributeต้องเป็นไฟล์ชนิด :values",
  file: ":attributeต้องเป็นไฟล์",
  array: ":attributeไม่ถูกต้อง",
  distinct: ":attributeซ้ำกัน",
  uploaded: "อัปโหลด:attributeไม่สำเร็จ (ไฟล์อาจใหญ่เกินไป)",
  before_or_equal: ":attributeต้องไม่เกิน :date",
  after_or_equal: ":attributeต้องไม่ก่อน :date",
  min: { numeric: ":attributeต้องไม่น้อยกว่า :min", string: ":attributeต้องมีอย่างน้อย :min ตัวอักษร" },
  max: {
    numeric: ":attributeต้องไม่เกิน :max",
    string: ":attributeยาวเกิน :max ตัวอักษร",
    file: ":attributeต้องมีขนาดไม่เกิน :max KB",
    array: ":attributeได้ไม่เกิน :max รายการ",
  },
  password: {
    letters: ":attributeต้องมีตัวอักษรอย่างน้อย 1 ตัว",
    mixed: ":attributeต้องมีทั้งตัวพิมพ์ใหญ่และพิมพ์เล็ก",
    numbers: ":attributeต้องมีตัวเลขอย่างน้อย 1 ตัว",
    symbols: ":attributeต้องมีสัญลักษณ์อย่างน้อย 1 ตัว",
  },
};

/** ข้อความ en ตั้งต้นของ Laravel (vendor lang) — ใช้เป็น fallback ของภาษาไทยด้วยเหมือน Laravel */
const validationEn: ValidationMessages = {
  required: "The :attribute field is required.",
  string: "The :attribute field must be a string.",
  integer: "The :attribute field must be an integer.",
  numeric: "The :attribute field must be a number.",
  boolean: "The :attribute field must be true or false.",
  email: "The :attribute field must be a valid email address.",
  date: "The :attribute field must be a valid date.",
  regex: "The :attribute field format is invalid.",
  in: "The selected :attribute is invalid.",
  enum: "The selected :attribute is invalid.",
  not_in: "The selected :attribute is invalid.",
  exists: "The selected :attribute is invalid.",
  unique: "The :attribute has already been taken.",
  confirmed: "The :attribute field confirmation does not match.",
  current_password: "The password is incorrect.",
  different: "The :attribute field and :other must be different.",
  required_if: "The :attribute field is required when :other is :value.",
  image: "The :attribute field must be an image.",
  mimes: "The :attribute field must be a file of type: :values.",
  file: "The :attribute field must be a file.",
  array: "The :attribute field must be an array.",
  distinct: "The :attribute field has a duplicate value.",
  uploaded: "The :attribute failed to upload.",
  before_or_equal: "The :attribute field must be a date before or equal to :date.",
  after_or_equal: "The :attribute field must be a date after or equal to :date.",
  min: {
    numeric: "The :attribute field must be at least :min.",
    string: "The :attribute field must be at least :min characters.",
    file: "The :attribute field must be at least :min kilobytes.",
    array: "The :attribute field must have at least :min items.",
  },
  max: {
    numeric: "The :attribute field must not be greater than :max.",
    string: "The :attribute field must not be greater than :max characters.",
    file: "The :attribute field must not be greater than :max kilobytes.",
    array: "The :attribute field must not have more than :max items.",
  },
  password: {
    letters: "The :attribute field must contain at least one letter.",
    mixed: "The :attribute field must contain at least one uppercase and one lowercase letter.",
    numbers: "The :attribute field must contain at least one number.",
    symbols: "The :attribute field must contain at least one symbol.",
  },
};

/** ชื่อฟิลด์ภาษาไทย (lang/th/validation.php → attributes) — ภาษาอังกฤษใช้ชื่อ key แทน _ ด้วยช่องว่าง */
const attributesTh: Record<string, string> = {
  asset_tag: "เลขครุภัณฑ์", name: "ชื่อ", category: "หมวดหมู่", brand: "ยี่ห้อ", model: "รุ่น",
  serial_number: "Serial Number", status: "สถานะ", location_id: "สถานที่", custodian_id: "ผู้ถือครอง",
  purchase_date: "วันที่ซื้อ", purchase_cost: "มูลค่า", warranty_expires_at: "วันหมดประกัน", notes: "หมายเหตุ",
  movement_reason: "เหตุผลการโอนย้าย", moved_at: "วันที่โอนย้าย", reason: "เหตุผล", email: "อีเมล",
  password: "รหัสผ่าน", current_password: "รหัสผ่านปัจจุบัน", search: "คำค้นหา", code: "รหัส", type: "ประเภท",
  parent_id: "สถานที่แม่", address: "ที่อยู่", is_active: "สถานะการใช้งาน", role: "บทบาท", branch_id: "สาขา",
  department: "แผนก", division: "ฝ่าย", supervisor_id: "หัวหน้า", details: "รายละเอียด",
  due_date: "วันที่ต้องการให้แล้วเสร็จ", type_other: "เรื่องอื่นๆ", assignee_id: "เจ้าหน้าที่ IT",
  person_name_th: "ชื่อ-สกุล (ไทย)", person_name_en: "ชื่อ-สกุล (อังกฤษ)", device_name: "อุปกรณ์ที่ส่งซ่อม",
  symptom: "อาการเสีย", photos: "รูปภาพ", "photos.*": "รูปภาพ", documents: "เอกสารแนบ", "documents.*": "เอกสารแนบ",
  signature: "ลายเซ็น", comment: "ความเห็น", result: "ผลการดำเนินงาน", completed_on: "วันที่ดำเนินการแล้วเสร็จ",
  cannot_reason: "สาเหตุที่ดำเนินการไม่ได้", repair_method: "ลักษณะงานซ่อม", external_vendor: "บริษัทช่างภายนอก",
  warranty: "การรับประกัน", repair_details: "รายละเอียดการซ่อม", "parts.*.name": "ชื่ออะไหล่",
  "parts.*.quantity": "จำนวน", "parts.*.photo": "รูปอะไหล่", title: "ชื่อ", url: "URL / Host", username: "ชื่อผู้ใช้",
  vendor_name: "ชื่อ vendor", contract_no: "เลขที่สัญญา", start_date: "วันเริ่มสัญญา", end_date: "วันสิ้นสุดสัญญา",
  amount: "มูลค่าสัญญา", contact_email: "อีเมลผู้ติดต่อ", notify_days_before: "จำนวนวันแจ้งเตือนล่วงหน้า",
  "notify_emails.*": "อีเมลรับแจ้งเตือน", contract_notify_days: "แจ้งเตือนสัญญาล่วงหน้า",
  credential_notify_days: "แจ้งเตือนบัญชีล่วงหน้า", from: "วันที่เริ่มต้น", to: "วันที่สิ้นสุด",
  work_date: "วันที่ปฏิบัติงาน", user_id: "ผู้ใช้",
};

const EAM: Record<Locale, Eam> = { th: eamTh, en: eamEn };
const VALIDATION: Record<Locale, ValidationMessages> = { th: validationTh, en: validationEn };

/** __('eam.x.y', {count: 1}) */
export function trans(locale: Locale, key: string, replace: Record<string, string | number> = {}): string {
  const [ns, ...rest] = key.split(".");
  let node: unknown = ns === "eam" ? EAM[locale] : undefined;
  for (const part of rest) node = (node as Record<string, unknown> | undefined)?.[part];
  const text = typeof node === "string" ? node : key;
  return replaceParams(text, replace);
}

export function replaceParams(text: string, replace: Record<string, string | number>): string {
  return Object.entries(replace)
    .sort(([a], [b]) => b.length - a.length)
    .reduce((s, [k, v]) => s.replaceAll(`:${k}`, String(v)), text);
}

/** ข้อความ validation ตามกฎ (และชนิดข้อมูลสำหรับ min/max) — ภาษาไทยที่ไม่มี fallback เป็นอังกฤษเหมือน Laravel */
export function validationMessage(locale: Locale, rule: string, sizeType?: string): string {
  const pick = (dict: ValidationMessages) => {
    const [head, sub] = rule.split(".");
    const node = dict[head];
    if (typeof node === "string") return node;
    if (node && (sub || sizeType)) return node[sub ?? sizeType!];
    return undefined;
  };
  return pick(VALIDATION[locale]) ?? pick(validationEn) ?? `validation.${rule}`;
}

/** ชื่อฟิลด์สำหรับข้อความ — "photos.0" ใช้ชื่อของ "photos.*" */
export function attributeName(locale: Locale, key: string): string {
  if (locale === "th") {
    if (attributesTh[key]) return attributesTh[key];
    const wildcard = key.replace(/\.\d+(?=\.|$)/g, ".*");
    if (attributesTh[wildcard]) return attributesTh[wildcard];
  }
  return key.replaceAll("_", " ");
}
