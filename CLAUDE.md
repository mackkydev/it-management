# IT-SYSTEM — กฎการพัฒนา (Claude Code)

ระบบงานฝ่าย IT (ใบแจ้งงาน IT, คลังบัญชี/รหัสผ่าน, สัญญา vendor, สินทรัพย์ IT):
**Next.js 16 (App Router) + Express.js 5 API + MySQL 8.4** — รันบน Docker (`docker compose up -d`)
- Container: `it_express` (8020, API + scheduler), `it_mysql` (3308, db `it_system`, user `it_app`), `it_phpmyadmin` (8082), `it_adminer` (8081)
- หน้าเว็บบนเครื่องจริง = container `it_frontend` (profile `web`: `docker compose --profile web up -d --build`, `frontend/Dockerfile` แบบ Next.js standalone เมื่อ `NEXT_OUTPUT=standalone`) — เครื่องพัฒนาใช้ `npm run dev` ตามเดิม
- ฐานเดิมเก็บเป็นสำรอง ไม่ใช้งานแล้ว: PostgreSQL (profile `legacy-postgres`, volume `it-system_it_pg` — ย้ายมา MySQL 2026-10-05), MariaDB (profile `legacy-mariadb`, volume `it-system_it_db`)
- ชื่อภายในเดิมที่ตั้งใจคงไว้: cookie `eam_*`, prefix ข้อความ `eam.*`, `EAM_TOKEN_TTL_MINUTES`
- **ตั้งแต่ 2026-10-04 ใช้ Express อย่างเดียว** — ถอด Laravel (`backend/`, `it_api`) ออกแล้ว (ดูโค้ดเดิมจาก git history) ห้ามสร้างกลับมา
- ไฟล์แนบ/ลายเซ็น/ไฟล์ license อยู่ที่ `storage/private` (mount เป็น `/data/private` ใน container, ไม่ขึ้น git — ต้องสำรองแยก)
- ผู้ใช้ 2 แบบ (`users.type`): `LOCAL` (ผู้ใช้เดิมทั้งหมด, login อีเมล+รหัสผ่าน) / `API` (ผู้ใช้จาก REST API ต้นทาง — ไม่เก็บรหัสผ่าน, `connection_id`+`external_id`) — CHECK ใน DB บังคับ; rollback ด้วยมือ: `prisma/migrations/20261004120000_add_api_users_and_permissions/down.sql`
- ตำแหน่ง (`users.role`): `super_admin` (ผู้ดูแลระบบสูงสุด) > `admin` (ผู้ดูแลระบบ) > `division_manager` > `manager` > `viewer` — ผู้ใช้ LOCAL และ API เป็นได้ทุกตำแหน่ง (ตำแหน่ง `it_staff` เลิกใช้ ตั้งแต่ migration `20261012090000_permission_groups`)

## ทั่วไป
- ตอบผู้ใช้เป็นภาษาไทย; โค้ด/ชื่อตัวแปรเป็นภาษาอังกฤษ
- แก้เฉพาะขอบเขตที่ขอ + ไฟล์ที่เกี่ยวข้องโดยตรง; ปัญหานอกขอบเขตให้รายงาน ไม่แก้เอง
- ไฟล์ที่มีภาษาไทย ห้ามใช้ PowerShell `Get-Content`/`Set-Content` แก้ไข — ใช้ Read/Edit/Write
- หลังแก้ ต้องผ่าน: `npm test` + `npx tsc --noEmit` (ใน `express/`), `npm run lint`, `npx tsc --noEmit`, `npm run build` (ใน `frontend/`)

## การถามผู้ใช้ (ลดการรอคำตอบ)
- เรื่องที่มีทางเลือก "แนะนำ" ชัดเจนและย้อนกลับได้ (ชื่อ, รูปแบบ UI, ค่าเริ่มต้น, โครงสร้างโค้ด) → **เลือกตัวที่แนะนำแล้วทำต่อทันที ไม่ต้องถาม** แล้วแจ้งในสรุปว่าเลือกอะไร
- ถามและรอคำตอบเฉพาะเรื่องที่ย้อนกลับยากหรือกระทบภายนอก: ลบข้อมูลจริง, push/deploy, เปลี่ยน secret/สิทธิ์, ค่าใช้จ่าย, ความกำกวมที่ทำให้งานผิดทั้งหมด
- (Claude หยุดรอเมื่อถามคำถาม — ไม่มีการนับเวลาแล้วเลือกเอง จึงต้องเลี่ยงการถามตั้งแต่แรกตามกฎข้อบน)

## งานค้าง / ทำงานต่ออัตโนมัติ
- คิวงานค้างอยู่ที่ `.claude/pending-work.md` — งานตั้งเวลา `it-system-resume-pending-work` (ทุก 1 ชม. ขณะเปิดแอป Claude) ทำต่อทีละรายการ
- ถ้างานยังไม่เสร็จแล้วต้องหยุด (เช่น ใกล้ชน limit โควตา, รอผู้ใช้ตอบ) ให้เขียนสิ่งที่เหลือเป็น `- [ ]` ในคิวก่อนจบ
  พร้อมรายละเอียดครบในตัว (ไฟล์ที่เกี่ยวข้อง, ทำถึงไหนแล้ว, เกณฑ์ว่าเสร็จ) — รอบตั้งเวลาไม่เห็นบทสนทนาเดิม
- รอบที่รันจากการตั้งเวลา: ไม่มี `- [ ]` → จบทันที; ห้าม commit/push/deploy/ลบข้อมูลจริง; สิ่งที่ต้องให้ผู้ใช้ตัดสินใจ → ทำเครื่องหมาย `- [!]` แล้วข้าม

## สิทธิ์ (permission) — ตรวจที่ API
- รายการสิทธิ์อยู่ที่ `express/src/models/permission.ts` (`PERMISSIONS`: key, `module` + `action` = ตำแหน่งในตาราง ระบบงาน × การกระทำ (ดู/เพิ่ม/แก้ไข/ลบ/อนุมัติ/จัดการ/อื่นๆ), ชื่อ th/en, `defaults` = กลุ่มที่ได้ตอนสร้าง key, `from` = key เดิมที่แยกออกมา, `locked` = สงวนไว้ให้ super_admin มอบ/ถอด)
- กลุ่มสิทธิ์ (`permission_groups`): กลุ่มตามตำแหน่ง (`is_system`, ลบไม่ได้) + กลุ่มที่สร้างเอง (กลุ่มฝ่าย IT เดิม `it_staff` / `it_head` ถูกยุบใน migration `20261013090000` — หัวหน้า IT → `super_admin`, เจ้าหน้าที่ IT → `admin`) — สิทธิ์ของกลุ่มอยู่ที่ `role_permissions` (role = key กลุ่ม)
  สิทธิ์จริง = สิทธิ์ของกลุ่มตามตำแหน่ง + กลุ่มที่มอบเพิ่มรายคน (`user_groups`, หลายกลุ่ม) + allow − deny รายคน (`user_permissions`) — โค้ดกลาง `express/src/services/permissions.ts`
