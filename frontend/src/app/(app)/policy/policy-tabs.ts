/** ปุ่มแท็บของหน้านโยบาย */
export const TAB_CLS = (active: boolean) =>
  `flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;
