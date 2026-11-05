"use client";

import { FileTextIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";
import type { PolicyFile, PolicySection } from "@/lib/types";

/** รายการไฟล์แนบของนโยบาย */
export function PolicyFiles({ files }: { files: Pick<PolicyFile, "id" | "name" | "url">[] }) {
  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id}>
          <a href={`/files${f.url}`} target="_blank" rel="noreferrer" className="flex cursor-pointer items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm transition-colors hover:bg-accent-50 dark:hover:bg-accent-400/10">
            <FileTextIcon width={16} height={16} className="shrink-0 text-accent-500" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** เนื้อหานโยบายแบบอ่านอย่างเดียว: หัวข้อทั้งหมด + ไฟล์แนบ (หน้า login / ดูตัวอย่าง / ฉบับก่อนหน้า) */
export function PolicyContent({ sections, files }: { sections: PolicySection[]; files: Pick<PolicyFile, "id" | "name" | "url">[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      {sections.map((s, i) => (
        <section key={i}>
          <h3 className="mb-1 font-semibold">
            {i + 1}. {s.title}
          </h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{s.body}</p>
        </section>
      ))}
      {files.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{t("login_policy.files")}</h3>
          <PolicyFiles files={files} />
        </section>
      )}
    </div>
  );
}