- วันหมดอายุ: `user_groups.expires_on` / `user_permissions.expires_on` (ใช้ได้ถึงวันนั้น เวลาไทย) มีผลเมื่อเปิดสวิตช์ `app_settings.permission_expiry` เท่านั้น
- ช่อง `is_it_staff` / `is_it_head` = **หน้าที่ในใบแจ้งงาน** (เลือกผู้รับงาน/ผู้ปิดงาน/ผู้รับแจ้งเตือน) ไม่ให้สิทธิ์ — สิทธิ์ฝ่าย IT มาจากตำแหน่ง/กลุ่ม; รายชื่อผู้ดำเนินการ (`IT_STAFF_WHERE`) = ฝ่าย/แผนก IT หรือ เทคโนโลยีสารสนเทศ + ผู้ที่ติ๊กช่อง
- ข้อมูลหลักแผนก/ฝ่าย (`routes/org-units.ts`): แผนกผูกกับฝ่ายได้ (`departments.division_id`, ไม่บังคับ, ลบฝ่าย = แผนกหลุดเป็น NULL) — `GET /departments?division_id=` กรองตามฝ่าย; ฝ่ายส่ง `department_ids` (แผนกในฝ่าย) ได้ และ GET ฝ่ายคืน `departments`; นำเข้า/template Excel `/org-units/import(-template)` (แผ่นฝ่าย + แผ่นแผนก, จับคู่ด้วยชื่อ ไม่ลบ/ไม่เปลี่ยนชื่อ); `users.department` / `users.division` ยังเป็นข้อความอิสระเหมือนเดิม
- สถานที่สังกัดสาขาได้ (`locations.branch_id`, ไม่บังคับ — resource คืน `branch`)
- ชื่อเมนูแก้ได้ที่หน้า `/permissions` (ปุ่มดินสอ — ต้องกรอกทั้งไทยและอังกฤษ): `app_settings.menu_labels` `{ "<group id | /href>": { th, en } }` ผ่าน `PUT /settings` (access.manage) → `navFor` ใส่ `text` ให้ กลุ่ม/รายการ แสดงด้วย `navLabel()` (ไม่มี = ชื่อจากไฟล์แปล `nav.*`) — ไม่เปลี่ยนหัวข้อของหน้า และไม่เปลี่ยนชื่อระบบงานในตารางสิทธิ์ (`/role-permissions` ใช้ MODULES จาก API)
- เมนู "ฝ่ายและแผนก" = หน้าเดียว `/org-units?tab=divisions|departments` (`/divisions`, `/departments` redirect มาที่แท็บ) ใช้ `components/org-unit-manager.tsx`
- เมนู "ข้อมูล Drop Down" `/dropdowns?tab=` (แท็บตามสิทธิ์): หมวดหมู่สัญญา (`contracts.categories`) / หมวดหมู่คลังบัญชี / Computer Type / ยี่ห้อ (`dropdowns.manage` — ตาราง `dropdown_options` list = vault_category|computer_type|brand, ค่าที่เลือกเก็บเป็นข้อความใน credentials.category / assets.computer_type / assets.brand, เปลี่ยนชื่อ = อัปเดตข้อมูลเดิมตาม, `routes/dropdown-options.ts`) / ตัวเลือกเรื่อง "อื่นๆ" (`settings.manage`, app_settings.ticket_other_types) — `/contract-categories`, `/ticket-types` redirect มาที่แท็บ
- ช่องเลือกจากข้อมูล Drop Down ในฟอร์มใช้ `<OptionPicker>` (`components/option-picker.tsx` — พิมพ์ค้นหา + "+ เพิ่ม" ทันทีผ่าน `app/actions/dropdowns.ts`); เพิ่มด่วนได้ด้วยสิทธิ์เพิ่ม/แก้ของระบบนั้น (assets.* / vault.* / contracts.*) แต่แก้/ลบต้องมีสิทธิ์จัดการ; ตารางใหม่ต้องใช้ `COLLATE utf8mb4_0900_as_ci` ตามฐาน
- หมวดตั้งต้น (แก้/ลบไม่ได้) ใช้ร่วมกันระหว่างคลังบัญชีและสัญญา: `BUILTIN_CATEGORIES` ใน `express/src/services/categories.ts` (credentials.category เก็บ key, `contract_categories.builtin_key`) — ชื่อแสดงผลแปลที่ frontend `vault.categories.<key>`, หมวดที่เพิ่มเองตั้งชื่อซ้ำหมวดตั้งต้นไม่ได้ (`isBuiltinName`)
- หมวดหมู่สัญญา (`contract_categories`, `contracts.category_id` ไม่บังคับ) — `routes/contract-categories.ts`, สิทธิ์ `contracts.categories` (from `contracts.update`), หน้า `/contract-categories` ใช้ `OrgUnitManager` (table `contract_categories`); `GET /contracts?branch_id=&category_id=`
- ตรวจสิทธิ์ด้วย `can(user, "key")` (Express — middleware auth โหลด `user.perms` ทุก request) / `has(user, "key")` (frontend จาก `/auth/me.permissions`, กลุ่มจาก `/auth/me.groups`) **ห้ามเช็ค role/flag ตรงๆ เพื่อให้สิทธิ์**
- super_admin ผ่านทุกสิทธิ์ (`isSuperAdmin`); หน้าการเชื่อมต่อ API = super_admin **บัญชี LOCAL** เท่านั้น (`isLocalSuperAdmin`) และต้องมี super_admin บัญชี LOCAL ที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ (ทางสำรองเมื่อต้นทางล่ม)
- กติกาการมอบ (`express/src/services/access-control.ts`): มอบ/ถอดได้เฉพาะสิทธิ์ที่ตัวเองมี (`access.assign`), สิทธิ์ `locked` เฉพาะ super_admin, แก้ของตัวเองไม่ได้, แตะบัญชี super_admin / ตั้ง super_admin ได้เฉพาะ super_admin; เปลี่ยนตำแหน่ง = มอบสิทธิ์ (หน้าผู้ใช้ก็ใช้กติกานี้)
  ตารางสิทธิ์ของกลุ่ม / สร้าง-ลบกลุ่ม / การมองเห็นเมนู / สวิตช์วันหมดอายุ = `access.manage` (locked)
- ทุกการเปลี่ยนสิทธิ์ (ตำแหน่ง/กลุ่ม/รายข้อ/ตารางกลุ่ม) และ PIN กลาง → `audit_logs` + แจ้งเตือนในระบบไปยัง super_admin + admin ทุกคน (`notifyAccessChange`)
- เพิ่มสิทธิ์ใหม่: เพิ่มใน `PERMISSIONS` พร้อม `module`/`action`/`defaults` — `ensurePermissions()` (ตอน start server / seed / เทสต์) สร้าง key ใหม่ + สิทธิ์ตั้งต้น **ไม่แตะ key เดิมและการกำหนดสิทธิ์ที่ admin ปรับไว้**; แยก key เดิม = ใส่ `from` (คัดลอกการกำหนดสิทธิ์ของ key เดิมทั้งกลุ่มและรายคน)
- การเลือกผู้รับแจ้งเตือน (notify-expiring, `adminRecipients`) ไม่ใช่การตรวจสิทธิ์ — คงไว้ตามเดิม (role `super_admin` + `admin` = ผู้ดูแลระบบ); ยกเว้นใบแจ้งงาน: ผู้รับแจ้งเตือน "รอให้ทำ" = ผู้เกี่ยวข้องโดยตรงที่มีสิทธิ์จริง (`usersWithPermissions()` ใน services/permissions.ts ∩ เจ้าหน้าที่/หัวหน้า IT) เงื่อนไขเดียวกับตัวเลขเมนู

