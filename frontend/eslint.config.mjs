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
      ],
    },
  },
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
