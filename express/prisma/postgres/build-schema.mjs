// สร้าง prisma/postgres/schema.prisma จาก prisma/schema.prisma (MySQL = ต้นฉบับ)
// รัน: npm run db:pg:schema — แล้วสร้าง migration ชุด PostgreSQL ตามขั้นตอนใน prisma/postgres/README.md
//
// แปลงชนิดคอลัมน์:
// - ข้อความทุกแบบ (VarChar/Char/Text) → citext — ไม่สนตัวพิมพ์เหมือน collation utf8mb4_0900_as_ci ของ MySQL
//   (เทียบ email = ?, LIKE, UNIQUE ทำงานเหมือนกันทั้งสองฐาน; ความยาวสูงสุดตรวจที่ API อยู่แล้ว)
// - DateTime(0) → Timestamp(0) (เก็บ UTC แบบไม่มี timezone เหมือน MySQL)
// - TinyInt → SmallInt, UnsignedBigInt → BigInt (PostgreSQL ไม่มี unsigned)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../schema.prisma", import.meta.url));
const out = fileURLToPath(new URL("./schema.prisma", import.meta.url));

let s = readFileSync(src, "utf8");
s = s.replace(/^\/\/.*\n(?:\/\/.*\n)*/, "");
s = s.replace(/provider\s*=\s*"mysql"/, 'provider = "postgresql"');
s = s.replace(/@db\.(?:VarChar|Char)\(\d+\)|@db\.Text\b/g, "@db.Citext");
s = s.replace(/@db\.DateTime\((\d)\)/g, "@db.Timestamp($1)");
s = s.replace(/@db\.TinyInt\b/g, "@db.SmallInt");
s = s.replace(/\s*@db\.UnsignedBigInt\b/g, "");
// String ที่ไม่ระบุชนิด (MySQL = VARCHAR(191)) → citext เหมือนกัน
s = s.replace(/^(\s+\w+\s+String\??)((?:(?!@db\.)[^\n])*)$/gm, (line, head, rest) => `${head}${rest} @db.Citext`.replace(/\s+$/, ""));

// คอลัมน์ GENERATED STORED (สร้างใน migration 0_init) — ระบุนิพจน์ให้ตรงกับฐาน ไม่งั้น prisma migrate dev จะสร้าง migration ถอด GENERATED ออก
const GENERATED = {
  notifications: { subject_ref: "eam_subject_ref((data)::text)" },
  repair_orders: { follow_up_on: "(sent_on + (follow_up_days)::integer)" },
};
for (const [model, cols] of Object.entries(GENERATED)) {
  const block = new RegExp(`(model ${model} \\{[\\s\\S]*?\\n\\})`);
  s = s.replace(block, (body) => {
    for (const [col, expr] of Object.entries(cols)) {
      body = body.replace(new RegExp(`^(\\s+${col}\\s+\\S+[^\\n]*?)$`, "m"), `$1 @default(dbgenerated("${expr}"))`);
    }
    return body;
  });
}

const header = `// สร้างอัตโนมัติจาก ../schema.prisma ด้วย build-schema.mjs — ห้ามแก้ไฟล์นี้ตรงๆ (แก้ที่ต้นฉบับ MySQL แล้วรัน npm run db:pg:schema)
// PostgreSQL 18 — ข้อความเป็น citext (ไม่สนตัวพิมพ์) ให้พฤติกรรมตรงกับ MySQL utf8mb4_0900_as_ci
`;
writeFileSync(out, header + s);
console.log(`wrote ${out}`);