## API User (login ผ่าน REST API ต้นทาง)
- โค้ดกลาง: `express/src/services/api-auth.ts` (login / JIT / session), `upstream-http.ts` (เรียกต้นทาง: https เท่านั้น, กัน SSRF + allowlist, จำกัด redirect/ขนาด), `audit.ts`
- ห้ามเก็บ/ log รหัสผ่านหรือ token ของต้นทาง — token เก็บเข้ารหัสใน `external_sessions` ผูกกับ token ของเรา; อ่านค่าจาก response ด้วย `readPath` (dot path) เท่านั้น
- จากต้นทางใช้แค่ข้อมูลผู้ใช้ (ชื่อ/อีเมล/สาขา/แผนก) + ตำแหน่ง — **สิทธิ์ (กลุ่ม/รายข้อ) กำหนดในโปรแกรม IT เท่านั้น**
- JIT ครั้งถัดไป (login / ตรวจซ้ำ / directory sync) อัปเดตชื่อ/อีเมล + ตำแหน่งตามต้นทางเมื่อตั้ง `field_map.role_code` (audit `api_user.role_synced`; แก้ตำแหน่งรายคนไม่ได้ → 422 ยกเว้นตั้ง/ถอด `super_admin`/`admin` ซึ่งการซิงก์ไม่ทับ — `ADMIN_ROLES`) — ห้ามทับกลุ่ม / สิทธิ์รายคน / it_staff / it_head / สถานะ / ลายเซ็น; อีเมลซ้ำ → เว้นว่าง + audit `api_user.email_conflict` (ผู้มี `access.assign` ผูกบัญชีเองที่ `/api-users`)
- เทสต์ใช้ upstream จำลอง `setUpstreamTestHooks()` — ห้ามออกเน็ตจริงในเทสต์
- ต้นทางจริง = STEC SyteLine API (คู่มือ STEC API Portal): login → `{ token, expiresAt }`, ตรวจซ้ำด้วย `GET /api/v1/auth/permissions` (`{ appIds }`), logout, `/health`
  ไม่มีโปรไฟล์/รายชื่อผู้ใช้/refresh → field_map ใช้ `$login` (ชื่อผู้ใช้ที่ login) เป็นรหัส/ชื่อ (ชื่อนี้ไม่เขียนทับชื่อที่ admin แก้), role จาก array `appIds` (ตรงกฎแรก)
  ค่าตามคู่มือใส่ด้วยปุ่ม "ตั้งค่าตามคู่มือ STEC" ในฟอร์ม — เทสต์ที่ `express/tests/stec-api.test.ts`
- ตั้งจาก `.env` ได้ (`API_CONN_*`, `services/env-connection.ts` เรียกตอนเปิด server): `API_CONN_SOURCE=ui` (ค่าเริ่มต้น) = สร้างครั้งเดียวถ้ายังไม่มีชื่อ `API_CONN_NAME` แล้วหน้าเว็บจัดการ / `env` = สร้าง-อัปเดตแถวเดิม (ตามชื่อ) ทุกครั้งที่เปิด และล็อก (`managed_by_env`, PUT/DELETE → 422) — ตรวจด้วยกฎเดียวกับหน้าเว็บ (`connectionRowFromInput`) เทสต์ที่ `express/tests/env-connection.test.ts`
- ทุกการเปลี่ยนสิทธิ์/การตั้งค่า/การผูกบัญชีต้องลง `audit_logs` (ใช้ `audit()` — ตัด key ที่เป็น secret ให้อัตโนมัติ)

## ลายเซ็น (user_signatures)
- โค้ดกลาง `express/src/services/signatures.ts`: ตรวจชนิดจากเนื้อไฟล์ → sharp (crop ขอบ, กว้าง ≤ 600px, PNG ใหม่ไม่มี metadata) → เก็บเข้ารหัส (`lib/file-crypt.ts`) ที่ `signatures/{user}/{uuid}.png.enc`
- ลายเซ็นใหม่ = อันเดิม `is_active=false` (ห้ามลบแถว/ไฟล์); ไฟล์ต้นฉบับส่งให้เจ้าของเท่านั้น — ใบแจ้งงานเก็บสำเนาของตัวเอง (`copySignatureTo` + audit `signature.used`)
- ใช้ลายเซ็นคนอื่นต้องมีสิทธิ์ `signature.use`; ทุกการอัปโหลด/เปลี่ยน/ลบ/นำไปใช้ลง `audit_logs`; JIT ของ API User ห้ามแตะลายเซ็น
- `users.signature_path` เป็นคอลัมน์เดิม (ไม่ใช้แล้ว — คงไว้ตามกฎ additive)

## สิทธิ์การมองเห็นเมนู/ปุ่ม (หน้า ตั้งค่าระบบ → สิทธิ์การใช้งาน `/permissions` — แยกจากสิทธิ์ตามกลุ่ม `/role-permissions`)
- ตั้งค่าเก็บใน `app_settings`: `ui_permissions` (key → key กลุ่มสิทธิ์ที่ซ่อน — แก้ได้เฉพาะ `access.manage`) และ `menu_order` — โค้ดกลางอยู่ที่ `frontend/src/lib/permissions.ts`
- key เมนู = `href` ของเมนูใน `components/shell/nav.ts`, key ปุ่ม = `btn:<หน้า>:<ปุ่ม>` (**ห้ามมีจุด** — validator ของ API ใช้จุดแยก path)
- เพิ่มเมนูใหม่: ใส่ใน `NAV` พร้อม `visible` ตาม permission key แล้วจะขึ้นในหน้าสิทธิ์อัตโนมัติ; เพิ่มปุ่มใหม่: เพิ่มใน `BUTTONS` (ระบุ `page` = ชื่อเมนูของหน้า — หน้าสิทธิ์จัดกลุ่มตามนี้ เรียงตามลำดับในรายการ) แล้วครอบปุ่มด้วย `(await getAccess())("btn:...")` — ปุ่มใน client component ส่งเป็น prop (เช่น `canBook`, `canAddEvent`) ให้ซ่อนทางลัดที่ทำสิ่งเดียวกันด้วย (คลิกขวา / ดับเบิลคลิก / คลิกช่องว่าง)
- เป็นการซ่อนเพิ่มจากสิทธิ์เดิมเท่านั้น — สิทธิ์จริงต้องตรวจที่ API เสมอ
- ค่าซ่อนเดิมถูกแปลงเป็นการถอดสิทธิ์จริงครั้งเดียว (`convertHiddenMenus` ใน `services/permissions.ts`, flag `ui_permissions_v3`, สำเนา `ui_permissions_converted`) — ซ่อนใหม่หลังจากนั้นเป็นการซ่อนปกติ
- เมนู "รอฉันอนุมัติ" แสดงตาม `can_approve` จาก `/auth/me`; ช่อง "ทุกคนทำได้เสมอ" ในตารางสิทธิ์ (แจ้ง/แก้/ลบใบแจ้งงานของตัวเอง) = ช่องติ๊กล็อก — `ALWAYS` ใน `components/permission-matrix.tsx` (ต้องตรงกับ `ticket-workflow.ts`)
## สายอนุมัติใบแจ้งงาน (หน้า ตั้งค่าระบบ → สายอนุมัติ)
- โค้ดกลาง: `express/src/services/approval-routes.ts` (ลำดับจับคู่: รายบุคคล → สาขา+แผนก → สาขา → แผนก → ตั้งต้น → ระบบเดิม `supervisor_id`)
- ตอนแจ้งงานคัดลอกสายเป็น snapshot ใน `it_ticket_approval_steps` — แก้/ลบสายไม่กระทบใบเดิม; สถานะยังเป็น `pending_supervisor` ทุกขั้น + `it_tickets.current_step`
- โหลด TicketRow ใน Express ต้องมี `TICKET_APPROVAL_COLUMNS` (ใช้ใน `canApprove`/`canView`) — ใบที่ไม่มี snapshot ใช้กติกาเดิม (`approver_id`)

