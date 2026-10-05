import type { ReactNode } from "react";
import type { Formatters, TFunction } from "@/i18n/types";
import type { TicketDetail, TicketType } from "@/lib/types";
import { headApprovedAt } from "../ticket-ui";
import s from "./ticket-paper.module.css";

/** URL ของไฟล์ผ่าน route handler /files (แนบ token ให้ฝั่ง server) */
const fileUrl = (path: string) => `/files${path}`;

/** วันที่แบบช่องในแบบฟอร์ม: "30 / 09 / 2569" */
const paperDate = (fmt: Formatters, iso: string | null | undefined) => (iso ? fmt.date(iso).split("/").join(" / ") : "");

function Check({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={s.check}>
      <span className={s.box} aria-hidden="true">
        {on ? "✓" : ""}
      </span>
      {children}
    </span>
  );
}

function Fill({ children, width, left = false }: { children?: ReactNode; width?: string; left?: boolean }) {
  return (
    <span className={`${s.fill} ${left ? s.fillLeft : ""} ${width ? s.fixed : ""}`} style={width ? { width } : undefined}>
      {children || " "}
    </span>
  );
}

/** ข้อความหลายบรรทัดบนเส้นประ (ตัดส่วนที่เกินจำนวนบรรทัด — เอกสารต้องอยู่หน้าเดียว) */
function Lines({ label, text, lines }: { label: string; text: string | null; lines: number }) {
  return (
    <div className={s.multi} style={{ height: `${lines * 8.2}mm` }}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={s.dotline} style={{ top: `${(i + 1) * 8.2 - 1.4}mm` }} aria-hidden="true" />
      ))}
      <div className={s.multiText}>
        <span className={s.multiLabel}>{label}</span>
        {text}
      </div>
    </div>
  );
}

/** ลายเซ็น: รูป → (ชื่อ บนเส้นประ) → ตำแหน่ง → วันที่ — line = เส้นทึบเหนือชื่อ (ช่องท้ายเอกสาร) */
function Sign({ url, name, role, date, alt, line = true }: { url: string | null; name: string | null | undefined; role: string; date: string; alt: string; line?: boolean }) {
  return (
    <div className={s.sign}>
      <div className={s.sigArea}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ลายเซ็นจาก private storage ผ่าน /files */}
        {url && <img src={fileUrl(url)} alt={alt} className={s.sigImg} />}
      </div>
      {line && <div className={s.sigLine} />}
      <div className={s.signName}>
        (<span className={s.signNameText}>{name || " "}</span>)
      </div>
      <div>{role}</div>
      <div>
        <span className={s.signDate}>{date || " "}</span>
      </div>
    </div>
  );
}

const SUBJECTS: TicketType[] = ["repair", "install", "grant_access", "revoke_access"];

/**
 * ใบแจ้งดำเนินงาน IT แบบกระดาษ A4 หน้าเดียว — วางตามแบบฟอร์มเดิมของบริษัท แล้วเติมข้อมูลจากใบแจ้งงาน
 * ลายเซ็นผู้แจ้งท้ายเอกสาร = ตอนกดรับงาน (ปิดงาน) — ใบเดิมที่หัวหน้า IT ปิดเองจะว่าง
 */
