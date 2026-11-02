"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { PermissionCatalog } from "@/lib/types";
import s from "./permission-request-paper.module.css";

/** ขนาดตัวอักษรของรายการสิทธิ์ (pt) — เริ่มที่ MAX แล้วลดทีละ STEP จนพอดี 1 หน้า (ไม่ต่ำกว่า MIN) */
const MAX = 13;
const MIN = 8;
const STEP = 0.5;

const Box = () => <span className={s.box} aria-hidden="true" />;
const Check = ({ label }: { label: string }) => (
  <span className={s.check}>
    <Box />
    {label}
  </span>
);

/**
 * แบบฟอร์มขอสิทธิ์การใช้งานระบบ (กระดาษ A4 หน้าเดียว — พิมพ์ให้ผู้ใช้เลือกแล้วส่งฝ่าย IT):
 * ข้อมูลผู้ขอ (ชื่อ-สกุล / แผนก / สาขา ฯลฯ) + ประเภทคำขอ + กลุ่มสิทธิ์ + สิทธิ์รายข้อตามระบบงาน (เมนู) + เหตุผล + ลายมือชื่อ
 * สิทธิ์ที่สงวนไว้ให้ผู้ดูแลระบบสูงสุด (locked) ไม่อยู่ในแบบฟอร์ม · กลุ่ม super_admin ไม่อยู่ในรายการกลุ่ม
 */
export function PermissionRequestPaper({ catalog }: { catalog: PermissionCatalog }) {
  const { t, locale } = useI18n();
  const name = (x: { name_th: string; name_en: string }) => (locale === "th" ? x.name_th : x.name_en);
  const listRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(MAX);

  // ย่อขนาดตัวอักษรของรายการจนไม่ล้นกรอบ (ล้น = คอลัมน์เกินแนวนอน หรือสูงเกิน) — วัดใหม่เมื่อฟอนต์โหลดเสร็จ
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const fit = () => {
      let next = MAX;
      el.style.setProperty("--list-size", `${next}pt`);
      while (next > MIN && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        next -= STEP;
        el.style.setProperty("--list-size", `${next}pt`);
      }
      setSize(next);
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [catalog]);

  const modules = catalog.modules
    .map((m) => ({ m, items: catalog.data.filter((p) => p.module === m.key && !p.locked) }))
    .filter((x) => x.items.length > 0);
  const groups = catalog.groups.filter((g) => g.key !== "super_admin");

  return (
    <div className={s.sheet}>
      <div className={s.frame}>
        <header className={s.header}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์คงที่ใน public (โลโก้บริษัทของแบบฟอร์มนี้) */}
          <img src="/print/stec-logo.png" alt={t("ticketPaper.company.logoAlt")} className={s.logo} />
          <div className={s.headText}>
            <div className={s.nameTh}>{t("ticketPaper.company.nameTh")}</div>
            <div className={s.nameEn}>{t("ticketPaper.company.nameEn")}</div>
          </div>
          <div className={s.docNo}>
            {t("permRequest.dateLabel")} ........./........./.........
          </div>
        </header>

        <div className={s.title}>{t("permRequest.title")}</div>

        {/* ข้อมูลผู้ขอ */}
        <div className={s.fields}>
          {(["fullName", "position", "department", "branch", "email", "phone"] as const).map((k) => (
            <div key={k} className={s.field}>
              {t(`permRequest.fields.${k}`)}
              <span className={s.line} />
            </div>
          ))}
        </div>

        <div className={s.row}>
          <span className={s.rowLabel}>{t("permRequest.typeLabel")}</span>
          <Check label={t("permRequest.types.newUser")} />
          <Check label={t("permRequest.types.add")} />
          <Check label={t("permRequest.types.remove")} />
          <Check label={t("permRequest.types.change")} />
        </div>
        <div className={s.row}>
          <span className={s.rowLabel}>{t("permRequest.periodLabel")}</span>
          <Check label={t("permRequest.periods.permanent")} />
          <span className={s.check}>
            <Box />
            {t("permRequest.periods.until")} ........./........./.........
          </span>
        </div>

        {/* กลุ่มสิทธิ์ (ตำแหน่ง / กลุ่มที่สร้างเอง) */}
        <div className={s.sectionTitle}>
          {t("permRequest.groupsTitle")} <span className={s.hint}>{t("permRequest.groupsHint")}</span>
        </div>
        <div className={s.row}>
          {groups.map((g) => (
            <Check key={g.key} label={name(g)} />
          ))}
        </div>

        {/* สิทธิ์รายข้อตามระบบงาน (เมนู) */}
        <div className={s.sectionTitle}>
          {t("permRequest.permsTitle")} <span className={s.hint}>{t("permRequest.permsHint")}</span>
        </div>
        <div ref={listRef} className={s.list} data-size={size}>
          {modules.map(({ m, items }) => (
            <div key={m.key} className={s.module}>
              <div className={s.moduleName}>{name(m)}</div>
              <div className={s.items}>
                {items.map((p) => (
                  <span key={p.key} className={s.item}>
                    <Box />
                    <span>{name(p)}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={s.reason}>
          {t("permRequest.reason")}
          <div className={s.reasonLines} />
          <div className={s.reasonLines} />
        </div>

        <div className={s.signs}>
          {(["requester", "supervisor", "it"] as const).map((k) => (
            <div key={k} className={s.sign}>
              <div className={s.signLine} />
              <div>(............................................)</div>
              <div className={s.signRole}>{t(`permRequest.signs.${k}`)}</div>
              <div>{t("permRequest.dateLabel")} ......../......../........</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
