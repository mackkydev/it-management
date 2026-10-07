"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

/** คลิกบนปุ่ม/ลิงก์/ช่องกรอกในแถว → ทำงานของตัวมันเอง ไม่เปิดหน้ารายละเอียด */
const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role=button], [role=switch], [role=combobox]";

/**
 * แถวตาราง (tr) / การ์ด (li) ที่คลิกตรงไหนก็เปิดหน้ารายละเอียด
 * - Ctrl/⌘ หรือคลิกกลาง = เปิดแท็บใหม่, ลากเลือกข้อความ = ไม่เปิด
 * - คีย์บอร์ด/โปรแกรมอ่านจอใช้ลิงก์ชื่อรายการในแถวตามเดิม
 */
export function ClickableRow({ href, as: Tag = "tr", className = "", children }: { href: Route; as?: "tr" | "li"; className?: string; children: ReactNode }) {
  const router = useRouter();
  const open = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    if (e.ctrlKey || e.metaKey || e.button === 1) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  return (
    <Tag
      onClick={open}
      onAuxClick={(e) => e.button === 1 && open(e)}
      onMouseEnter={() => router.prefetch(href)}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </Tag>
  );
}