export function TicketPaper({
  tk,
  branches,
  t,
  fmt,
}: {
  tk: TicketDetail;
  branches: { id: number; name: string }[];
  t: TFunction;
  fmt: Formatters;
}) {
  const needsPerson = tk.type === "grant_access" || tk.type === "revoke_access";
  const isRepair = tk.type === "repair";
  const confirmed = tk.events.find((e) => e.action === "confirmed");
  const list = branches.some((b) => b.id === tk.branch?.id) || !tk.branch ? branches : [...branches, tk.branch];
  const parts = tk.parts.map((p) => (p.quantity > 1 ? `${p.name} × ${p.quantity}` : p.name));

  return (
    <article className={s.sheet} aria-label={t("ticketPaper.title")}>
      <div className={s.frame}>
        {/* หัวบริษัท */}
        <header className={s.header}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์คงที่ใน public (โลโก้บริษัทของแบบฟอร์มนี้) */}
          <img src="/print/stec-logo.png" alt={t("ticketPaper.company.logoAlt")} className={s.logo} />
          <div>
            <div className={s.nameTh}>{t("ticketPaper.company.nameTh")}</div>
            <div className={s.nameEn}>{t("ticketPaper.company.nameEn")}</div>
          </div>
        </header>
        <div className={s.address}>
          <b>{t("ticketPaper.company.officeLabel")}</b> : {t("ticketPaper.company.address")}
        </div>

        <h1 className={s.title}>{t("ticketPaper.title")}</h1>

        <div className={s.section}>
          <div className={`${s.row} ${s.right}`}>
            <span className={s.label}>{t("ticketPaper.date")}</span>
            <Fill width="34mm">{paperDate(fmt, tk.requested_at)}</Fill>
          </div>

          {/* เรื่อง */}
          <div className={s.row}>
            <span className={s.labelWide}>{t("ticketPaper.subject")}</span>
            <div className={s.checks}>
              {SUBJECTS.map((ty) => (
                <Check key={ty} on={tk.type === ty}>
                  {t(`ticketPaper.types.${ty}`)}
                </Check>
              ))}
            </div>
          </div>
          <div className={s.row}>
            <span className={s.labelWide} />
            <Check on={tk.type === "other"}>{t("ticketPaper.types.other")}</Check>
            <Fill left>{tk.type === "other" ? tk.type_other : ""}</Fill>
          </div>

          <div className={s.row}>
            <span className={s.label}>{t("ticketPaper.department")}</span>
            <Fill>{tk.department}</Fill>
            <span className={s.label}>{t("ticketPaper.division")}</span>
            <Fill>{tk.division}</Fill>
          </div>

          {/* สาขา */}
          <div className={s.row} style={{ alignItems: "flex-start" }}>
            <span className={s.labelWide} style={{ paddingTop: "1.5mm" }}>
              {t("ticketPaper.branch")}
            </span>
            <div className={s.branches}>
              {list.map((b) => (
                <Check key={b.id} on={b.id === tk.branch?.id}>
                  {b.name}
                </Check>
              ))}
            </div>
          </div>

          <Lines label={t("ticketPaper.purpose")} text={tk.details} lines={2} />

          <div className={s.requestFoot}>
            <div className={s.row} style={{ flex: 1 }}>
              <span className={s.label}>{t("ticketPaper.dueDate")}</span>
              <Fill width="40mm">{paperDate(fmt, tk.due_date)}</Fill>
            </div>
            <Sign
              url={tk.signatures.requester}
              name={tk.requester?.name}
              role={t("ticketPaper.requester")}
              date={paperDate(fmt, tk.requested_at)}
              alt={t("ticketPaper.requester")}
              line={false}
            />
          </div>
        </div>

        {/* 1.1 */}
        <div className={s.rule} />
        <div className={s.section}>
          <div className={s.row}>
            <span className={s.label}>1.1</span>
            <span className={s.label}>{t("ticketPaper.nameTh")}</span>
            <Fill>{needsPerson ? tk.person_name_th : ""}</Fill>
            <span className={s.label}>{t("ticketPaper.nameEn")}</span>
            <Fill>{needsPerson ? tk.person_name_en : ""}</Fill>
          </div>
        </div>

        {/* 1.2 */}
        <div className={s.rule} />
        <div className={s.section}>
          <div className={s.row}>
            <span className={s.label}>1.2</span>
            <span className={s.label}>{t("ticketPaper.device")}</span>
            <Fill>{isRepair ? tk.device_name : ""}</Fill>
            <span className={s.label}>{t("ticketPaper.assetTag")}</span>
            <Fill>{isRepair ? tk.asset_tag : ""}</Fill>
          </div>
          <div className={s.row}>
            <span className={s.label}>{t("ticketPaper.symptom")}</span>
            <Fill left>{isRepair ? tk.symptom : ""}</Fill>
          </div>
        </div>

        {/* ผลการดำเนินงาน (สำหรับเจ้าหน้าที่ IT) */}
        <div className={s.rule} />
        <div className={s.section}>
          <div className={`${s.row} ${s.resultHead}`}>
            <span className={s.resultLabel}>{t("ticketPaper.result")}</span>
            <Check on={tk.result === "completed"}>{t("ticketPaper.completed")}</Check>
            <span className={s.label}>{t("ticketPaper.onDate")}</span>
            <Fill width="34mm">{tk.result === "completed" ? paperDate(fmt, tk.completed_on) : ""}</Fill>
            <span style={{ flex: 1 }} />
            <span className={s.tag}>{t("ticketPaper.forIt")}</span>
          </div>
          <div className={`${s.row} ${s.indent}`}>
            <Check on={tk.result === "cannot_complete"}>{t("ticketPaper.cannot")}</Check>
            <Fill left>{tk.result === "cannot_complete" ? tk.cannot_reason : ""}</Fill>
          </div>
          <div className={s.row}>
            <span className={s.resultLabel}>{t("ticketPaper.method")}</span>
            <span style={{ width: "62mm" }}>
              <Check on={tk.repair_method === "in_house"}>{t("ticketPaper.inHouse")}</Check>
            </span>
            <Check on={tk.repair_method === "external"}>{t("ticketPaper.external")}</Check>
            <Fill left>{tk.repair_method === "external" ? tk.external_vendor : ""}</Fill>
          </div>
          <div className={s.row}>
            <span className={s.resultLabel}>{t("ticketPaper.warranty")}</span>
            <span style={{ width: "62mm" }}>
              <Check on={tk.warranty === "in_warranty"}>{t("ticketPaper.inWarranty")}</Check>
            </span>
            <Check on={tk.warranty === "out_of_warranty"}>{t("ticketPaper.outOfWarranty")}</Check>
          </div>
          <Lines label={t("ticketPaper.details")} text={tk.repair_details} lines={3} />
          <div className={s.row}>
            <span className={s.label}>{t("ticketPaper.parts")}</span>
            <div className={s.parts}>
              {[0, 1, 2].map((i) => (
                <span key={i} className={s.row} style={{ minHeight: 0 }}>
                  <span className={s.label}>{i + 1}.</span>
                  <Fill>{i === 2 && parts.length > 3 ? parts.slice(2).join(", ") : parts[i]}</Fill>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ลายเซ็น 3 ช่อง */}
        <div className={s.signs}>
          <Sign
            url={tk.signatures.staff}
            name={tk.signatures.staff ? tk.assignee?.name : null}
            role={t("ticketPaper.sigStaff")}
            date={paperDate(fmt, tk.resulted_at)}
            alt={t("ticketPaper.sigStaff")}
          />
          <Sign
            url={tk.signatures.it_head}
            name={tk.signatures.it_head ? tk.it_head?.name : null}
            role={t("ticketPaper.sigHead")}
            date={paperDate(fmt, headApprovedAt(tk))}
            alt={t("ticketPaper.sigHead")}
          />
          <Sign
            url={confirmed ? tk.signatures.requester : null}
            name={confirmed ? tk.requester?.name : null}
            role={t("ticketPaper.sigRequester")}
            date={paperDate(fmt, confirmed?.created_at)}
            alt={t("ticketPaper.sigRequester")}
          />
        </div>
      </div>
    </article>
  );
}
