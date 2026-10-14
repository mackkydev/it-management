import "server-only";

import { cookies } from "next/headers";
import { apiFetch } from "@/lib/api";
import type { BookingKind, BookingScopeMeta, BranchChoices } from "@/lib/types";

/**
 * ห้องประชุม / รถ ตามสาขา — ขอบเขตตั้งต่อกลุ่มสิทธิ์ที่หน้า /role-permissions (API กรองให้เสมอ)
 * ขอบเขต all เลือกดูสาขาได้: จำค่าใน cookie (components/branch-filter.tsx ตั้งให้) — ไม่ตั้ง = สาขาของผู้ใช้
 */
export const BRANCH_COOKIE: Record<BookingKind, string> = { meeting: "eam_branch_meeting", vehicle: "eam_branch_vehicle" };

const FALLBACK: BookingScopeMeta = { scope: "branch", branch_id: null, branches: [] };

export async function getBookingScope(kind: BookingKind): Promise<BookingScopeMeta> {
  return apiFetch<{ data: BookingScopeMeta }>(`/booking-scope/me?kind=${kind}`)
    .then((r) => r.data)
    .catch(() => FALLBACK);
}

/** สาขาที่เลือกดูอยู่ (null = ทุกสาขา / ขอบเขตสาขาตัวเอง — API กรองเอง) */
export async function selectedBranch(kind: BookingKind, meta?: BookingScopeMeta): Promise<number | null> {
  const m = meta ?? (await getBookingScope(kind));
  if (m.scope !== "all") return null;
  const raw = (await cookies()).get(BRANCH_COOKIE[kind])?.value;
  if (raw === "all") return null;
  const id = Number(raw);
  if (m.branches.some((b) => b.id === id)) return id;
  return m.branches.some((b) => b.id === m.branch_id) ? m.branch_id : null;
}

/** query string ของสาขาที่เลือก (ต่อท้าย URLSearchParams ได้เลย) */
export const branchQuery = (branch: number | null): Record<string, string> => (branch ? { branch_id: String(branch) } : {});

/** ขอบเขต all = ทุกสาขา + ใช้ร่วมกันได้, ขอบเขต branch = สาขาตัวเองเท่านั้น (API ตรวจซ้ำ) */
export async function branchChoices(kind: BookingKind): Promise<BranchChoices> {
  const [meta, all] = await Promise.all([getBookingScope(kind), apiFetch<{ data: { id: number; name: string }[] }>("/branches").then((r) => r.data)]);
  const branches = all.map((b) => ({ id: b.id, name: b.name }));
  if (meta.scope === "all") return { branches, allowShared: true, defaultId: meta.branch_id };
  return { branches: branches.filter((b) => b.id === meta.branch_id), allowShared: false, defaultId: meta.branch_id };
}
