"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { LinkPendingIcon } from "@/components/pending";
import { useI18n } from "@/i18n/client";
import { activeHref, type NavGroup } from "./nav";

/**
 * เมนูแบบ accordion: เปิดได้ทีละกลุ่ม — คลิกกลุ่มใหม่ กลุ่มเดิมจะย่อลงอัตโนมัติ
 * กลุ่มที่มีหน้าปัจจุบันจะเปิดไว้ตั้งแต่แรก
 */
export function SidebarNav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = activeHref(groups, pathname);
  const [open, setOpen] = useState<string | null>(
    () => groups.find((g) => g.items.some((i) => i.href === active))?.id ?? groups[0]?.id ?? null,
  );

  return (
    <nav className="space-y-1" aria-label="Main">
      {groups.map((group) => {
        const isOpen = open === group.id;
        const hasActive = group.items.some((i) => i.href === active);
        const panelId = `nav-${group.id}`;
        return (
          <div key={group.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen(isOpen ? null : group.id)}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                hasActive ? "text-accent-800 dark:text-accent-200" : "text-ink"
              } hover:bg-subtle`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  hasActive
                    ? "bg-accent-200 text-accent-800 dark:bg-accent-400/25 dark:text-accent-200"
                    : "bg-accent-100 text-accent-600 dark:bg-accent-400/10 dark:text-accent-300"
                }`}
              >
                <group.icon width={16} height={16} />
              </span>
              <span className="flex-1 text-left">{t(group.label)}</span>
              <ChevronDownIcon
                width={15}
                height={15}
                className={`text-faint transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>

            {/* ย่อ/ขยายแบบนุ่มด้วย grid-rows 0fr → 1fr */}
            <div
              id={panelId}
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
              <div className="overflow-hidden" inert={!isOpen}>
                <ul className="ml-7 space-y-0.5 border-l border-line py-1 pl-3">
                  {group.items.map((item) => {
                    const current = item.href === active;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={current ? "page" : undefined}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                            current
                              ? "bg-accent-100 font-medium text-accent-800 dark:bg-accent-400/15 dark:text-accent-200"
                              : "text-muted hover:bg-subtle hover:text-ink"
                          }`}
                        >
                          <LinkPendingIcon
                            icon={<item.icon width={15} height={15} className={current ? "" : "text-accent-400"} />}
                            size={15}
                          />
                          {t(item.label)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
