import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // เอกสารในระบบต้องเปิดใน modal: PWA ไม่มีแถบ tab จึงกลับมาที่แอปไม่ได้ (ลิงก์ออกเว็บภายนอกยังเปิด tab ใหม่ได้)
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'JSXOpeningElement:has(JSXAttribute[name.name="target"][value.value="_blank"]):has(JSXAttribute[name.name="href"] :matches(TemplateElement[value.raw=/^\\/(files|policy-print|leave-print)/], Literal[value=/^\\/(files|policy-print|leave-print)/], Identifier[name="fileUrl"]))',
          message: "เปิดเอกสารด้วย <DocumentLink> (components/document-viewer.tsx) ห้ามใช้ target=\"_blank\" — ดูกฎใน CLAUDE.md",
        },
        // เอกสารที่พิมพ์ / บันทึก PDF ต้องไม่มีวันเวลา ชื่อหน้า หรือ URL ของเบราว์เซอร์ แสดงได้เฉพาะเลขหน้า
        {
          selector: "TemplateElement[value.raw=/@page/], Literal[value=/@page/]",
          message: "ตั้งหน้ากระดาษด้วย DOCUMENT_PRINT_CSS / SHEET_PRINT_CSS จาก lib/print-page.ts — ดูกฎใน CLAUDE.md",
        },
        // ทุกเอกสารต้องใช้เทมเพลตกลาง หน้าตาจะได้เหมือนกันทั้งระบบ
        {
          selector: 'CallExpression[callee.object.name="window"][callee.property.name="print"]',
          message: "สั่งพิมพ์ผ่าน PrintDocument / PrintToolbar (components/document-template.tsx) หรือ PrintModal — ดูกฎใน CLAUDE.md",
        },
      ],
    },
  },
  { files: ["src/lib/print-page.ts", "src/components/document-template.tsx", "eslint.config.mjs"], rules: { "no-restricted-syntax": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