## วันที่ / หมวดสินทรัพย์
- วันที่แสดงและกรอกเป็น **dd/MM/yyyy** (ไทย = พ.ศ., อังกฤษ = ค.ศ.) — แสดงผลใช้ `fmt.date/dateTime`, ช่องกรอกใช้ `<DateInput>` (`components/date-input.tsx` — พิมพ์ได้ + ปฏิทินป๊อปอัปในตัว) **ห้ามใช้ `<input type="date">` หรือสร้าง date picker เอง**; API ยังรับส่ง `YYYY-MM-DD`
- Dropdown ทุกที่ใช้ `<AppSelect>` (`components/app-select.tsx` — รายการลอย ตัวที่เลือกพื้นจาง + เครื่องหมายถูก, คีย์บอร์ด, ค้นหาเมื่อรายการ > 8) **ห้ามใช้ `<select>` ตรงๆ หรือสร้าง dropdown เอง**; ใส่ `<option>` เป็น children หรือส่ง `options` ได้, `onChange` รับ handler เดิมของ `<select>` ได้, ฟอร์ม GET ใช้ `name` + `defaultValue` (ส่งค่าผ่าน hidden input); กล่องลอยใหม่ใช้ `useFloating`/`useDismiss` จาก `components/floating.ts`
- ปุ่มส่งออก Excel ใช้ `<ConfirmDownload>` (`components/confirm-download.tsx` — ถามยืนยันก่อนดาวน์โหลด) และการนำเข้า Excel ต้องถาม `confirm(t("common.confirmImport", …))` ก่อนอัปโหลด — **ยกเว้นลิงก์ไฟล์ template ใช้ `<a>` ปกติ**
- กล่องยืนยัน/แจ้งเตือนใช้ `useConfirm()` / `useAlert()` (`components/dialog-provider.tsx` — `if (!(await confirm(msg))) return;`) **ห้ามใช้ `window.confirm` / `alert` / `prompt`**; ช่องรหัสผ่านใช้ `<PasswordInput>` (`components/password-input.tsx` — มีปุ่มกดดูรหัส) **ห้ามใช้ `<input type="password">` ตรงๆ**
- ใบแจ้งงาน: ฝ่าย IT (และเจ้าหน้าที่ที่ผู้แจ้งเลือก) เห็น/ได้แจ้งเตือนหลังหัวหน้าอนุมัติแล้วเท่านั้น (`PRE_APPROVAL` ใน `express/src/services/ticket-workflow.ts`)
- เมนูงานฝ่าย IT: "คิวงานของฉัน" `/it/tickets` (scope `it_mine` = `itMineWhere()` ใน routes/tickets.ts: เฉพาะใบที่ฉันเป็นผู้รับงาน `assignee_id` — ผู้แจ้งเลือก/โอนมา/รับแล้ว) / "คิวงาน IT" `/it/queue` (scope `it` ทุกใบหลังอนุมัติ)
  ตัวเลขเมนู: `/it/tickets` = ใบของฉันที่รอรับ/กำลังทำ/รอยืนยันยกเลิก, `/it/queue` = ใบที่ยังไม่มีผู้รับ (acceptors) + รออนุมัติผล (closers) — ตรงกับผู้รับแจ้งเตือน
  โอนงาน (ยังไม่รับ) `POST /tickets/:uuid/forward { assignee_id, comment }` (`canForward` = `canAccept`) → event `forwarded` (แจ้งผู้รับคนใหม่ + ผู้แจ้ง, ปิด "approved" ของคนเดิม); รับงานแทนผู้ที่ถูกเลือก = สิทธิ์ `it_tickets.take_over` (ไทม์ไลน์ "รับงานแทน …", detail `take_over_from`) — ผู้ถูกเลือกเดิมหลุดจากเมนู/KPI เพราะนับตาม `assignee_id`
- อนุมัติใบของตัวเอง = สิทธิ์ `tickets.approve_own` (ตั้งต้น ผู้จัดการขึ้นไป — `canApprove`) อนุมัติได้ทุกขั้น จากปุ่มในหน้าใบงาน — ไม่นับในรายการ/ตัวเลข "รอฉันอนุมัติ" (`approvalsWhere`)
- ตัวเลขเมนู (`GET /menu-badges`) = งานที่รอฉันทำ ↔ กระดิ่ง = เหตุการณ์ใหม่: ทั้งสองฝั่งนับ/แจ้ง **เฉพาะผู้ที่เกี่ยวข้องโดยตรง** และใช้ฟังก์ชันเดียวกัน (`acceptors` = เจ้าหน้าที่ IT ตาม `IT_STAFF_WHERE` ที่รับงานได้, `closers` = หัวหน้า IT (`is_it_head`) ที่ปิดงานได้ — ไม่มีเลยใช้ผู้มีสิทธิ์ปิดงานทั้งหมด, `approvers` ใน ticket-workflow) — ผู้ดูแลระบบสูงสุดที่ไม่ได้อยู่ฝ่าย IT ไม่ได้ทั้งตัวเลขเมนูและกระดิ่ง (ยังเปิดดูคิวงานได้ตามสิทธิ์)
  เปิดดูใบงาน/ใบลา (`GET /tickets/:uuid`, `GET /leave/:uuid`) = แจ้งเตือนของเรื่องนั้นของผู้ดูอ่านแล้ว; เหตุการณ์ถัดไปปิดแจ้งเตือนที่จบแล้วของทุกคนตาม `RESOLVES` (`markNoticesRead`) — อ่านที่กระดิ่งไม่ลดตัวเลขเมนู (งานยังรออยู่); "งานของฉันที่กำลังทำ" และ KPI มีแค่ตัวเลขเมนู ไม่มีแจ้งเตือน
