"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createTicket, lookupAssetNumber, searchAssetNumbers, updateTicket, type AssetMatch } from "@/app/actions/tickets";
import { SuggestInput } from "@/components/suggest-input";

/** ชื่อเครื่องที่เติมให้ช่องอุปกรณ์ = ชื่อ · ยี่ห้อ รุ่น */
const matchLabel = (a: Pick<AssetMatch, "name" | "brand" | "model">) =>
  [a.name, [a.brand, a.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
import { PersonNameInput, type PersonName } from "./person-name-input";
import { DateInput } from "@/components/date-input";
import { DocumentPicker, PhotoPicker } from "@/components/file-pickers";
import { AlertIcon, CheckCircleIcon, ClipboardIcon, PenIcon, SendIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import { localToday } from "@/lib/date";
import { has } from "@/lib/permissions";
import { TICKET_TYPES, type ApprovalPlan, type TicketDetail, type TicketType, type User } from "@/lib/types";
import { PlanView } from "../../approval-routes/plan-view";
import { AppSelect } from "@/components/app-select";
import { MasterDataSelect } from "@/components/master-data-select";
import { SignaturePad } from "@/components/signature-pad";

export interface TicketFormOptions {
  branches: { id: number; code: string; name: string }[];
  /** แผนก / ฝ่าย จากข้อมูลหลัก (ชื่อ) */
  departments: string[];
  divisions: string[];
  /** ผู้อนุมัติที่เลือกได้ (ตำแหน่งสูงกว่าผู้แจ้ง) — ฟอร์มกรองตามสาขาที่เลือก */
  approvers: { id: number; name: string; branch_id: number; role: string }[];
  it_staff: { id: number; name: string; busy?: "leave" | "onsite" | null }[];
  other_types: string[];
  /** หัวข้อ "อื่นๆ" ที่เป็นการขอใช้ VPN (เลือกแล้วถามช่วงวันที่) */
  vpn_type?: string;
  /** สินทรัพย์ของผู้แจ้ง (ผู้ถือครอง / ชื่อผู้ใช้งานในทะเบียนคอมพิวเตอร์) — เลือกเครื่องที่ส่งซ่อม / ติดตั้ง */
  /** สินทรัพย์ที่ผู้แจ้งถือครอง + เครื่องส่วนกลางของสาขาที่สังกัด (is_shared) */
  my_assets: { id: string; asset_tag: string; name: string; brand: string | null; model: string | null; category: string; is_shared?: boolean }[];
  /** ขั้นตอนใบแจ้งงาน — it_first = ไม่ต้องอนุมัติ (ช่องผู้อนุมัติปิด) จนกว่า IT จะขอให้หัวหน้าอนุมัติ */
  approval_flow?: "approval_first" | "it_first";
}

type Field =
  | "type" | "type_other" | "branch_id" | "department" | "division" | "approver_id" | "details" | "due_date" | "assignee_id"
  | "person_name_th" | "person_name_en" | "device_name" | "asset_tag" | "symptom" | "photos" | "documents"
  | "vpn_start_on" | "vpn_end_on" | "signature";
type Errors = Partial<Record<Field, string>>;

type Person = { id: number; name: string };

/** ขั้นแรกที่ต้องอนุมัติของแผน (ระบบเดิม = หัวหน้าตามสาย) */
const firstApprovers = (plan: ApprovalPlan | null): Person[] =>
  !plan ? [] : plan.source === "legacy" ? (plan.legacy_approver ? [plan.legacy_approver] : []) : (plan.steps.find((s) => !s.skipped)?.approvers ?? []);

/** ผู้อนุมัติที่เลือกแทนขั้นแรก — ตรงกับ withChosenApprover ของ API */
function withApprover(plan: ApprovalPlan, approver: Person | undefined): ApprovalPlan {
  if (!approver) return plan;
  const index = plan.steps.findIndex((s) => !s.skipped);
  if (plan.source === "legacy" || index < 0) return { ...plan, legacy_approver: approver };
  return { ...plan, steps: plan.steps.map((s, i) => (i === index ? { ...s, approvers: [approver], skipped: false } : s)) };
}

/** รายการ dropdown จากข้อมูลหลัก + ค่าเดิมที่ไม่มีในรายการแล้ว (ไม่ให้ค่าหาย) */
const withCurrent = (names: string[], current: string) => (current && !names.includes(current) ? [current, ...names] : names);

/**
 * ฟอร์ม "ใบแจ้งดำเนินงาน IT"
 * เรื่อง → ข้อมูลผู้แจ้ง (สาขา → แผนก → ฝ่าย → ผู้อนุมัติ → วัตถุประสงค์) → (1.1 / 1.2) → เจ้าหน้าที่ (เจ้าหน้าที่ IT, วันที่ต้องการ) → ไฟล์แนบ → ผู้แจ้ง
 * ผู้อนุมัติ: เฉพาะคนในสาขาที่เลือกและตำแหน่งสูงกว่า — แทนขั้นแรกของสายอนุมัติ (ว่าง = ตามสาย)
 * ลายเซ็นผู้แจ้งไม่ต้องวาด — API ใช้ลายเซ็นที่อัปโหลดในข้อมูลส่วนตัว แล้วแสตมป์ลงเอกสารตอนดู/พิมพ์
 * editing = แก้ไขใบเดิม (ผู้แจ้ง ก่อนอนุมัติ) — ไม่มีส่วนไฟล์แนบ/ลายเซ็น/สายอนุมัติ
 * อื่นๆ → ขอใช้งาน VPN (vpn = เปิดจากเมนู ขอใช้ VPN): ถามวันเริ่ม/สิ้นสุด + ข้อความตั้งต้นในวัตถุประสงค์ที่เปลี่ยนวันตามที่เลือก
 */
export function TicketForm({
  user,
  options,
  plan,
  editing,
  vpn = false,
  focusApprover = false,
}: {
  user: User;
  options: TicketFormOptions;
  plan: ApprovalPlan | null;
  editing?: TicketDetail;
  vpn?: boolean;
  /** กด "เพิ่มผู้อนุมัติ" จากหน้าใบงาน — เลื่อนไปที่ช่องผู้อนุมัติ */
  focusApprover?: boolean;
}) {
  const { t, fmt } = useI18n();
  const vpnType = options.vpn_type ?? "";
  const presetVpn = vpn && !editing && Boolean(vpnType);
  const [type, setType] = useState<TicketType>(editing?.type ?? (presetVpn ? "other" : "repair"));
  // ข้อความตั้งต้นของคำขอ VPN: บรรทัดแรกมีวันที่ (เปลี่ยนตามวันที่เลือกถ้าผู้ใช้ยังไม่แก้บรรทัดนั้น) + "เนื่องจาก :"
  const vpnLine = (from: string, to: string) =>
    t("tickets.vpn.mockLine", { start: from ? fmt.date(from) : t("tickets.vpn.blank"), end: to ? fmt.date(to) : t("tickets.vpn.blank") });
  const vpnMock = (from: string, to: string) => `${vpnLine(from, to)}\n${t("tickets.vpn.mockReason")}`;

  // ผู้มีสิทธิ์อนุมัติใบของตัวเอง (ผู้จัดการขึ้นไป): ไม่เลือกผู้อนุมัติ = ใบรอตัวเองอนุมัติ (API ตั้ง approver = ผู้แจ้ง)
  const selfApprove = has(user, "tickets.approve_own");
  // ฝ่าย IT ขอให้หัวหน้าอนุมัติ → ต้องเลือกผู้อนุมัติ (ผู้อนุมัติใบตัวเองได้ = ว่างไว้ / อนุมัติเอง)
  const choosingApprover = editing?.status === "approval_requested";
  // ขั้นตอน it_first: ใบใหม่ / ใบที่ส่งถึง IT แล้ว = ไม่ต้องอนุมัติ (ช่องปิด) จนกว่า IT จะขอ
  const noApproval = !choosingApprover && (editing ? editing.status === "approved" && !editing.approved_at : options.approval_flow === "it_first");
  useEffect(() => {
    if (!focusApprover || !choosingApprover) return;
    const el = document.getElementById("approver_id");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  }, [focusApprover, choosingApprover]);
  // ผู้อนุมัติ: เลือกให้ตามสาย (ใบใหม่ — ผู้อนุมัติใบตัวเองได้ = ว่างไว้ / อนุมัติเอง) / ผู้อนุมัติเดิมของขั้นปัจจุบัน (แก้ไข) ถ้าอยู่ในรายชื่อของสาขาที่เลือก
  const preferredApprovers: Person[] = editing
    ? (editing.approval_steps.find((s) => s.step_no === editing.current_step)?.approvers ?? (editing.approver ? [editing.approver] : []))
    : selfApprove
      ? []
      : firstApprovers(plan);
  // รายชื่อจาก API = สาขาเดียวกับผู้แจ้ง + ตำแหน่งผู้จัดการขึ้นไป (approverCandidates) — ไม่ขึ้นกับสาขาที่เลือกในใบ
  const approverOptions = options.approvers;
  const pickApprover = () => {
    const list = approverOptions;
    return String(preferredApprovers.find((p) => list.some((c) => c.id === p.id))?.id ?? "");
  };
  // 4.2.2 สาขา: เลือกให้อัตโนมัติจากสาขาที่ผู้ใช้สังกัด (ถ้าสาขานั้นยังเปิดใช้งาน)
  const userBranch = options.branches.some((b) => b.id === user.branch_id) ? String(user.branch_id) : "";

  const [v, setV] = useState(() =>
    editing
      ? {
          type_other: editing.type_other ?? "",
          branch_id: editing.branch ? String(editing.branch.id) : "",
          department: editing.department ?? "",
          division: editing.division ?? "",
          approver_id: pickApprover(),
          details: editing.details ?? "",
          due_date: editing.due_date ?? "",
          assignee_id: editing.assignee ? String(editing.assignee.id) : "",
          person_name_th: editing.person_name_th ?? "",
          person_name_en: editing.person_name_en ?? "",
          device_name: editing.device_name ?? "",
          asset_tag: editing.asset_tag ?? "",
          symptom: editing.symptom ?? "",
          vpn_start_on: editing.vpn_request?.requested_from ?? "",
          vpn_end_on: editing.vpn_request?.requested_until ?? "",
        }
      : {
          type_other: presetVpn ? vpnType : "",
          branch_id: userBranch,
          department: user.department ?? "",
          division: user.division ?? "",
          approver_id: pickApprover(),
          details: presetVpn ? vpnMock(localToday(), "") : "",
          due_date: "",
          assignee_id: "",
          person_name_th: "",
          person_name_en: "",
          device_name: "",
          asset_tag: "",
          symptom: "",
          vpn_start_on: presetVpn ? localToday() : "",
          vpn_end_on: "",
        },
  );
  const [photos, setPhotos] = useState<File[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  // ยังไม่มีลายเซ็นในโปรไฟล์ — วาดในฟอร์ม (เปิดบังคับลายเซ็น = ต้องวาด และระบบเก็บไว้ในโปรไฟล์ใช้ครั้งต่อไป)
  const [drawn, setDrawn] = useState<string | null>(null);
  const needDrawn = !editing && !user.signature_url && Boolean(user.signature_required);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const needsPerson = type === "grant_access" || type === "revoke_access";
  const isVpnType = (value: string) => Boolean(vpnType) && value.trim().toLowerCase() === vpnType.toLowerCase();
  const isVpn = type === "other" && isVpnType(v.type_other);
  const isRepair = type === "repair";
  // 1.2 ข้อมูลเครื่อง: งานซ่อม (เครื่องที่ส่งซ่อม + อาการ) และงานติดตั้ง (เครื่องที่ติดตั้ง)
  const isInstall = type === "install";
  const showDevice = isRepair || isInstall;
  const myAssets = options.my_assets ?? [];
  // ติ๊ก "เลือกจากสินทรัพย์ของฉัน" — แก้ไขใบเดิมที่เลขครุภัณฑ์ตรงกับสินทรัพย์ของฉัน = ติ๊กไว้ให้
  const [useMine, setUseMine] = useState(() => myAssets.some((a) => a.asset_tag === (editing?.asset_tag ?? "")));
  const assetLabel = (a: (typeof myAssets)[number]) => [a.name, [a.brand, a.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const pickAsset = (tag: string) => {
    const a = myAssets.find((x) => x.asset_tag === tag);
    setV((s) => ({ ...s, asset_tag: a?.asset_tag ?? "", device_name: a ? assetLabel(a) : "" }));
    setErrors((e) => ({ ...e, asset_tag: "", device_name: "" }));
  };
  // ติ๊ก "อุปกรณ์ไม่มีสินทรัพย์" — ไม่ต้องกรอกรหัสสินทรัพย์ (แก้ใบซ่อมเดิมที่ไม่มีเลข = ติ๊กไว้ให้)
  const [noAsset, setNoAsset] = useState(() => Boolean(editing && (editing.type === "repair" || editing.type === "install") && !editing.asset_tag));
  // พิมพ์รหัสสินทรัพย์เอง → ตรวจว่ามีในระบบไหม (มี = ดึงชื่อเครื่องมาแสดง / ไม่มี = แจ้งว่าฝ่าย IT จะเพิ่มให้)
  const [assetCheck, setAssetCheck] = useState<{ tag: string; state: "checking" | "found" | "missing"; name?: string } | null>(null);
  const autoName = useRef("");
  const typedTag = showDevice && !useMine && !noAsset ? v.asset_tag.trim() : "";
  useEffect(() => {
    if (!typedTag) return;
    let alive = true;
    const timer = setTimeout(async () => {
      setAssetCheck({ tag: typedTag, state: "checking" });
      const found = await lookupAssetNumber(typedTag).catch(() => null);
      if (!alive) return;
      if (!found) {
        setAssetCheck({ tag: typedTag, state: "missing" });
        return;
      }
      const label = matchLabel(found);
      setAssetCheck({ tag: typedTag, state: "found", name: label });
      // เติมชื่อเครื่องเมื่อยังว่าง หรือยังเป็นชื่อที่ระบบเติมให้ครั้งก่อน (ไม่ทับที่ผู้แจ้งพิมพ์เอง)
      setV((s) => (!s.device_name.trim() || s.device_name === autoName.current ? { ...s, device_name: label } : s));
      setErrors((e) => ({ ...e, device_name: "" }));
      autoName.current = label;
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [typedTag]);
  const shownCheck = assetCheck && assetCheck.tag === typedTag ? assetCheck : null;

  const set = (name: keyof typeof v, value: string) => {
    setV((s) => ({ ...s, [name]: value }));
    setErrors((e) => ({ ...e, [name]: "" }));
  };

  // เลือกหัวข้อ "ขอใช้งาน VPN" → ใส่ข้อความตั้งต้นในวัตถุประสงค์ (เฉพาะตอนยังว่าง)
  const setTypeOther = (value: string) => {
    setV((s) => ({ ...s, type_other: value, details: isVpnType(value) && !s.details.trim() ? vpnMock(s.vpn_start_on, s.vpn_end_on) : s.details }));
    setErrors((e) => ({ ...e, type_other: "" }));
  };
  // เปลี่ยนวันที่ → บรรทัดแรกของข้อความตั้งต้นเปลี่ยนตาม (ถ้าผู้ใช้ยังไม่แก้บรรทัดนั้น)
  const setVpnDate = (name: "vpn_start_on" | "vpn_end_on", value: string) => {
    setV((s) => {
      const next = { ...s, [name]: value };
      if (name === "vpn_start_on" && value && next.vpn_end_on && next.vpn_end_on < value) next.vpn_end_on = value;
      const [first, ...rest] = s.details.split("\n");
      if (first === vpnLine(s.vpn_start_on, s.vpn_end_on)) next.details = [vpnLine(next.vpn_start_on, next.vpn_end_on), ...rest].join("\n");
      return next;
    });
    setErrors((e) => ({ ...e, vpn_start_on: "", vpn_end_on: "", details: "" }));
  };

  // สาขา → แผนก → ฝ่าย: ผู้อนุมัติไม่เปลี่ยนตามสาขาที่เลือก (รายชื่อ = สาขาของผู้แจ้งเสมอ) / ล้างแผนกแล้วล้างฝ่าย
  const changeBranch = (branch: string) => {
    setV((s) => ({ ...s, branch_id: branch }));
    setErrors((e) => ({ ...e, branch_id: "" }));
  };
  const changeDepartment = (department: string) => {
    setV((s) => ({ ...s, department, division: department ? s.division : "" }));
    setErrors((e) => ({ ...e, department: "" }));
  };

  const chosenApprover = approverOptions.find((a) => String(a.id) === v.approver_id);
  const selfPlan: ApprovalPlan = { source: "legacy", route: null, steps: [], legacy_approver: { id: user.id, name: user.name } };
  const shownPlan = selfApprove && !chosenApprover ? selfPlan : plan && withApprover(plan, chosenApprover);

  const validate = (): Errors => {
    const e: Errors = {};
    if (type === "other" && !v.type_other.trim()) e.type_other = t("tickets.validate.otherType");
    if (!v.branch_id) e.branch_id = t("tickets.validate.branch");
    if (!v.assignee_id) e.assignee_id = t("tickets.validate.assignee");
    if (!v.details.trim()) e.details = t("tickets.validate.details");
    if (needsPerson && !v.person_name_th.trim()) e.person_name_th = t("tickets.validate.nameTh");
    if (needsPerson && !v.person_name_en.trim()) e.person_name_en = t("tickets.validate.nameEn");
    if (isRepair && !v.device_name.trim()) e.device_name = t("tickets.validate.device");
    // รหัสสินทรัพย์บังคับ (ซ่อม / ติดตั้ง) เว้นแต่ติ๊ก "อุปกรณ์ไม่มีสินทรัพย์" — ติ๊กสินทรัพย์ที่ถือครองแต่ยังไม่เลือกเครื่องก็ต้องเลือกก่อน
    if (showDevice && !noAsset && !v.asset_tag.trim()) e.asset_tag = t("tickets.validate.assetTag");
    if (isRepair && !v.symptom.trim()) e.symptom = t("tickets.validate.symptom");
    if (isVpn && !v.vpn_start_on) e.vpn_start_on = t("tickets.vpn.validate.dates");
    if (needDrawn && !drawn) e.signature = t("signature.required");
    if (choosingApprover && !selfApprove && !v.approver_id) e.approver_id = t("tickets.validate.approverRequired");
    if (isVpn && !v.vpn_end_on) e.vpn_end_on = t("tickets.vpn.validate.dates");
    else if (isVpn && v.vpn_start_on && v.vpn_end_on < v.vpn_start_on) e.vpn_end_on = t("tickets.vpn.validate.order");
    return e;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    if (Object.keys(found).length) {
      setErrors(found);
      setMessage(t("common.checkInput"));
      return;
    }
    setMessage("");

    const fd = new FormData();
    fd.set("type", type);
    if (!editing && !user.signature_url && drawn) fd.set("signature", drawn);
    if (type === "other") fd.set("type_other", v.type_other.trim());
    for (const key of ["branch_id", "department", "division", "approver_id", "details", "due_date", "assignee_id"] as const) {
      // ไม่ต้องอนุมัติ (it_first) = ไม่ส่งผู้อนุมัติ
      if (key === "approver_id" && noApproval) continue;
      if (v[key].trim()) fd.set(key, v[key].trim());
    }
    if (needsPerson) {
      fd.set("person_name_th", v.person_name_th.trim());
      fd.set("person_name_en", v.person_name_en.trim());
    }
    if (showDevice) {
      if (v.device_name.trim() || isRepair) fd.set("device_name", v.device_name.trim());
      if (v.asset_tag.trim() && !noAsset) fd.set("asset_tag", v.asset_tag.trim());
    }
    if (isRepair) fd.set("symptom", v.symptom.trim());
    if (isVpn) {
      fd.set("vpn_start_on", v.vpn_start_on);
      fd.set("vpn_end_on", v.vpn_end_on);
    }
    photos.forEach((f) => fd.append("photos[]", f));
    docs.forEach((f) => fd.append("documents[]", f));

    startTransition(async () => {
      // แก้ไข: ส่งเฉพาะฟิลด์ข้อความ (ช่องที่ว่าง = ล้างค่า)
      const res = editing
        ? await updateTicket(editing.id, Object.fromEntries([...fd.entries()].filter(([k]) => !k.endsWith("[]")).map(([k, val]) => [k, String(val)])))
        : await createTicket(fd);
      if (res) {
        setErrors(mapErrors(res.errors));
        setMessage(res.message ?? "");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  };

  const field = (name: Field, label: string, control: ReactNode, required = false, hint?: ReactNode, className = "") => (
    <div className={className}>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {control}
      {errors[name] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[name]}</p> : hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  const cls = (name: Field) => `${input} ${errors[name] ? inputError : ""}`;
  const text = (name: keyof typeof v, props: Record<string, unknown> = {}) => (
    <input id={name} value={v[name]} onChange={(e) => set(name, e.target.value)} className={cls(name as Field)} {...props} />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
            <ClipboardIcon width={22} height={22} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">{editing ? t("tickets.edit.title") : t("tickets.formTitle")}</h1>
            <p className="text-sm text-muted">{editing ? `${editing.ticket_no} · ${t("tickets.edit.note")}` : fmt.date(new Date().toISOString())}</p>
          </div>
        </div>
      </div>

      {message && (
        <div role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </div>
      )}

      {shownPlan && !editing && (
        <div className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-3 sm:px-6 ${card}`}>
          <span className="flex shrink-0 items-center gap-2 text-sm font-medium">
            <CheckCircleIcon width={16} height={16} className="text-accent-500" />
            {t("tickets.approval.preview")}
          </span>
          <PlanView plan={shownPlan} />
        </div>
      )}

      <fieldset disabled={pending} className="space-y-5 transition-opacity disabled:opacity-60">
        {/* เรื่อง */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-3 font-semibold">
            {t("tickets.form.subject")} <span className="text-red-500">*</span>
          </h2>
          <div role="radiogroup" aria-label={t("tickets.form.subject")} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {TICKET_TYPES.map((ty) => (
              <label
                key={ty}
                className={`flex cursor-pointer flex-col rounded-xl p-3 ring-1 transition-colors ${
                  type === ty ? "bg-accent-50 ring-2 ring-accent-400 dark:bg-accent-400/10" : "ring-line hover:bg-subtle"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" name="type" value={ty} checked={type === ty} onChange={() => setType(ty)} className="accent-[var(--accent-500)]" />
                  {t(`tickets.types.${ty}`)}
                </span>
                {t(`tickets.typeHints.${ty}`) && <span className="ml-6 text-xs text-muted">({t(`tickets.typeHints.${ty}`)})</span>}
              </label>
            ))}
          </div>
          {type === "other" && (
            <div className="mt-3 max-w-md">
              {field(
                "type_other",
                t("tickets.form.otherType"),
                <>
                  {/* เลือกจากรายการ หรือพิมพ์เรื่องใหม่เองได้ */}
                  <MasterDataSelect source="ticket_types">
                    <input
                      id="type_other"
                      list="ticket-other-types"
                      value={v.type_other}
                      onChange={(e) => setTypeOther(e.target.value)}
                      maxLength={255}
                      placeholder={t("tickets.form.otherTypePlaceholder")}
                      className={cls("type_other")}
                    />
                  </MasterDataSelect>
                  <datalist id="ticket-other-types">
                    {options.other_types.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                  {options.other_types.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {options.other_types.map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() => setTypeOther(o)}
                          className={`cursor-pointer rounded-full px-3 py-1 text-xs ring-1 transition-colors ${
                            v.type_other === o ? "bg-accent-200 text-accent-900 ring-accent-300 dark:bg-accent-400/25 dark:text-accent-100" : "ring-line hover:bg-subtle"
                          }`}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                </>,
                true,
              )}
            </div>
          )}
          {/* ขอใช้งาน VPN: ช่วงวันที่ใช้ */}
          {isVpn && (
            <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
              {field(
                "vpn_start_on",
                t("tickets.vpn.start"),
                <DateInput id="vpn_start_on" value={v.vpn_start_on} min={editing ? undefined : localToday()} onChange={(d) => setVpnDate("vpn_start_on", d)} className={cls("vpn_start_on")} />,
                true,
              )}
              {field(
                "vpn_end_on",
                t("tickets.vpn.end"),
                <DateInput id="vpn_end_on" value={v.vpn_end_on} min={v.vpn_start_on || localToday()} onChange={(d) => setVpnDate("vpn_end_on", d)} className={cls("vpn_end_on")} />,
                true,
              )}
              <p className="col-span-2 -mt-1 text-xs text-muted">{t("tickets.vpn.hint")}</p>
            </div>
          )}
        </section>

        {/* ข้อมูลผู้แจ้ง: สาขา → แผนก → ฝ่าย → ผู้อนุมัติ → วัตถุประสงค์ */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-3 font-semibold">{t("tickets.form.requesterSection")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
              "branch_id",
              t("tickets.form.branch"),
              <MasterDataSelect source="branches">
                <AppSelect id="branch_id" value={v.branch_id} onValueChange={changeBranch} className={cls("branch_id")}>
                  <option value="">{t("tickets.form.chooseBranch")}</option>
                  {options.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </AppSelect>
              </MasterDataSelect>,
              true,
              user.branch_id ? t("tickets.form.branchAuto") : undefined,
            )}
            {field(
              "department",
              t("tickets.form.department"),
              <MasterDataSelect source="departments">
                <AppSelect id="department" value={v.department} onValueChange={changeDepartment} disabled={!v.branch_id} className={cls("department")}>
                  <option value="">{t("tickets.form.chooseDepartment")}</option>
                  {withCurrent(options.departments, v.department).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </AppSelect>
              </MasterDataSelect>,
              false,
              !v.branch_id && t("tickets.form.branchFirst"),
            )}
            {field(
              "division",
              t("tickets.form.division"),
              <MasterDataSelect source="divisions">
                <AppSelect id="division" value={v.division} onValueChange={(d) => set("division", d)} disabled={!v.department} className={cls("division")}>
                  <option value="">{t("tickets.form.chooseDivision")}</option>
                  {withCurrent(options.divisions, v.division).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </AppSelect>
              </MasterDataSelect>,
              false,
              !v.department && t("tickets.form.departmentFirst"),
            )}
            {field(
              "approver_id",
              t("tickets.form.approver"),
              <AppSelect
                id="approver_id"
                value={v.approver_id}
                onValueChange={(a) => set("approver_id", a)}
                disabled={noApproval || approverOptions.length === 0}
                className={cls("approver_id")}
              >
                <option value="">
                  {t(noApproval ? "tickets.form.approverNone" : selfApprove ? "tickets.form.approverSelf" : choosingApprover ? "tickets.form.approverChoose" : "tickets.form.approverByRoute")}
                </option>
                {approverOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({t(`roles.${a.role}` as MessageKey)})
                  </option>
                ))}
              </AppSelect>,
              choosingApprover && !selfApprove,
              noApproval
                ? t("tickets.form.approverNoneHint")
                : choosingApprover
                  ? t("tickets.form.approverRequestedHint")
                  : selfApprove
                  ? t("tickets.form.approverSelfHint")
                  : approverOptions.length === 0
                    ? t("tickets.form.noApprover")
                    : t("tickets.form.approverHint"),
            )}
            {field(
              "details",
              t("tickets.form.details"),
              <textarea id="details" rows={4} maxLength={5000} value={v.details} onChange={(e) => set("details", e.target.value)} className={cls("details")} />,
              true,
              undefined,
              "sm:col-span-2",
            )}
          </div>
        </section>

        {/* 1.1 เพิ่ม/ระงับสิทธิ์ */}
        {needsPerson && (
          <section className={`p-4 sm:p-6 ${card}`}>
            <h2 className="mb-3 font-semibold">{t("tickets.form.section11")}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(["th", "en"] as const).map((side) => {
                const name = side === "th" ? "person_name_th" : "person_name_en";
                // เลือกชื่อจากรายการฝั่งใดฝั่งหนึ่ง → เติมทั้งชื่อไทยและอังกฤษ (ฝั่งที่ไม่ทราบ = คงค่าเดิม)
                const pickPerson = (p: PersonName) => {
                  setV((s) => ({ ...s, person_name_th: p.th || s.person_name_th, person_name_en: p.en || s.person_name_en }));
                  setErrors((e) => ({ ...e, ...(p.th ? { person_name_th: "" } : {}), ...(p.en ? { person_name_en: "" } : {}) }));
                };
                return (
                  <div key={side}>
                    {field(
                      name,
                      t(side === "th" ? "tickets.form.nameTh" : "tickets.form.nameEn"),
                      <PersonNameInput
                        id={name}
                        side={side}
                        value={v[name]}
                        onChange={(value) => set(name, value)}
                        onPick={pickPerson}
                        className={cls(name)}
                        lang={side === "en" ? "en" : undefined}
                      />,
                      true,
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 1.2 เครื่องที่ส่งซ่อม (งานซ่อม) / เครื่องที่ติดตั้ง (งานติดตั้ง) — ติ๊กเลือกจากสินทรัพย์ของตัวเองได้ */}
        {showDevice && (
          <section className={`p-4 sm:p-6 ${card}`}>
            <h2 className="mb-3 font-semibold">{t(isRepair ? "tickets.form.section12" : "tickets.form.section12Install")}</h2>
            <div className="mb-4 space-y-2">
              {/* บรรทัดเดียวกัน: อุปกรณ์ไม่มีสินทรัพย์ (ลำดับแรก) · สินทรัพย์ของฉัน (ไม่มี = ข้อความแจ้ง) — เลือกได้อย่างใดอย่างหนึ่ง */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={noAsset}
                    onChange={(e) => {
                      setNoAsset(e.target.checked);
                      if (e.target.checked) {
                        if (useMine) setV((s) => ({ ...s, device_name: "" }));
                        setUseMine(false);
                        setV((s) => ({ ...s, asset_tag: "" }));
                      }
                      setErrors((x) => ({ ...x, asset_tag: "" }));
                    }}
                    className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                  />
                  {t("tickets.form.noAsset")}
                </label>
                {myAssets.length > 0 ? (
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={useMine}
                      onChange={(e) => {
                        setUseMine(e.target.checked);
                        if (e.target.checked) setNoAsset(false);
                        setV((s) => ({ ...s, asset_tag: "", device_name: "" }));
                        setErrors((x) => ({ ...x, asset_tag: "", device_name: "" }));
                      }}
                      className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                    />
                    {t("tickets.form.useMyAssets")}
                    <span className="font-normal text-muted">{t("tickets.form.myAssetsCount", { count: fmt.number(myAssets.length) })}</span>
                  </label>
                ) : (
                  // ยังไม่มีเครื่องที่ถือครอง / เครื่องส่วนกลางของสาขา — ช่องติ๊กสีเทากดไม่ได้
                  <label className="flex w-fit cursor-not-allowed items-center gap-2 text-sm text-faint">
                    <input type="checkbox" disabled checked={false} readOnly className="h-4 w-4 cursor-not-allowed opacity-60" />
                    {t("tickets.form.noMyAssets")}
                  </label>
                )}
              </div>
              {/* แยก 2 รายการ: เครื่องส่วนตัว (ถือครอง) / เครื่องส่วนกลางของสาขา — เลือกได้เครื่องเดียว (เลือกฝั่งหนึ่ง = อีกฝั่งว่าง) */}
              {useMine && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {([false, true] as const).map((shared) => {
                    const list = myAssets.filter((a) => Boolean(a.is_shared) === shared);
                    const selected = list.some((a) => a.asset_tag === v.asset_tag) ? v.asset_tag : "";
                    const label = t(shared ? "tickets.form.sharedAssets" : "tickets.form.personalAssets");
                    return (
                      <div key={String(shared)}>
                        <p className="mb-1 text-xs font-medium text-muted">
                          {label} <span className="font-normal">{t("tickets.form.myAssetsCount", { count: fmt.number(list.length) })}</span>
                        </p>
                        <AppSelect value={selected} onValueChange={pickAsset} disabled={list.length === 0} className={`${input} disabled:cursor-not-allowed disabled:bg-subtle`} aria-label={label}>
                          <option value="">{t(list.length ? "tickets.form.chooseAsset" : "tickets.form.noAssetsInList")}</option>
                          {list.map((a) => (
                            <option key={a.id} value={a.asset_tag}>
                              {`${a.asset_tag} — ${assetLabel(a)}`}
                            </option>
                          ))}
                        </AppSelect>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field(
                "device_name",
                t(isRepair ? "tickets.form.device" : "tickets.form.deviceInstall"),
                // เลือกจากสินทรัพย์ที่ถือครอง = ระบบเติมให้ ไม่ต้องกรอก
                text("device_name", { maxLength: 255, disabled: useMine, className: `${cls("device_name")} disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted` }),
                isRepair && !useMine,
              )}
              {field(
                "asset_tag",
                t("tickets.form.assetTag"),
                useMine || noAsset ? (
                  text("asset_tag", {
                    maxLength: 50,
                    disabled: true,
                    className: `${cls("asset_tag")} font-mono disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted`,
                  })
                ) : (
                  // พิมพ์แล้วแสดงสินทรัพย์ที่ตรง/เกี่ยวข้อง → เลือกแล้วเติมรหัส + อุปกรณ์ที่ส่งซ่อม (การตรวจ "พบในระบบ" ด้านล่างทำงานตามเดิม)
                  <SuggestInput<AssetMatch>
                    id="asset_tag"
                    value={v.asset_tag}
                    onChange={(value) => set("asset_tag", value)}
                    load={async (q) =>
                      (await searchAssetNumbers(q).catch(() => [])).map((a) => ({
                        value: a.asset_tag,
                        hint: [a.cpu_tag && a.cpu_tag !== a.asset_tag ? a.cpu_tag : "", matchLabel(a)].filter(Boolean).join(" · "),
                        data: a,
                      }))
                    }
                    onPick={(item) => {
                      const label = item.data ? matchLabel(item.data) : "";
                      autoName.current = label;
                      setV((s) => ({ ...s, asset_tag: item.value, device_name: label || s.device_name }));
                      setErrors((x) => ({ ...x, asset_tag: "", device_name: "" }));
                    }}
                    allowNew={false}
                    maxLength={50}
                    className={`${cls("asset_tag")} font-mono`}
                  />
                ),
                !noAsset,
                shownCheck &&
                  (shownCheck.state === "checking" ? (
                    t("tickets.form.assetChecking")
                  ) : shownCheck.state === "found" ? (
                    <span className="inline-flex items-center gap-1 text-success-600 dark:text-success-400">
                      <CheckCircleIcon width={13} height={13} />
                      {t("tickets.form.assetFound", { name: shownCheck.name ?? "" })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-warning-700 dark:text-warning-300">
                      <AlertIcon width={13} height={13} />
                      {t("tickets.form.assetMissing")}
                    </span>
                  )),
              )}
              {isRepair && field(
                "symptom",
                t("tickets.form.symptom"),
                <textarea id="symptom" rows={3} maxLength={5000} value={v.symptom} onChange={(e) => set("symptom", e.target.value)} className={cls("symptom")} />,
                true,
                undefined,
                "sm:col-span-2",
              )}
            </div>
          </section>
        )}

        {/* เจ้าหน้าที่: ต้องระบุเจ้าหน้าที่ IT + วันที่ต้องการให้แล้วเสร็จ */}
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-3 font-semibold">{t("tickets.form.staffSection")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
              "assignee_id",
              t("tickets.form.assignee"),
              <AppSelect id="assignee_id" value={v.assignee_id} onValueChange={(a) => set("assignee_id", a)} className={cls("assignee_id")}>
                <option value="">{t("tickets.form.chooseIt")}</option>
                {options.it_staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {/* วันนี้ลา / ออกหน้างาน — เตือนผู้แจ้งก่อนเลือก */}
                    {s.busy ? `${s.name} (${t(s.busy === "leave" ? "calendar.busyLeave" : "calendar.busyOnsite")})` : s.name}
                  </option>
                ))}
              </AppSelect>,
              true,
              t("tickets.form.assigneeHint"),
            )}
            {field("due_date", t("tickets.form.dueDate"), <DateInput id="due_date" min={localToday()} value={v.due_date} onChange={(d) => set("due_date", d)} className={cls("due_date")} />)}
          </div>
        </section>

        {/* ไฟล์แนบ */}
        {!editing && (
        <section className={`grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-2 ${card}`}>
          <div>
            <h2 className="mb-2 font-semibold">{t("tickets.form.photos")}</h2>
            <PhotoPicker files={photos} onChange={setPhotos} max={4} onError={setMessage} />
            {errors.photos && <p className="mt-1 text-xs font-medium text-red-500">{errors.photos}</p>}
          </div>
          <div>
            <h2 className="mb-2 font-semibold">{t("tickets.form.documents")}</h2>
            <DocumentPicker files={docs} onChange={setDocs} max={5} onError={setMessage} />
            {errors.documents && <p className="mt-1 text-xs font-medium text-red-500">{errors.documents}</p>}
          </div>
        </section>
        )}

        {/* 4.2.7 ผู้แจ้ง — ใช้ลายเซ็นที่อัปโหลดไว้ในข้อมูลส่วนตัว (แสตมป์ตอนดู/พิมพ์เอกสาร) */}
        {!editing && (
        <section className={`p-4 sm:p-6 ${card}`}>
          <h2 className="mb-3 font-semibold">
            {t("tickets.form.requester")}: <span className="font-normal">{user.name}</span>
          </h2>
          {user.signature_url ? (
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex h-20 w-64 items-end justify-center border-b border-dashed border-line pb-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- ลายเซ็นจาก private storage ผ่าน /files */}
                <img src={`/files${user.signature_url}`} alt={t("signature.label")} className="max-h-full max-w-full object-contain dark:invert" />
              </div>
              <div className="space-y-1 text-sm">
                <p className="text-muted">{t("tickets.form.signatureStamp")}</p>
                <Link href="/profile" className="inline-flex cursor-pointer items-center gap-1 text-accent-700 hover:underline dark:text-accent-300">
                  <PenIcon width={14} height={14} />
                  {t("tickets.form.signatureManage")}
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                {t(user.signature_required ? "tickets.form.signatureDrawRequired" : "tickets.form.signatureDraw")}
                {user.signature_required && <span className="text-red-500"> *</span>}
              </p>
              {/* กล่องวาดลายเซ็นขนาดพอดีลายเซ็น ไม่ต้องกว้างเต็มการ์ด */}
              <div className="w-full max-w-md">
                <SignaturePad
                  saveToProfile
                  invalid={Boolean(errors.signature)}
                  onChange={(s) => {
                    setDrawn(s);
                    if (s) setErrors((x) => ({ ...x, signature: undefined }));
                  }}
                />
              </div>
              {errors.signature && <p className="text-xs font-medium text-red-500">{errors.signature}</p>}
              <Link href="/profile" className="inline-flex cursor-pointer items-center gap-1 text-xs text-accent-700 hover:underline dark:text-accent-300">
                <PenIcon width={14} height={14} />
                {t("profile.signatureUpload")}
              </Link>
            </div>
          )}
        </section>
        )}
      </fieldset>

      <div className="flex justify-end gap-2">
        <Link href={editing ? `/tickets/${editing.id}` : "/tickets"} className={btn.secondary}>
          <XIcon className="text-faint" />
          {t("common.cancel")}
        </Link>
        <button type="submit" disabled={pending} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SendIcon />}
          {pending ? t("tickets.form.submitting") : editing ? t("tickets.edit.save") : t("tickets.form.submit")}
        </button>
      </div>
    </form>
  );
}

/** error จาก Laravel เช่น "photos.0" → แสดงที่ช่อง photos */
function mapErrors(errors?: Partial<Record<string, string>>): Errors {
  const out: Errors = {};
  for (const [key, msg] of Object.entries(errors ?? {})) {
    const base = key.split(".")[0] as Field;
    if (!out[base] && msg) out[base] = msg;
  }
  return out;
}
