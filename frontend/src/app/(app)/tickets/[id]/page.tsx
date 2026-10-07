import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CheckCircleIcon, ChevronLeftIcon, ClipboardIcon, FileTextIcon, HistoryIcon, PaperclipIcon, WrenchIcon } from "@/components/icons";
import { LinkPendingIcon } from "@/components/pending";
import { card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { ApiError, apiFetch } from "@/lib/api";
import { getAccess } from "@/lib/auth";
import type { TicketDetail } from "@/lib/types";
import type { TicketFormOptions } from "../new/ticket-form";
import { DoneBanner } from "../ticket-list";
import { headApprovedAt, TicketStatusBadge, ticketSubject } from "../ticket-ui";
import { ProcessTimeline } from "./process-timeline";
import { PrintModal } from "./print-modal";
import { TicketActions } from "./ticket-actions";
import { TicketPaper } from "./ticket-paper";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tickets.title") };
}

async function getTicket(id: string) {
  try {
    return (await apiFetch<{ data: TicketDetail }>(`/tickets/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}

/** URL ของไฟล์ผ่าน route handler /files (แนบ token ให้ฝั่ง server) */
const fileUrl = (path: string) => `/files${path}`;

function Item({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line font-medium text-ink">{children || "-"}</dd>
    </div>
  );
}

function Section({ title, icon, children, aside }: { title: string; icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`p-4 sm:p-6 print:break-inside-avoid print:shadow-none ${card}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300 print:hidden">
            {icon}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Photos({ urls, label }: { urls: { url: string; name: string | null }[]; label: string }) {
  if (urls.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {urls.map((p) => (
          <a key={p.url} href={fileUrl(p.url)} target="_blank" rel="noreferrer" className="block cursor-zoom-in overflow-hidden rounded-xl ring-1 ring-line transition hover:ring-accent-300">
            {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน route handler (ไม่ใช้ next/image optimizer) */}
            <img src={fileUrl(p.url)} alt={p.name ?? ""} loading="lazy" className="h-28 w-28 object-cover" />
          </a>
        ))}
      </div>
    </div>
  );
}

function Signature({ url, name, role, date, t }: { url: string | null; name?: string | null; role: string; date?: string | null; t: (k: MessageKey) => string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-20 w-full items-end justify-center border-b border-dashed border-line">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- ลายเซ็นจาก private storage
          <img src={fileUrl(url)} alt={`${t("signature.label")} ${role}`} className="max-h-20 dark:invert" />
        ) : null}
      </div>
      <p className="mt-1 text-sm font-medium">{name ? `( ${name} )` : "( ................................ )"}</p>
      <p className="text-xs text-muted">{role}</p>
      {date && <p className="text-xs text-faint">{date}</p>}
    </div>
  );
}

export default async function TicketDetailPage({ params, searchParams }: PageProps<"/tickets/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { done } = await searchParams;
  const [tk, { t, fmt }, can, branches] = await Promise.all([
    getTicket(id),
    getI18n(),
    getAccess(),
    // รายการสาขาสำหรับช่องติ๊กในแบบฟอร์มพิมพ์ (โหลดไม่ได้ = แสดงเฉพาะสาขาของใบงาน)
    apiFetch<{ data: TicketFormOptions }>("/tickets/form-options").then((r) => r.data.branches, () => []),
  ]);

  const requestPhotos = tk.attachments.filter((a) => a.kind === "request");
  const resultPhotos = tk.attachments.filter((a) => a.kind === "result");
  const documents = tk.attachments.filter((a) => a.kind === "document");
  const isRepair = tk.type === "repair";
  const needsPerson = tk.type === "grant_access" || tk.type === "revoke_access";
  const headAt = headApprovedAt(tk);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/tickets" className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted hover:text-ink">
          <LinkPendingIcon icon={<ChevronLeftIcon width={15} height={15} />} size={15} />
          {t("tickets.detail.back")}
        </Link>
        {/* พิมพ์ / PDF: modal แสดงแบบฟอร์ม A4 */}
        {can("btn:tickets:print") && (
          <PrintModal label={t("tickets.detail.print")} fileName={tk.ticket_no}>
            <TicketPaper tk={tk} branches={branches} t={t} fmt={fmt} />
          </PrintModal>
        )}
      </div>

      {typeof done === "string" && <DoneBanner done={done} />}

      {/* หัวเอกสาร */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300 print:hidden">
            <ClipboardIcon width={24} height={24} />
          </span>
          <div>
            <p className="font-mono text-xs font-semibold text-accent-700 dark:text-accent-300">{tk.ticket_no}</p>
            <h1 className="text-2xl font-semibold">{t("tickets.formTitle")}</h1>
            <p className="text-sm text-muted">{ticketSubject(tk.type, tk.type_other, t)}</p>
          </div>
        </div>
        <TicketStatusBadge status={tk.status} t={t} />
      </div>

      {tk.actions.length > 0 && <TicketActions ticket={tk} />}

      {/* ขั้นตอนที่กำลังดำเนินการ */}
      <ProcessTimeline tk={tk} t={t} fmt={fmt} />

      {/* ข้อมูลการแจ้งงาน */}
      <Section title={t("tickets.detail.requestSection")} icon={<ClipboardIcon width={15} height={15} />}>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label={t("tickets.detail.requestedAt")}>{fmt.dateTime(tk.requested_at)}</Item>
          <Item label={t("tickets.form.subject")}>{ticketSubject(tk.type, tk.type_other, t)}</Item>
          <Item label={t("tickets.form.department")}>{tk.department}</Item>
          <Item label={t("tickets.form.division")}>{tk.division}</Item>
          <Item label={t("tickets.form.branch")}>{tk.branch?.name}</Item>
          <Item label={t("tickets.detail.requestedBy")}>{tk.requester?.name}</Item>
          <Item label={t("tickets.form.dueDate")}>{tk.due_date ? fmt.date(tk.due_date) : null}</Item>
          <Item label={t("tickets.detail.assignee")}>{tk.assignee?.name ?? t("tickets.detail.notAssigned")}</Item>
          <div className="sm:col-span-2 lg:col-span-4">
            <Item label={t("tickets.form.details")}>{tk.details}</Item>
          </div>
        </dl>
      </Section>

      {tk.approval_steps.length > 0 && (
        <Section title={t("tickets.approval.title")} icon={<CheckCircleIcon width={15} height={15} />}>
          <ol className="space-y-3">
            {tk.approval_steps.map((s) => {
              const current = s.status === "pending" && s.step_no === tk.current_step;
              const look = s.status === "approved" ? tone.success : s.status === "rejected" ? tone.danger : current ? tone.warning : tone.idle;
              const status = current ? "current" : s.status === "pending" ? "waiting" : s.status;
              return (
                <li key={s.step_no} className="flex gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${look.badge}`}>{s.step_no}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{s.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${look.badge}`}>{t(`tickets.approval.status.${status}`)}</span>
                    </p>
                    {s.status === "approved" || s.status === "rejected" ? (
                      <p className="mt-0.5 text-sm text-muted">
                        {s.acted_by?.name}
                        {s.acted_at && <span className="text-faint"> · {fmt.dateTime(s.acted_at)}</span>}
                      </p>
                    ) : (
                      s.approvers.length > 0 && <p className="mt-0.5 text-sm text-muted">{t("tickets.approval.anyOf", { names: s.approvers.map((a) => a.name).join(", ") })}</p>
                    )}
                    {s.comment && <p className="mt-1 rounded-lg bg-subtle px-3 py-1.5 text-sm">{s.comment}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      {needsPerson && (
        <Section title={t("tickets.form.section11")} icon={<FileTextIcon width={15} height={15} />}>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Item label={t("tickets.form.nameTh")}>{tk.person_name_th}</Item>
            <Item label={t("tickets.form.nameEn")}>{tk.person_name_en}</Item>
          </dl>
        </Section>
      )}

      {/* 1.2 เครื่องที่ส่งซ่อม / เครื่องที่ติดตั้ง (งานติดตั้งแสดงเมื่อระบุเครื่อง) */}
      {(isRepair || (tk.type === "install" && (tk.device_name || tk.asset_tag))) && (
        <Section title={t(isRepair ? "tickets.form.section12" : "tickets.form.section12Install")} icon={<WrenchIcon width={15} height={15} />}>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Item label={t(isRepair ? "tickets.form.device" : "tickets.form.deviceInstall")}>{tk.device_name}</Item>
            <Item label={t("tickets.form.assetTag")}>
              {tk.asset ? (
                <Link href={`/assets/${tk.asset.id}`} className="cursor-pointer font-mono text-accent-700 hover:underline dark:text-accent-300">
                  {tk.asset.asset_tag} · {tk.asset.name}
                </Link>
              ) : (
                tk.asset_tag && <span className="font-mono">{tk.asset_tag}</span>
              )}
            </Item>
            {isRepair && (
              <Item label={t("tickets.form.symptom")} wide>
                {tk.symptom}
              </Item>
            )}
          </dl>
        </Section>
      )}

      {(requestPhotos.length > 0 || documents.length > 0) && (
        <Section title={t("tickets.detail.attachments")} icon={<PaperclipIcon width={15} height={15} />}>
          <div className="space-y-4">
            <Photos urls={requestPhotos} label={t("tickets.detail.requestPhotos")} />
            {documents.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted">{t("tickets.detail.documents")}</p>
                <ul className="space-y-1.5">
                  {documents.map((d) => (
                    <li key={d.id}>
                      <a
                        href={fileUrl(d.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex cursor-pointer items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm transition-colors hover:bg-accent-50 dark:hover:bg-accent-400/10"
                      >
                        <FileTextIcon width={16} height={16} className="shrink-0 text-accent-500" />
                        <span className="min-w-0 flex-1 truncate">{d.name}</span>
                        <span className="text-xs text-muted">{(d.size / 1024 / 1024).toFixed(2)} MB</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ผลการดำเนินงาน */}
      <Section title={t("tickets.detail.resultSection")} icon={<WrenchIcon width={15} height={15} />}>
        {tk.result ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Item label={t("tickets.result.outcome")}>
                {tk.result === "completed"
                  ? `${t("tickets.result.completed")}${tk.completed_on ? ` · ${fmt.date(tk.completed_on)}` : ""}`
                  : t("tickets.result.cannot")}
              </Item>
              {tk.result === "cannot_complete" && <Item label={t("tickets.result.cannotReason")}>{tk.cannot_reason}</Item>}
              {isRepair && (
                <>
                  <Item label={t("tickets.result.method")}>
                    {tk.repair_method === "external"
                      ? `${t("tickets.result.external")} — ${tk.external_vendor ?? ""}`
                      : tk.repair_method === "in_house"
                        ? t("tickets.result.inHouse")
                        : null}
                  </Item>
                  <Item label={t("tickets.result.warranty")}>
                    {tk.warranty === "in_warranty" ? t("tickets.result.inWarranty") : tk.warranty === "out_of_warranty" ? t("tickets.result.outOfWarranty") : null}
                  </Item>
                </>
              )}
              <Item label={t("tickets.result.details")} wide>
                {tk.repair_details}
              </Item>
            </dl>
            {tk.parts.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted">{t("tickets.result.parts")}</p>
                <ol className="space-y-2">
                  {tk.parts.map((p, i) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-xl bg-subtle p-2 pr-3 text-sm">
                      <span className="w-6 text-center text-xs text-muted">{i + 1}.</span>
                      {p.photo_url && (
                        <a href={fileUrl(p.photo_url)} target="_blank" rel="noreferrer" className="cursor-zoom-in">
                          {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน route handler */}
                          <img src={fileUrl(p.photo_url)} alt={p.name} className="h-12 w-12 rounded-lg object-cover" />
                        </a>
                      )}
                      <span className="flex-1 font-medium">{p.name}</span>
                      <span className="text-muted">× {p.quantity}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <Photos urls={resultPhotos} label={t("tickets.detail.resultPhotos")} />
          </div>
        ) : (
          <p className="text-sm text-muted">{t("tickets.detail.noResult")}</p>
        )}
      </Section>

      {/* ลายเซ็น 3 ช่องตามแบบฟอร์ม */}
      <section className={`grid grid-cols-1 gap-6 p-4 sm:grid-cols-3 sm:p-6 print:break-inside-avoid ${card}`}>
        <Signature
          url={tk.signatures.staff}
          name={tk.signatures.staff ? tk.assignee?.name : null}
          role={t("tickets.detail.sigStaff")}
          date={tk.resulted_at ? fmt.date(tk.resulted_at) : null}
          t={t}
        />
        <Signature
          url={tk.signatures.it_head}
          name={tk.it_head?.name}
          role={t("tickets.detail.sigItHead")}
          date={headAt ? fmt.date(headAt) : null}
          t={t}
        />
        <Signature url={tk.signatures.requester} name={tk.requester?.name} role={t("tickets.detail.sigRequester")} date={fmt.date(tk.requested_at)} t={t} />
      </section>

      {/* ประวัติ */}
      <Section title={t("tickets.detail.history")} icon={<HistoryIcon width={15} height={15} />}>
        <ol className="relative space-y-4 border-l-2 border-accent-100 pl-5 dark:border-accent-400/20">
          {tk.events.map((ev) => (
            <li key={ev.id} className="relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-accent-400 ring-4 ring-surface" aria-hidden="true" />
              <p className="text-sm">
                <span className="font-medium">{t(`tickets.events.${ev.action}` as MessageKey)}</span>
                {ev.user && <span className="text-muted"> · {ev.user.name}</span>}
              </p>
              <p className="text-xs text-faint">{fmt.dateTime(ev.created_at)}</p>
              {ev.comment && <p className="mt-1 rounded-lg bg-subtle px-3 py-1.5 text-sm">{ev.comment}</p>}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
