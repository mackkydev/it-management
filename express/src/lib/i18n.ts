/**
 * ข้อความของ API (th/en) — เดิมคัดลอกจาก Laravel; ตอนนี้แก้ที่ไฟล์นี้ที่เดียว
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
  auth: { failed: "อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง" },
  /** login ผ่านระบบต้นทาง (API User) — failed ใช้กับทุกกรณี "รหัสผิด/ไม่มีผู้ใช้" (ไม่บอกว่ามี username หรือไม่) */
  api_auth: {
    failed: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    password_expired: "รหัสผ่านหมดอายุ กรุณาเปลี่ยนรหัสผ่านที่ระบบต้นทาง",
    locked: "บัญชีถูกล็อก กรุณาติดต่อผู้ดูแลระบบต้นทาง",
    disabled: "บัญชีนี้ถูกปิดใช้งาน",
    other: "เข้าสู่ระบบไม่สำเร็จ",
    unavailable: "ไม่สามารถเชื่อมต่อระบบต้นทางได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง",
    misconfigured: "การตั้งค่าการเชื่อมต่อไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ",
    connection_disabled: "ช่องทางเข้าสู่ระบบนี้ปิดใช้งานอยู่",
  },
  api_connection: {
    https_required: "ต้องเป็น URL แบบ https:// (ไม่มีชื่อผู้ใช้/รหัสผ่านใน URL)",
    invalid_path: "path ต้องขึ้นต้นด้วย / (อยู่ใต้ Base URL)",
    invalid_json_path: "รูปแบบ path ไม่ถูกต้อง (เช่น data.access_token)",
    invalid_host: "host / IP / CIDR ไม่ถูกต้อง",
    invalid_role: "บทบาทต้องเป็น manager หรือ viewer",
    managed_by_env: "การเชื่อมต่อนี้ตั้งค่าจากไฟล์ .env (API_CONN_SOURCE=env) — แก้ที่ไฟล์ .env แล้วเปิด Express ใหม่ หรือเปลี่ยนเป็น API_CONN_SOURCE=ui เพื่อแก้ในหน้านี้",
    role_synced: "บทบาทของผู้ใช้นี้อัปเดตตามรหัสจากต้นทาง (เช่น appIds) อัตโนมัติ — แก้ที่กฎ map บทบาทของการเชื่อมต่อ",
    invalid_rule: "กฎ map บทบาทไม่ถูกต้อง",
    invalid_error_map: "การ map error ไม่ถูกต้อง",
    secret_required: "กรุณากรอก secret สำหรับประเภทการยืนยันตัวตนนี้",
    in_use: "ลบไม่ได้ เพราะมีผู้ใช้จากการเชื่อมต่อนี้แล้ว — ให้ปิดใช้งานแทน",
    sync_not_configured: "ยังไม่ได้ตั้ง endpoint รายชื่อผู้ใช้",
    health_not_configured: "ยังไม่ได้ตั้ง endpoint ตรวจการเข้าถึง (เช่น /health)",
    health_blocked: "ถูกบล็อก — ต้องเป็น https และถ้าเป็น IP ภายในต้องใส่ในรายการ host ที่อนุญาต",
    health_unreachable: "เชื่อมต่อต้นทางไม่ได้ (ตรวจ URL / เครือข่าย / firewall)",
  },
  signature: {
    type: "ลายเซ็นต้องเป็นไฟล์ PNG หรือ JPG",
    size: "ลายเซ็นต้องมีขนาดไม่เกิน 1MB",
    empty: "ไม่พบลายเส้นในรูป กรุณาเซ็นใหม่",
    decode: "อ่านไฟล์รูปไม่ได้ กรุณาใช้ไฟล์อื่น",
  },
  org: {
    duplicate: "ชื่อนี้มีอยู่แล้ว",
    in_use: "ลบไม่ได้ เพราะมีผู้ใช้ :count คนอยู่ในรายการนี้ — ให้ปิดใช้งานแทน",
  },
  access: {
    invalid_override: "ค่าสิทธิ์ไม่ถูกต้อง",
    not_api_user: "ผู้ใช้นี้ไม่ใช่ API User",
    link_target_invalid: "เลือกบัญชีในระบบ (LOCAL) ที่จะผูก",
    link_admin: "ผูกกับบัญชีผู้ดูแลระบบ (super_admin) ได้เฉพาะผู้ดูแลระบบ และต้องเหลือผู้ดูแลระบบบัญชี LOCAL อย่างน้อย 1 คน",
    link_has_history: "API User นี้มีประวัติในระบบแล้ว จึงผูกบัญชีไม่ได้",
    api_no_password: "API User ไม่มีรหัสผ่านในระบบนี้ — เปลี่ยนรหัสผ่านที่ระบบต้นทาง",
    self_change: "แก้ตำแหน่ง/กลุ่ม/สิทธิ์ของตัวเองไม่ได้",
    target_super_admin: "แก้ไขบัญชีผู้ดูแลระบบ (super_admin) ได้เฉพาะผู้ดูแลระบบ",
    super_admin_only: "ตั้งตำแหน่งผู้ดูแลระบบ (super_admin) ได้เฉพาะผู้ดูแลระบบ",
    role_needs_assign: "เปลี่ยนตำแหน่งได้เฉพาะผู้มีสิทธิ์ \"มอบตำแหน่ง/กลุ่ม/สิทธิ์ให้ผู้ใช้\"",
    not_held: "มอบหรือถอดได้เฉพาะสิทธิ์ที่คุณมี — คุณไม่มีสิทธิ์: :items",
    locked: "สิทธิ์ :items สงวนไว้ให้ผู้ดูแลระบบ (super_admin) มอบ/ถอดเท่านั้น",
    last_super_admin: "ต้องมีผู้ดูแลระบบ (super_admin) บัญชี LOCAL ที่ใช้งานอยู่อย่างน้อย 1 คน (ใช้เข้าระบบเมื่อระบบต้นทางล่ม)",
    invalid_group: "กลุ่มสิทธิ์ไม่ถูกต้อง",
    invalid_date: "รูปแบบวันที่ไม่ถูกต้อง",
    expires_past: "วันหมดอายุต้องไม่ก่อนวันนี้",
    group_system: "ลบกลุ่มตามตำแหน่งไม่ได้ (เปลี่ยนชื่อได้)",
    group_name_taken: "มีกลุ่มชื่อนี้อยู่แล้ว",
  },
  branch: { in_use: "ลบไม่ได้ เพราะยังมีผู้ใช้หรือใบแจ้งงานในสาขานี้ — ให้ปิดใช้งานแทน" },
  ticket: { signature_invalid: "ลายเซ็นไม่ถูกต้อง กรุณาเซ็นใหม่" },
  vault: { invalid_category: "หมวดหมู่ต้องยาว 1–30 ตัวอักษร" },
  secret_guard: {
    ip_blocked: "เปิดดูข้อมูลลับได้เฉพาะจากเครือข่ายที่อนุญาต (IP ของคุณ: :ip)",
    reauth_required: "กรุณายืนยันรหัสผ่านของคุณก่อนเปิดดู",
    wrong_password: "รหัสผ่านไม่ถูกต้อง",
    pin_required: "กรุณากรอก PIN สำหรับเปิดดูรหัสผ่าน",
    pin_not_set: "ยังไม่ได้ตั้ง PIN กลาง — ติดต่อผู้ดูแลระบบหรือผู้มีสิทธิ์ตั้ง PIN",
    pin_locked: "กรอก PIN ผิดหลายครั้ง — ลองใหม่ได้ในอีก :minutes นาที",
    wrong_pin: "PIN ไม่ถูกต้อง (กรอกได้อีก :left ครั้ง)",
    pin_format: "PIN ต้องยาว 4–32 ตัว เป็นตัวอักษรหรือตัวเลขได้ ห้ามมีช่องว่าง",
    pin_mismatch: "ยืนยัน PIN ไม่ตรงกัน",
    not_supported: "บัญชีนี้ยืนยันรหัสผ่านซ้ำไม่ได้ — ติดต่อผู้ดูแลระบบให้ปิดการยืนยันตัวตนซ้ำ หรือใช้บัญชีในระบบ",
    ip_required: "เปิดจำกัด IP แล้ว — กรุณาระบุ IP หรือช่วง IP อย่างน้อย 1 รายการ",
    invalid_ip: "IP / ช่วง IP ไม่ถูกต้อง (เช่น 192.168.1.0/24)",
  },
  kpi: {
    future_date: "วันที่แจ้งต้องไม่เป็นวันในอนาคต",
    invalid_service_type: "กรุณาเลือกประเภทการแจ้งจากรายการ",
    invalid_complexity: "Complexity ต้องเป็น 0, 0.5 หรือ 1–8",
    completed_before: "วันที่แล้วเสร็จต้องไม่ก่อนวันที่แจ้ง",
    month_range: "เลือกช่วงไม่เกิน 24 เดือน",
  },
  announcement: { ends_before_starts: "วันสิ้นสุดต้องไม่ก่อนวันเริ่มแสดง" },
  license: {
    expires_before_start: "วันหมดอายุต้องไม่ก่อนวันเริ่มใช้งาน",
    not_license: "กรุณาเลือก license (สินทรัพย์หมวด Software ที่มีข้อมูล license)",
    device_required: "ระบุเครื่องที่ติดตั้ง — เลือกจากสินทรัพย์ หรือพิมพ์ชื่อเครื่อง",
    device_invalid: "ไม่พบเครื่องที่เลือกในทะเบียนสินทรัพย์",
    seats_full: "license นี้ติดตั้งครบ :seats เครื่องแล้ว — ถอนการติดตั้งเดิม หรือเพิ่มจำนวน seat ก่อน",
    seats_below_used: "จำนวน seat ต้องไม่น้อยกว่าที่ติดตั้งใช้งานอยู่ (:used เครื่อง)",
    already_removed: "รายการนี้ถอนการติดตั้งไปแล้ว",
    software_seats_full: ":name ติดตั้งครบ :seats เครื่องแล้ว — ถอนการติดตั้งเครื่องอื่น หรือเพิ่มจำนวน seat ก่อน",
  },
  approval: {
    steps_required: "ต้องมีอย่างน้อย 1 ขั้น",
    steps_max: "กำหนดได้ไม่เกิน 5 ขั้น",
    step_name: "กรุณากรอกชื่อขั้น",
    approvers_required: "เลือกผู้อนุมัติอย่างน้อย 1 คน",
    approvers_max: "ผู้อนุมัติไม่เกิน 20 คนต่อขั้น",
    approver_invalid: "ผู้อนุมัติต้องเป็นผู้ใช้ที่เปิดใช้งาน และไม่ซ้ำกันในขั้นเดียวกัน",
    duplicate_scope: "มีสายอนุมัติที่เปิดใช้งานสำหรับสาขาและแผนกนี้อยู่แล้ว",
    approver_not_allowed: "ผู้อนุมัติต้องอยู่สาขาที่เลือกและมีตำแหน่งสูงกว่าผู้แจ้ง",
  },
  asset_import: {
    sheet: "ทะเบียนคอมพิวเตอร์",
    help_sheet: "คำอธิบาย",
    help:
      "วิธีกรอกทะเบียนคอมพิวเตอร์|\n" +
      "1 แถว|เครื่องคอมพิวเตอร์ 1 ชุด — Host Name ต้องมีและไม่ซ้ำ (ใช้เป็นรหัสสินทรัพย์) ถ้ามีในระบบแล้วจะอัปเดตข้อมูลเดิม\n" +
      "Work Group|ใช้จับคู่สาขา — ตั้งค่า Work Group ของแต่ละสาขาที่ ข้อมูลหลัก → สาขา (ไม่ตรงสาขาใด = นำเข้าแต่ไม่ระบุสาขา)\n" +
      "วันที่|ใส่เป็นวันที่ของ Excel หรือพิมพ์ วว/ดด/ปปปป — ปี พ.ศ. หรือ ค.ศ. ก็ได้\n" +
      "Computer Type|เช่น Desktop, Laptop, All-in-One\n" +
      "ช่องที่ไม่มีข้อมูล|เว้นว่าง หรือใส่ - ได้\n" +
      "Department / ชื่อ-สกุลผู้ใช้งาน|เก็บเป็นข้อความไปก่อน (ภายหลังเชื่อมกับผู้ใช้จากระบบต้นทาง)\n" +
      "OS / Office / Anti Virus|ชื่อตรงกับ License ในระบบ (ชื่อหรือเลขครุภัณฑ์ของสินทรัพย์ Software ไม่สนตัวพิมพ์) = ผูกเป็นการติดตั้งและนับ seat — ไม่ตรง หรือ seat เต็ม = เก็บเป็นข้อความและแจ้งเตือน\n" +
      "Software อื่นๆ|ใส่ได้หลายรายการ คั่นด้วยขึ้นบรรทัดใหม่ (Alt+Enter) หรือ , — จับคู่กับ License แบบเดียวกับ OS (เว้นว่าง = ถอน Software อื่นๆ ที่ผูกไว้ออก)\n" +
      "ไฟล์เดิม|ไฟล์ที่ไม่มีบางคอลัมน์ (เช่น Software อื่นๆ) นำเข้าได้ — คอลัมน์ที่ไม่มีในไฟล์จะไม่แก้ข้อมูลเดิม\n" +
      "ส่งออก Excel|ไฟล์ที่ส่งออกจากหน้าสินทรัพย์ใช้คอลัมน์เดียวกัน แก้แล้วนำกลับเข้ามาได้ทันที\n" +
      "ถ้ามีแถวที่ผิด|ระบบจะไม่นำเข้าเลยทั้งไฟล์ และแจ้งแถวที่ต้องแก้ทั้งหมด",
    unreadable: "อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel (.xlsx)",
    no_header: "ไม่พบหัวตาราง — แถวหัวตารางต้องมีคอลัมน์ Host Name (ดาวน์โหลด template)",
    empty: "ไม่มีข้อมูลในไฟล์",
    host_required: "ไม่มี Host Name",
    host_invalid: "Host Name \":value\" ใช้ได้เฉพาะ A-Z, 0-9, - _ / และยาวไม่เกิน 50 ตัว",
    host_duplicate: "Host Name \":value\" ซ้ำกับแถวที่ :row",
    host_deleted: "Host Name \":value\" เป็นสินทรัพย์ที่ถูกลบไปแล้ว",
    host_other_category: "Host Name \":value\" ซ้ำกับรหัสสินทรัพย์หมวดอื่น",
    date_invalid: "รูปแบบวันที่ในคอลัมน์ \":column\" ไม่ถูกต้อง",
    too_long: "คอลัมน์ \":column\" ยาวเกิน :max ตัวอักษร",
    branch_not_found: "Work Group \":value\" ไม่ตรงกับสาขาใด — นำเข้าโดยไม่ระบุสาขา",
    license_not_found: ":column \":value\" ไม่ตรงกับ License ในระบบ — เก็บเป็นข้อความ (ยังไม่นับ seat)",
    license_seats_full: ":column \":value\" ติดตั้งครบ :seats เครื่องแล้ว — เก็บเป็นข้อความ (ยังไม่นับ seat)",
    failed: "นำเข้าไม่สำเร็จ — แก้ไขแถวที่แจ้งแล้วนำเข้าใหม่ (ยังไม่มีข้อมูลใดถูกบันทึก)",
  },
  expiring: {
    subject: "แจ้งเตือน: รายการใกล้หมดอายุ :count รายการ",
    greeting: "เรียน ฝ่าย IT",
    intro: "รายการต่อไปนี้ใกล้หมดอายุหรือหมดอายุแล้ว กรุณาตรวจสอบและดำเนินการต่ออายุ",
    type: { contract: "สัญญา", credential: "บัญชี/รหัสผ่าน", license: "Software license" },
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
  auth: { failed: "Invalid e-mail/username or password." },
  api_auth: {
    failed: "Invalid username or password.",
    password_expired: "Your password has expired. Please change it in the source system.",
    locked: "This account is locked. Please contact the source system administrator.",
    disabled: "This account has been disabled.",
    other: "Sign-in failed.",
    unavailable: "The source system is unavailable right now. Please try again.",
    misconfigured: "The connection is misconfigured. Please contact the administrator.",
    connection_disabled: "This sign-in method is disabled.",
  },
  api_connection: {
    https_required: "Must be an https:// URL (no username/password in the URL).",
    invalid_path: "The path must start with / (under the base URL).",
    invalid_json_path: "Invalid path format (e.g. data.access_token).",
    invalid_host: "Invalid host / IP / CIDR.",
    invalid_role: "The role must be manager or viewer.",
    managed_by_env: "This connection is set in the .env file (API_CONN_SOURCE=env) — edit .env and restart Express, or switch to API_CONN_SOURCE=ui to edit it here.",
    role_synced: "This user's role follows the upstream code (e.g. appIds) automatically — change the connection's role mapping instead.",
    invalid_rule: "Invalid role mapping rule.",
    invalid_error_map: "Invalid error mapping.",
    secret_required: "Please enter the secret for this authentication type.",
    in_use: "Cannot delete: users already belong to this connection. Disable it instead.",
    sync_not_configured: "The user list endpoint is not set.",
    health_not_configured: "The health-check endpoint (e.g. /health) is not set.",
    health_blocked: "Blocked — must be https, and internal IPs must be in the allowed hosts.",
    health_unreachable: "Cannot reach the source (check the URL / network / firewall).",
  },
  signature: {
    type: "The signature must be a PNG or JPG file.",
    size: "The signature must be 1MB or smaller.",
    empty: "No signature strokes found. Please sign again.",
    decode: "The image could not be read. Please use another file.",
  },
  org: {
    duplicate: "This name already exists.",
    in_use: "Cannot delete: :count user(s) still use it. Deactivate it instead.",
  },
  access: {
    invalid_override: "Invalid permission value.",
    not_api_user: "This user is not an API user.",
    link_target_invalid: "Choose a system (LOCAL) account to link.",
    link_admin: "Only super admins can link a super admin account, and at least one LOCAL super admin must remain.",
    link_has_history: "This API user already has history and cannot be linked.",
    api_no_password: "API users have no password in this system. Change it in the source system.",
    self_change: "You cannot change your own role, groups or permissions.",
    target_super_admin: "Only super admins can change a super admin account.",
    super_admin_only: "Only super admins can assign the super admin role.",
    role_needs_assign: "Changing roles requires the \"Assign roles / groups / permissions\" permission.",
    not_held: "You can only grant or remove permissions you hold — missing: :items",
    locked: ":items is reserved: only super admins can grant or remove it.",
    last_super_admin: "At least one active LOCAL super admin is required (to sign in when the source system is down).",
    invalid_group: "Invalid permission group.",
    invalid_date: "Invalid date.",
    expires_past: "The expiry date cannot be in the past.",
    group_system: "Role groups cannot be deleted (they can be renamed).",
    group_name_taken: "A group with this name already exists.",
  },
  branch: { in_use: "Cannot delete: users or tickets still belong to this branch. Deactivate it instead." },
  ticket: { signature_invalid: "Invalid signature. Please sign again." },
  vault: { invalid_category: "The category must be 1–30 characters." },
  secret_guard: {
    ip_blocked: "Secrets can only be viewed from allowed networks (your IP: :ip).",
    reauth_required: "Please confirm your password before viewing.",
    wrong_password: "The password is incorrect.",
    pin_required: "Please enter the PIN to view secrets.",
    pin_not_set: "The shared PIN has not been set — contact an administrator.",
    pin_locked: "Too many wrong PIN attempts — try again in :minutes minutes.",
    wrong_pin: "Incorrect PIN (:left attempts left).",
    pin_format: "The PIN must be 4–32 characters (letters or digits) without spaces.",
    pin_mismatch: "The PIN confirmation does not match.",
    not_supported: "This account cannot confirm its password — ask an administrator to turn off re-authentication or use a local account.",
    ip_required: "IP restriction is on — enter at least one IP or IP range.",
    invalid_ip: "Invalid IP / IP range (e.g. 192.168.1.0/24).",
  },
  kpi: {
    future_date: "The request date cannot be in the future.",
    invalid_service_type: "Please choose a service type from the list.",
    invalid_complexity: "Complexity must be 0, 0.5 or 1–8.",
    completed_before: "The completion date cannot be before the request date.",
    month_range: "Choose a range of at most 24 months.",
  },
  announcement: { ends_before_starts: "The end date cannot be before the start date." },
  license: {
    expires_before_start: "The expiry date cannot be before the start date.",
    not_license: "Please choose a license (a Software asset with license details).",
    device_required: "Specify the machine — pick an asset or type the machine name.",
    device_invalid: "The selected machine was not found in the asset register.",
    seats_full: "All :seats seats of this license are in use. Uninstall one or add seats first.",
    seats_below_used: "Seats cannot be fewer than the installations in use (:used).",
    already_removed: "This installation has already been removed.",
    software_seats_full: "All :seats seats of :name are in use. Uninstall it elsewhere or add seats first.",
  },
  approval: {
    steps_required: "Add at least one step.",
    steps_max: "No more than 5 steps.",
    step_name: "Enter a step name.",
    approvers_required: "Select at least one approver.",
    approvers_max: "No more than 20 approvers per step.",
    approver_invalid: "Approvers must be active users and must not repeat within a step.",
    duplicate_scope: "An active approval route already exists for this branch and department.",
    approver_not_allowed: "The approver must be in the selected branch and hold a higher position than the requester.",
  },
  asset_import: {
    sheet: "Computers",
    help_sheet: "Instructions",
    help:
      "How to fill in the computer register|\n" +
      "1 row|One computer — Host Name is required and unique (used as the asset code); an existing Host Name is updated\n" +
      "Work Group|Matches the branch — set each branch's Work Group under Master data → Branches (no match = imported without a branch)\n" +
      "Dates|Excel dates or dd/mm/yyyy — Buddhist or Gregorian years\n" +
      "Computer Type|e.g. Desktop, Laptop, All-in-One\n" +
      "Empty values|Leave blank or enter -\n" +
      "Department / user name|Stored as text for now (to be linked to users from the source system)\n" +
      "OS / Office / Anti Virus|A value matching a license in the system (name or asset code of a Software asset, case-insensitive) is linked as an installation and uses a seat — no match or no free seat = kept as text with a warning\n" +
      "Other software|Several items separated by line breaks (Alt+Enter) or commas — matched like OS (empty = linked other software is removed)\n" +
      "Older files|Files missing some columns (e.g. Other software) can be imported — missing columns leave existing data unchanged\n" +
      "Excel export|Files exported from the Assets page use the same columns and can be edited and imported back\n" +
      "If any row is invalid|Nothing is imported and every row to fix is listed",
    unreadable: "The file cannot be read — it must be an Excel file (.xlsx).",
    no_header: "No header row found — it must include a Host Name column (download the template).",
    empty: "The file has no data.",
    host_required: "Host Name is missing.",
    host_invalid: "Host Name \":value\" may only contain A-Z, 0-9, - _ / and be at most 50 characters.",
    host_duplicate: "Host Name \":value\" duplicates row :row.",
    host_deleted: "Host Name \":value\" belongs to a deleted asset.",
    host_other_category: "Host Name \":value\" is already the code of an asset in another category.",
    date_invalid: "Invalid date in column \":column\".",
    too_long: "Column \":column\" is longer than :max characters.",
    branch_not_found: "Work Group \":value\" matches no branch — imported without a branch.",
    license_not_found: ":column \":value\" matches no license in the system — kept as text (no seat used).",
    license_seats_full: ":column \":value\" already uses all :seats seats — kept as text (no seat used).",
    failed: "Import failed — fix the listed rows and import again (nothing was saved).",
  },
  expiring: {
    subject: "Reminder: :count item(s) expiring soon",
    greeting: "Dear IT team,",
    intro: "The following items are expiring soon or have expired. Please review and renew them.",
    type: { contract: "Contract", credential: "Account/password", license: "Software license" },
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
  due_date: "วันที่ต้องการให้แล้วเสร็จ", type_other: "เรื่องอื่นๆ", assignee_id: "เจ้าหน้าที่ IT", approver_id: "ผู้อนุมัติ",
  person_name_th: "ชื่อ-สกุล (ไทย)", person_name_en: "ชื่อ-สกุล (อังกฤษ)", device_name: "อุปกรณ์ที่ส่งซ่อม",
  symptom: "อาการเสีย", photos: "รูปภาพ", "photos.*": "รูปภาพ", documents: "เอกสารแนบ", "documents.*": "เอกสารแนบ",
  logo: "โลโก้", connection_id: "ช่องทางเข้าสู่ระบบ", base_url: "Base URL", login_path: "Login endpoint",
  signature: "ลายเซ็น", comment: "ความเห็น", result: "ผลการดำเนินงาน", completed_on: "วันที่ดำเนินการแล้วเสร็จ",
  cannot_reason: "สาเหตุที่ดำเนินการไม่ได้", repair_method: "ลักษณะงานซ่อม", external_vendor: "บริษัทช่างภายนอก",
  warranty: "การรับประกัน", repair_details: "รายละเอียดการซ่อม", "parts.*.name": "ชื่ออะไหล่",
  "parts.*.quantity": "จำนวน", "parts.*.photo": "รูปอะไหล่", title: "ชื่อ", url: "URL / Host", username: "ชื่อผู้ใช้",
  vendor_name: "ชื่อ vendor", contract_no: "เลขที่สัญญา", start_date: "วันเริ่มสัญญา", end_date: "วันสิ้นสุดสัญญา",
  amount: "มูลค่าสัญญา", contact_email: "อีเมลผู้ติดต่อ", notify_days_before: "จำนวนวันแจ้งเตือนล่วงหน้า",
  "notify_emails.*": "อีเมลรับแจ้งเตือน", contract_notify_days: "แจ้งเตือนสัญญาล่วงหน้า",
  credential_notify_days: "แจ้งเตือนบัญชีล่วงหน้า", license_notify_days: "แจ้งเตือน license ล่วงหน้า", from: "วันที่เริ่มต้น", to: "วันที่สิ้นสุด",
  work_date: "วันที่ปฏิบัติงาน", user_id: "ผู้ใช้", approval_route_id: "สายอนุมัติ", steps: "ขั้นอนุมัติ",
  user_name: "ชื่อ-สกุลผู้ใช้งาน", received_date: "วันที่รับเข้า", start_use_date: "วันที่เริ่มใช้งาน", work_group: "Work Group",
  mac_address: "MAC Address", computer_type: "Computer Type", ip_address: "IP", os: "OS", office: "Office", email_365: "Email 365",
  antivirus: "Anti Virus", notebook_tag: "เลขที่ทรัพย์สิน Notebook", cpu_tag: "เลขที่ทรัพย์สิน CPU", monitor_tag: "เลขที่ทรัพย์สิน Monitor", other_software: "Software อื่นๆ", file: "ไฟล์",
  license: "ข้อมูล license", "license.billing": "ประเภทการซื้อ", "license.start_date": "วันเริ่มใช้งาน", "license.expires_at": "วันหมดอายุ",
  "license.seats": "จำนวน seat", "license.vendor": "ผู้ขาย", "license.license_key": "license key", "license.notify_days_before": "แจ้งเตือนล่วงหน้า",
  files: "ไฟล์", "files.*": "ไฟล์", field: "ช่องข้อมูล", q: "คำค้นหา",
  license_id: "license", device_asset_id: "เครื่อง (สินทรัพย์)", installed_at: "วันที่ติดตั้ง",
  uninstalled_at: "วันที่ถอนการติดตั้ง", body: "รายละเอียด", level: "ระดับ", starts_on: "วันเริ่มแสดง", ends_on: "วันสิ้นสุด",
  sort_order: "ลำดับ",
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