- การติดตั้ง license (`license_installations`): นับ seat จากรายการที่ `uninstalled_at` เป็น null — บันทึกเกิน `asset_licenses.seats` ไม่ได้ และลด seats ต่ำกว่าที่ใช้อยู่ไม่ได้
- หมวด `COMPUTER` = ทะเบียนคอมพิวเตอร์ตาม Excel ของฝ่าย IT: `asset_tag` = Host Name, ข้อมูลเครื่องอยู่ในคอลัมน์ของ `assets` (department, user_name, ip_address, os, office ฯลฯ)
  นำเข้า/template/ส่งออก ที่ `express/src/services/asset-import.ts` (Host Name เดิม = อัปเดต, ผิดแม้แถวเดียว = ไม่บันทึกเลย, คอลัมน์ที่ไม่มีในไฟล์ = ไม่แก้ข้อมูลเดิม)
  คอลัมน์ตามฟอร์ม (`IMPORT_COLUMNS`): สาขา (ชื่อ/รหัส ก่อน `branches.work_group`), สถานที่ (ไม่มี = สร้าง LOC-#### ผ่าน `services/locations.ts`), ผู้ถือครอง (ชื่อ/อีเมล → บันทึกการโอนย้าย), สถานะ, วันที่ซื้อ/มูลค่า/ประกัน — `legacy` (Email 365) อ่านได้แต่ไม่อยู่ใน template/ส่งออก; เพิ่มคอลัมน์ = แก้ `SHEET_HEADERS` ใน `tests/asset-import.test.ts` ด้วย
  department / user_name / os / office เป็นข้อความชั่วคราว — ภายหลังผูกกับผู้ใช้จาก API และการติดตั้ง license
- หมวดสินทรัพย์กำหนดฟอร์มเพิ่มเติมที่ `CATEGORY_FORM` (`frontend/src/lib/types.ts`) — `SOFTWARE` = ข้อมูล license (`asset_licenses`, key เข้ารหัส APP_KEY) + ไฟล์ (`asset_files`) และรวมในการแจ้งเตือนหมดอายุ
- ประวัติผู้ใช้งาน (ชื่อ-สกุล/Department ของทะเบียนคอมพิวเตอร์) = `asset_user_logs` ผ่าน `recordUserChange()`; ประวัติการซ่อม = ใบงาน type repair ผูกด้วย asset_id หรือเลขครุภัณฑ์ (`services/asset-repairs.ts`)

## ความปลอดภัยก่อนขึ้นระบบจริง (คู่มือ `deploy/README.md`)
- `npm run security:check` (ใน `express/`, prod: `security:check:prod`) — ตรวจบัญชี `@example.com` / รหัสผ่าน seed / super_admin LOCAL จริง / 2FA ผู้ดูแลระบบ / รหัสผ่านฐานข้อมูลตั้งต้น / NODE_ENV ฯลฯ — มี FAIL = exit 1
- **2FA (TOTP)** เฉพาะผู้ใช้ LOCAL: `express/src/services/two-factor.ts` (RFC 6238 เขียนเอง + QR ด้วย `qrcode`), คอลัมน์ `users.two_factor_*` (secret เข้ารหัส APP_KEY, recovery codes = SHA-256 ใช้ครั้งเดียว, `two_factor_last_step` กันใช้รหัสซ้ำ)
  login: `POST /auth/login` คืน `{ two_factor: "verify"|"setup", challenge }` (ใบผ่าน 5 นาที ลงลายมือ APP_KEY) แทน token → `POST /auth/login/2fa(/setup)`; หน้าเว็บเก็บ challenge ใน httpOnly cookie `eam_2fa` (`app/actions/auth.ts`)
  บังคับผู้ดูแลระบบ = `app_settings.two_factor_required` (แก้ด้วย `access.manage`), รีเซ็ตให้ผู้อื่น `DELETE /users/:id/2fa` (access.manage — ตัดทุก session), โปรไฟล์ `/auth/2fa*` — **userResource ห้ามส่ง two_factor_secret / recovery codes**
- CSP แบบ nonce ต่อ request อยู่ที่ `frontend/src/proxy.ts` (style อนุญาต inline เพราะใช้ style attribute) — สคริปต์ inline ต้องใส่ `nonce` จาก header `x-nonce` (ดู `app/layout.tsx`); HSTS ใน `next.config.ts` (production)
- reverse proxy ต้องเขียนทับ `X-Real-IP` / `X-Forwarded-For` (`deploy/Caddyfile`); สำรองข้อมูลแบบเข้ารหัส `deploy/backup.sh` (ค่าใน `deploy/backup.env` ไม่ขึ้น git)
- library: express ใช้ `overrides` บังคับ mysql2 / deepmerge-ts / uuid เวอร์ชันที่ไม่มีช่องโหว่ (ติดมากับ prisma / exceljs) — ก่อน deploy `npm audit --omit=dev` ต้องไม่มี high

## เปิดดูข้อมูลลับ (รหัสผ่านคลังบัญชี / License key)
- ทุก endpoint ที่ถอดรหัสส่งให้ผู้ใช้ต้องเรียก `assertCanReveal(req)` + `notifyReveal()` (`express/src/services/secret-guard.ts`) และบันทึกประวัติทุกครั้ง
- คลังบัญชีเข้ารหัสด้วย**กุญแจคลัง** `VAULT_KEY_FILE` / `VAULT_KEY` แยกจาก APP_KEY (`services/vault-crypto.ts` — อ่านด้วยกุญแจคลังก่อน ไม่ผ่านจึงลอง APP_KEY ของข้อมูลเดิม; ไม่ตั้ง = APP_KEY) — ย้ายข้อมูลเดิม `npm run vault:rekey` (`cli/vault-key.ts`, สร้างกุญแจ `vault:keygen`), เครื่องจริง mount ไฟล์ด้วย `deploy/docker-compose.vault.yml` (ไม่อยู่ในไฟล์สำรอง — กุญแจหาย = เปิดคลังไม่ได้); license key / 2FA / token ต้นทาง ยังใช้ APP_KEY
- สิทธิ์รายรายการ: `credentials.access_mode` = all (ทุกคนที่มี vault.view — ค่าเดิม) / restricted = ผู้ใช้-กลุ่มใน `credential_access` + เจ้าของ + ผู้สร้าง + `vault.all` (ตั้งต้นไม่ให้ใคร, super_admin ผ่าน) — `accessWhere()` ใน routes/it-data.ts ใช้ทุก endpoint (ไม่มีสิทธิ์ = 404 / ไม่อยู่ในรายการ), กันล็อกตัวเองออก (422 `access_self`), เปลี่ยนการเข้าถึง → audit `credential.access_updated`
- ยืนยันตัวตนซ้ำ `reauth_minutes` = 0 → ต้องยืนยันทุกครั้งที่เปิดดู (ใช้การยืนยันได้ครั้งเดียวภายใน 2 นาที); คัดลอกรหัสผ่าน / license key ใช้ `copySecret()` (`frontend/src/lib/clipboard.ts` — ล้าง clipboard ใน 30 วินาที)
- สวิตช์ใน `app_settings.secret_guard` (หน้าตั้งค่าระบบ): ยืนยันตัวตนซ้ำ (428 → `POST /auth/reauth`, เก็บ `personal_access_tokens.reauth_at`) ด้วยรหัสผ่าน login หรือ PIN กลาง (`reauth_method`), จำกัด IP, แจ้งเตือนในระบบ (กระดิ่ง ไม่ใช่อีเมล) เมื่อมีคนเปิดดู — ผู้รับ = `notify_user_ids` ที่เลือกในหน้าตั้งค่า / ไม่เลือก = หัวหน้า IT ทุกคน (`revealRecipients`)
- PIN กลางอันเดียว: `app_settings.secret_pin` (bcrypt — ห้ามส่ง hash ออก API, `settingsJson` ตัดออก) ตั้งที่ `PUT /secret-pin` (สิทธิ์ `secrets.pin_manage` — ตั้งต้น admin + รหัสผ่าน login ผู้ตั้ง, แจ้งเตือน super_admin + admin ทุกครั้ง); ผิด 5 ครั้ง = ล็อกคนนั้น 15 นาที (`users.secret_pin_failures` / `secret_pin_locked_until`)
- IP ผู้ใช้: frontend ส่ง `X-Forwarded-For` ใน `apiFetch` — เชื่อถือได้เมื่อมี reverse proxy เขียนทับ header หน้า Next.js

## KPI ฝ่าย IT (หน้า /kpi — ตามไฟล์ Template-KPI-IT-2569-Part2-Details)
- ชีตรายเดือนต่อเจ้าหน้าที่ 1 คน = ใบงานที่ผู้จัดการ IT อนุมัติผลแล้ว (`KPI_TICKET_STATUSES` = รอผู้แจ้งรับงาน/เสร็จสิ้น — กำลังทำ/รออนุมัติผล/ส่งกลับแก้ไข ยังไม่ขึ้น และ `PUT /kpi/tickets/:uuid` = 422 `not_approved`, ตัวเลขเมนู /kpi ใช้เงื่อนไขเดียวกัน; เดือนตาม**วันที่แจ้ง**เวลาไทย) + แถวกรอกเอง + วันหยุด — `express/src/services/kpi.ts`
- แถวใบงาน: ข้อมูลอ่านจากใบงานจริงเสมอ, `kpi_entries` (ticket_id + user_id, unique คู่กัน) เก็บแค่ service_type + complexity **แยกต่อคน**; Mark = ตาราง `MARKS` (สูตร IF ของคอลัมน์ I ในไฟล์)
- ผู้ร่วมดำเนินการ (`it_ticket_helpers`): ผู้รับงานเลือกเจ้าหน้าที่ IT (`IT_STAFF_WHERE`) ตอนรับงาน (`helper_ids`) หรือแก้ภายหลัง `PUT /tickets/:uuid/helpers` → แจ้งเตือนคนที่เพิ่มใหม่ (event `helper_added`), เห็นใบงาน (`canView`) และได้แถวใบงานในชีต KPI ของตัวเอง (`PUT /kpi/tickets/:uuid` ส่ง `user_id` = เจ้าของชีต)
- Export `/kpi/export` (`services/kpi-export.ts`): ชีต ServiceType + ชีตละเดือน (`Oct68`), Cordia New 14, สูตร Mark/Total จริง, วันหยุดรวมเซลล์ B:G — เปลี่ยนรูปแบบต้องเทียบกับไฟล์ต้นฉบับ

## ซอฟต์แวร์บนเครื่องคอมพิวเตอร์ (ฟอร์มสินทรัพย์)
- OS / Office / Anti Virus / Software อื่นๆ เลือกจากสินทรัพย์ Software ที่มี license → `license_installations` ของเครื่อง (`slot` = os/office/antivirus, NULL = อื่นๆ) — `express/src/services/asset-software.ts`
- ส่ง `software` มา = sync (ใหม่ติดตั้งวันนี้ + ตรวจ seat, เอาออก = uninstalled_at วันนี้); ไม่ส่ง = ไม่แตะ; ช่องที่ผูกแล้ว API เขียนชื่อ license ลง `assets.os/office/antivirus` (ค่าจาก Excel ที่ยังไม่ผูกคงไว้)

## ปฏิทิน / การลา / วันหยุดบริษัท (เมนู "ปฏิทินและการลา")
- API: `express/src/routes/calendar.ts` + `services/calendar.ts` — ตาราง `leave_requests`, `leave_files`, `leave_quota_overrides`, `calendar_events` (type `onsite` จากใบแจ้งงาน / `event` กิจกรรม), `company_holidays`, `users.calendar_token`
- ปฏิทินวันหยุดแยกชุดตามประกาศ HR (`holiday_calendars` — ตอนนี้ "กรุงเทพ" = สำนักงานใหญ่ HR-040 / "สาขา" = สำนักงานโรงงาน HR-041 ชุดตั้งต้น): `company_holidays.calendar_id` (unique ชุด+วัน), สาขาเลือกชุดที่ `branches.holiday_calendar_id` (NULL = ชุดตั้งต้น) — `holidayCalendarFor(branchId)` ใช้ทุกที่ที่นับวันหยุด (วันลา, ปฏิทินตามสาขาผู้ดู/สาขาที่เลือก, KPI ตามสาขาเจ้าของชีต); ไฟล์นำเข้า/template = วันที่ | ชื่อ | ปฏิทินวันหยุด (dropdown) เติมวันหยุดของปีนั้นไว้แล้ว
- หน้า `/holidays`: แท็บตามชุด เปิดที่ชุดของสาขาผู้ใช้; ทุกคนดูรายการวันหยุดได้ — เพิ่ม/แก้/นำเข้า, ตั้งค่าการลา, โควตา เฉพาะ `holidays.manage` (มอบให้กลุ่ม HR ได้); ปฏิทินเลือกซ่อน/แสดงแต่ละประเภท (เช่น วันหยุด) จำไว้ใน localStorage ของเครื่อง
- กิจกรรม (`calendar_events` type event) ติ๊ก "ไม่รวมเสาร์-อาทิตย์" ได้เมื่อช่วงวันคร่อมสุดสัปดาห์ (`skip_weekends`) — `calendarItems` แตกเป็นแถบช่วงวันธรรมดา (`weekdayRuns`, id `event-<id>-<n>`, มี `range` = ช่วงเต็มไว้แก้ไข) iCal ก็แยกตาม; ใบลา: เหตุผลบังคับกรอก
- งานหน้างานจากใบแจ้งงาน: ชื่อแถบ = ผู้รับงาน + ผู้ร่วมดำเนินการทุกคน, แสดงตามขอบเขตของผู้รับงานหรือผู้ร่วมคนใดคนหนึ่ง, `busyOf` นับผู้ร่วมว่าออกหน้างานด้วย
- ขอบเขตการมองเห็นต่อกลุ่ม ตั้งแยก 2 ชุด: `app_settings.calendar_scope` (กิจกรรม/งานหน้างาน) และ `leave_scope` (วันลาของคนอื่น — ไม่เกินขอบเขตปฏิทินที่เลือกดู) — ค่า all > branch > department > self (ไม่ตั้ง = department, super_admin = all), `scopeSettings(kind)` / `maxScope(u, kind)` ใน services/calendar.ts — ตั้งที่ส่วนท้ายหน้า `/role-permissions` (access.manage); ในตารางสิทธิ์ "การลา" เป็นระบบงาน (module `leave`) แยกจาก "ปฏิทินและวันหยุด"
- ใบลา: ผู้อนุมัติ (`approverOptions` ใน routes/calendar.ts) = ผู้ที่ตำแหน่งสูงกว่าในแผนกเดียวกันหรือฝ่ายเดียวกัน (`users.division` หรือฝ่ายที่แผนกสังกัด) ไม่มี → ตามสายอนุมัติ (`planFor`: ขั้นแรกที่มีผู้อนุมัติ / หัวหน้าตามสาย); จำนวนวัน = วันทำงานตาม `leave_settings.work_days` ไม่นับวันหยุดบริษัท; โควตา `leave_settings.quotas` + รายคน; ลาป่วย ≥ `sick_cert_days` ต้องแนบไฟล์
- ลาที่อนุมัติแล้ว + วันหยุดบริษัท = แถววันหยุดอ่านอย่างเดียวในชีต KPI (`calendarRows` ใน `services/kpi.ts`)
- ใบแจ้งงาน: รับงานส่ง `calendar: {start_on,end_on,note}` ได้, `PUT/DELETE /tickets/:uuid/calendar` (ผู้รับงาน); iCal ส่วนตัว = `/ical/{token}.ics` (frontend route สาธารณะ → `GET /calendar/feed/:token`)
- พิมพ์ใบลา A4 = `/leave-print/{uuid}` (นอก app shell)

## ห้องประชุม (เมนู "ห้องประชุม")
- API: `express/src/routes/meeting-rooms.ts` — ตาราง `meeting_rooms` (`seats` JSON `[{label,count}]`), `meeting_room_images` (≤ 4 รูป ≤ 1MB, sharp → WebP ไม่มี metadata, `is_primary`), `meeting_bookings` (วันเดียว: `booking_date` + `start_time`/`end_time` "HH:MM", status confirmed|cancelled, ลบ = `deleted_at`), `meeting_booking_equipment`
- ห้อง + ช่วงเวลาซ้อนกัน = 422 (ตรวจใน transaction + `lockNamed` ต่อห้อง/วัน; ต่อกันพอดีขอบเวลาได้); ผู้จอง + แผนก = ผู้ที่ login (แผนกเก็บตามตอนจอง); จบเวลาแล้วแก้/ยกเลิก/ลบไม่ได้ (เก็บเป็นประวัติ)
- ทุกคนดูปฏิทินห้อง / จอง / แก้-ยกเลิก-ลบของตัวเอง (`ALWAYS` ในตารางสิทธิ์) — `meeting.manage_any` = จัดการของคนอื่น (แจ้งเตือนเจ้าของ kind `meeting`), `meeting.rooms` = จัดการห้อง + ตัวเลือก
- ประเภทการใช้งาน / อุปกรณ์ = `dropdown_options` list `meeting_purpose` / `meeting_equipment` (แท็บในหน้า `/dropdowns`, สิทธิ์ต่อรายการผ่าน `manage` ใน `LISTS` ของ `routes/dropdown-options.ts`)
- หน้า: `/meeting-rooms` (ปฏิทินเดือน) → `/meeting-rooms/day/{date}` (ไทม์ไลน์แถวละห้อง) / `/meeting-rooms/book?date=&room=&start=&end=` / `/meeting-rooms/bookings/{uuid}/edit` / `/meeting-rooms/mine` / `/meeting-rooms/rooms` — รูปห้องผ่าน `/files/meeting-rooms/{id}/images/{imageId}`

## จองรถ (เมนู "จองรถ")
- API: `express/src/routes/vehicles.ts` — ตาราง `vehicles` (`mileage` = เลขไมล์ล่าสุด), `vehicle_images` (≤ 4 รูป ผ่าน `services/photos.ts` เดียวกับห้องประชุม), `vehicle_bookings` (หลายวันได้: `start_on`+`start_time` ถึง `end_on`+`end_time` "HH:MM" เวลาไทย, `vehicle_id` NULL = รอผู้จัดคิวรถเลือกรถ, `start_mileage`/`end_mileage`), `vehicle_booking_extras`
- รถคันเดียวกันช่วงเวลาซ้อน = 422 (transaction + `lockNamed` ต่อคัน) — ไม่ระบุรถไม่ตรวจชน; ไม่กรอกเลขไมล์เริ่มต้น = เลขไมล์ล่าสุดของคัน (ตอนจอง/เปลี่ยนรถ/ผู้จัดคิวเลือกรถ); บันทึกเลขไมล์ที่มากกว่าเดิม → `vehicles.mileage` ขยับตาม (`bumpMileage`); บันทึกเลขไมล์ได้แม้ใช้งานจบแล้ว (`PUT /vehicle-bookings/:uuid/mileage`)
- สิทธิ์: ทุกคนดู / จอง / แก้-ยกเลิก-ลบ / บันทึกเลขไมล์ของตัวเอง (`ALWAYS`), `vehicle.dispatch` = ผู้จัดคิวรถ (เลือกรถ `PUT /vehicle-bookings/:uuid/vehicle` + จัดการการจองของคนอื่น), `vehicle.manage` = จัดการรถ + ตัวเลือก
- แจ้งเตือน kind `vehicle`: จองโดยไม่ระบุรถ → `requested` ถึงผู้มี `vehicle.dispatch` (`usersWithPermissions`) = เงื่อนไขเดียวกับตัวเลขเมนู `/vehicles/dispatch` (`unassignedVehicleBookings`); มีรถแล้ว/ยกเลิก/ลบ → `markNoticesRead("vehicle_booking_id", …, { events: ["requested"] })`; ผู้จัดคิวทำกับการจองของคนอื่น → แจ้งเจ้าของ (assigned/updated/cancelled/deleted)
- ประเภทการใช้งาน / รายการเพิ่มเติม / ประเภทรถ / เชื้อเพลิง = `dropdown_options` list `vehicle_purpose` / `vehicle_extra` / `vehicle_type` / `vehicle_fuel` (แท็บ `/dropdowns`, สิทธิ์ `vehicle.manage`) — ประเภทรถ/เชื้อเพลิงเก็บเป็นข้อความใน `vehicles.vehicle_type` / `fuel_type`
- ย้ายรถไปสาขาอื่น = `POST /vehicles/:id/transfer` (ประวัติ `vehicle_transfers`, `GET /vehicles/:id/transfers`) — แก้สาขาที่ `PUT /vehicles/:id` ไม่ได้ (422 `branch_locked`); การจองที่ยังไม่ถึงคงไว้ (ตอบ `upcoming_bookings` ให้หน้าเว็บเตือน); หน้าแก้ไขรถมีแผง `vehicle-transfer.tsx`
- หน้า: `/vehicles` (ปฏิทินเดือน) → `/vehicles/day/{date}` (ไทม์ไลน์ 00–24 แถวละคัน + แถวรอจัดรถ) / `/vehicles/book?date=&vehicle=&start=&end=` / `/vehicles/bookings/{uuid}/edit` / `/vehicles/mine` / `/vehicles/dispatch` / `/vehicles/manage` (+ ประวัติเลขไมล์ในหน้าแก้ไขรถ) — ส่วนกลางของระบบจองที่ `frontend/src/lib/booking.ts`

## ยืมอุปกรณ์ IT (เมนู "ยืมอุปกรณ์ IT")
- API: `express/src/routes/loans.ts` — ตาราง `equipment_loans` (หลายวันได้ `start_on`+`start_time` ถึง `end_on`+`end_time` เวลาไทย); อุปกรณ์ = สินทรัพย์ไม่ถูกลบ สถานะ active/in_storage ที่ผู้ถือครองเป็นเจ้าหน้าที่ IT (`DEVICE_WHERE` ใช้ `IT_STAFF_WHERE`) — ไม่มีตารางอุปกรณ์แยก
- สถานะ: `reserved` (จอง รอรับ) → `on_loan` (ส่งมอบแล้ว) → `returned` / `cancelled` — ห้ามลบ (ประวัติ); อุปกรณ์เดียวกันช่วงซ้อน (reserved/on_loan) = 422 (transaction + `lockNamed`); ส่งมอบไม่ได้ถ้าอุปกรณ์ยังไม่คืนจากการยืมก่อน
- สิทธิ์: ทุกคนดูปฏิทิน / จอง / แก้-ยกเลิกของตัวเองก่อนส่งมอบ (`ALWAYS` module `loans`); `loans.manage` = ส่งมอบ / รับคืน (+ หมายเหตุสภาพ) / จัดการของคนอื่น (แจ้งเจ้าของ)
- แจ้งเตือน kind `loan`: จอง → `requested` ถึงผู้มี `loans.manage`; ส่งมอบ/รับคืน → ปิด `requested`/`overdue`; **เกินกำหนดคืน** (`OVERDUE` = on_loan เลยวันเวลาคืน) → `overdue` ถึงผู้ยืม + ผู้จัดการ วันละครั้ง (`notifyOverdueLoans`, scheduler ตรวจทุกชั่วโมง, `overdue_notified_on`)
- ตัวเลขเมนู (`loanBadges`): `/loans/mine` = ของฉันที่เกินกำหนด, `/loans/manage` = รอส่งมอบที่ถึงวันแล้ว + เกินกำหนด
- หน้า: `/loans` (ปฏิทินเดือน — แถบสีตามสถานะ, คลิกวัน = จอง, คลิกรายการ = `loan-dialog.tsx`) / `/loans/book?date=&device=` / `/loans/{uuid}/edit` / `/loans/mine` / `/loans/manage`

## ห้องประชุม / รถ ตามสาขา (ขอบเขตต่อกลุ่ม)
- `app_settings.booking_scope` = `{ meeting: { group: "branch"|"all" }, vehicle: { … } }` ตั้งที่ส่วนท้ายหน้า `/role-permissions` (`GET/PUT /booking-scope`, access.manage) — ไม่ตั้ง = ทุกสาขา (เหมือนก่อนมีการตั้งค่า), ได้ขอบเขตกว้างสุดของทุกกลุ่ม, super_admin = all — โค้ดกลาง `express/src/services/booking-scope.ts`
- `branch` = เห็น/จองห้อง-รถของสาขาตัวเอง + ที่ใช้ร่วมกัน (`branch_id` NULL); จัดการ (เพิ่ม/แก้ห้อง-รถ, `meeting.manage_any`, จัดคิวรถ) ได้เฉพาะสาขาตัวเอง — ของที่ใช้ร่วมกันจัดการได้เฉพาะขอบเขต all (`canSeeBranch` / `canManageBranch` / `branchWhere`); นอกขอบเขต = 404, resource คืน `can_manage`
- การจองรถเก็บสาขาที่ขอใช้ `vehicle_bookings.branch_id` (เลือกรถ = สาขาของรถ, ไม่เลือก = สาขาที่เลือกดู/สาขาผู้จอง) → แจ้งเตือน `requested` / ตัวเลขเมนู / รายการจัดคิว = ผู้จัดคิวของสาขานั้น + ขอบเขต all (`dispatchersFor` = `managesWhere` เงื่อนไขเดียวกัน)
- หน้าเว็บ: ขอบเขต all เลือกดูสาขาด้วย `<BranchFilter>` (`components/branch-filter.tsx`, จำใน cookie `eam_branch_meeting` / `eam_branch_vehicle`, ไม่ตั้ง = สาขาของผู้ใช้) — server อ่านผ่าน `selectedBranch()` / `branchQuery()` ใน `frontend/src/lib/booking-scope.ts` (หน้าและ server action ใช้ค่าเดียวกัน); ฟอร์มเพิ่มห้อง/รถใช้ `branchChoices()` (ตั้งต้น = สาขาผู้เพิ่ม)

## เวอร์ชันโปรแกรม (หน้า /about)
- แหล่งเดียว: `frontend/src/lib/changelog.ts` — ระหว่างพัฒนาคงไว้ที่ **1.0.0** ห้ามเพิ่ม release/รายการทุกครั้งที่แก้; ออกเวอร์ชันจริงครั้งถัดไป (เมื่อผู้ใช้สั่ง) = เพิ่ม release ไว้บนสุดของ `CHANGELOG` (th/en ทุกบรรทัด) แล้ว `APP_VERSION` เปลี่ยนตาม
- ป้าย `vX.Y.Z` ข้างชื่อระบบ (คลิกไป /about) + จุดแดง "ใหม่" เฉพาะผู้ใช้ที่เคยใช้เวอร์ชันก่อนหน้า จนกว่าจะเปิด /about (จำใน localStorage; เปิดครั้งแรกจำเวอร์ชันปัจจุบันเงียบๆ ไม่แจ้ง)

## API (Express)
- endpoint อยู่ใต้ `/api/v1` (`express/src/routes`), ข้อความ th/en ที่ `express/src/lib/i18n.ts` ตาม `Accept-Language`
- ข้อมูล audit (เช่น `asset_movements`, `audit_logs`) ห้ามแก้/ลบผ่าน API; ลบข้อมูลหลักใช้ soft delete หรือบังคับปิดใช้งานแทนถ้ามีประวัติ
- **โครงสร้างฐานข้อมูลเป็นของ Prisma migrations** (`express/prisma/`) — เพิ่ม/แก้ตาราง: แก้ `schema.prisma` → `npm run db:migrate -- --name <ชื่อ>` (ใน `express/`)
  - เพิ่มแบบ additive เท่านั้น (ไม่ลบ/เปลี่ยนชื่อ/เปลี่ยนชนิดคอลัมน์เดิม) และใส่ `down.sql` สำหรับย้อนกลับ — ทดสอบกับสำเนาฐานจริงก่อน
  - ห้ามแก้ไฟล์ migration ที่ deploy แล้ว — สร้าง migration ใหม่เสมอ; ข้อมูลตั้งต้นอยู่ที่ `express/src/cli/seed.ts`
  - Prisma ใช้จัดการ schema เท่านั้น — API เรียกฐานข้อมูลผ่าน mysql2 (`src/db.ts`) เพิ่มคอลัมน์แล้วต้องแก้ query/resource ที่เกี่ยวข้องด้วย
  - migration ที่ Prisma สร้างใส่ `COLLATE utf8mb4_unicode_ci` — **ต้องแก้เป็น `utf8mb4_0900_as_ci`** ก่อน deploy (unicode_ci/ai_ci ถือว่า "ขาย" = "ข่าย")
  - MySQL ห้าม CHECK บนคอลัมน์ที่ FK มี referential action (Prisma ตั้ง `ON UPDATE CASCADE` เป็นค่าตั้งต้น — ใส่ `onUpdate: Restrict`)
- SQL ใน Express เป็น MySQL 8.4: placeholder `?` (db.ts escape ให้ — array = รายการสำหรับ `IN (?)`, object = JSON),
  session ใช้ `ANSI_QUOTES` → ชื่อคอลัมน์ใช้ `"..."` และ**ต้องครอบคำสงวน** เช่น `"key"`, `"group"`, `"before"`, `"after"` (หลัง `alias.` ไม่ต้อง), ข้อความใช้ `'...'` เท่านั้น,
  ค้นหาข้อความใช้ `LIKE` + `likeEscape()` (collation ไม่สนตัวพิมพ์อยู่แล้ว), JSON ใช้ `JSON_EXTRACT`/`->>'$.x'`/`JSON_CONTAINS`/`JSON_TABLE`,
  upsert ใช้ `INSERT ... AS new ON DUPLICATE KEY UPDATE col = new.col`, ค่าว่างเทียบกันใช้ `<=>`, lock ตามชื่อใน transaction ใช้ `lockNamed()`,
  นิพจน์ boolean ใน SELECT (เช่น `EXISTS(...)`, `x IS NULL`) คืน 1/0 ไม่ใช่ true/false (คอลัมน์ BOOLEAN คืน true/false), ตรวจรูปแบบ uuid ด้วย `isUuid()` ก่อน query คอลัมน์ uuid
- ค่า env อยู่ใน `express/.env`
- ห้ามเปลี่ยนรูปแบบ token (Sanctum), bcrypt `$2y$`, การเข้ารหัส `APP_KEY` และ path ไฟล์ที่เก็บใน DB — ข้อมูลเดิมใช้รูปแบบนี้อยู่
- เทสต์ Express ใช้ฐาน `it_system_test` เท่านั้น (บังคับใน `vitest.config.ts` + `tests/setup.ts`) — ห้ามชี้เทสต์ไปที่ `it_system`
- งานแต่ละประเภทมี agent เฉพาะทางใน `.claude/agents/` — ใช้เมื่องานใหญ่หรือต้องการความเชี่ยวชาญเฉพาะ

## UI / Frontend (บังคับ)
- **ทุกอย่างที่กดด้วยเมาส์ได้ ต้องมี `cursor-pointer`** — ปุ่ม, ลิงก์, แท็บ, swatch, ตัวเลือก dropdown, label ของ checkbox/radio, แถวที่คลิกได้
  - ใช้ `btn.*` จาก `components/ui.ts` (มี `cursor-pointer` อยู่แล้ว) หรือใส่ class `cursor-pointer` เอง
  - สถานะ disabled ใช้ `disabled:cursor-not-allowed`
  - `globals.css` มีกฎ base เป็นตาข่ายรองรับ แต่ **ต้องใส่ class ในคอมโพเนนต์ด้วยเสมอ**
- Tooltip ใช้ `<Tooltip>` จาก `components/tooltip.tsx` เท่านั้น — **ห้ามใช้ attribute `title`** (สไตล์ไม่สวยและไม่ตรงธีม)
- สีใช้ token เท่านั้น ห้าม hard-code ชื่อสี Tailwind ในหน้าเว็บ:
  - สีธีม: `accent-*` · สีพื้น/ตัวอักษร: `canvas / surface / subtle / line / ink / muted / faint`
  - สีสถานะ: `success / info / warning / danger / idle` (เปลี่ยนตามธีมอัตโนมัติ ไม่ให้ซ้ำกับสีธีม)
  - ยกเว้น: error ใต้ช่องกรอกใช้ `inputError` + `text-red-500` (มาตรฐานฟอร์ม)
- รองรับโหมดมืดทุกหน้า (`dark:` variant) และ responsive (ตารางบนจอใหญ่ / การ์ดบนมือถือ)
- ข้อความทุกจุดผ่าน i18n: `src/i18n/th.ts` (ต้นแบบ) + `en.ts` — ห้าม hard-code ข้อความในคอมโพเนนต์
- ทุกหน้าที่โหลดข้อมูลต้องมี `loading.tsx` หรือ `<Suspense>` + skeleton; ปุ่มที่ส่งข้อมูลต้องแสดง spinner
- ฟอร์ม: error ใต้ช่องสีแดง + ล้าง error ของช่องทันทีเมื่อผู้ใช้แก้
- PWA: `public/sw.js` (เปลี่ยน sw.js/offline.html ต้องเพิ่ม `VERSION`), แถบ "ติดตั้ง (Install)" ล่างจอ = `components/install-prompt.tsx` (เฉพาะ iPhone/iPad/Android ที่ยังไม่ติดตั้ง — Android ใช้ `beforeinstallprompt` / iOS แสดงวิธี "เพิ่มไปยังหน้าจอโฮม", ไว้ทีหลัง = ซ่อน 7 วันใน localStorage; ติดตั้งแล้วไม่แสดงอีก = เปิดแบบ standalone / appinstalled / getInstalledRelatedApps (`related_applications` ใน manifest) / ปุ่ม "ติดตั้งแล้ว" → `it-pwa-installed`)
- เรียก API ผ่าน `apiFetch` (server-side) เท่านั้น — token อยู่ใน httpOnly cookie ห้ามส่งไป browser
- Next.js 16 มี breaking changes — อ่าน `frontend/node_modules/next/dist/docs/` ก่อนใช้ API ที่ไม่แน่ใจ (เช่น `proxy.ts` แทน middleware)
