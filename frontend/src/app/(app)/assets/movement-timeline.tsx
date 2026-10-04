import { BoxIcon, HistoryIcon, MapPinIcon, TruckIcon, UserIcon } from "@/components/icons";
import { card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { AssetMovement } from "@/lib/types";

/** ใช้สีความหมายของระบบ (ไม่ใช่สีธีม): ลงทะเบียน = success, โอนย้าย = info */
export const MOVEMENT_STYLE: Record<AssetMovement["type"], { badge: string; dot: string; Icon: typeof BoxIcon }> = {
  registered: { badge: tone.success.badge, dot: tone.success.badge, Icon: BoxIcon },
  transfer: { badge: tone.info.badge, dot: tone.info.badge, Icon: TruckIcon },
};

const locLabel = (l: AssetMovement["to_location"]) => (l ? `${l.name} (${l.code})` : null);

/** แถว "จาก → ไป" แสดงเฉพาะเมื่อค่าเปลี่ยน */
function Change({ icon, label, from, to, none }: { icon: React.ReactNode; label: string; from: string | null; to: string | null; none: string }) {
  if (from === to) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
      <span className="flex items-center gap-1 text-muted">
        {icon}
        {label}:
      </span>
      {from !== null && (
        <>
          <span className="text-muted line-through decoration-faint">{from}</span>
          <span className="text-accent-400" aria-hidden="true">
            →
          </span>
        </>
      )}
      <span className="font-medium text-ink">{to ?? none}</span>
    </div>
  );
}

/** รายละเอียดการเปลี่ยนแปลงของ 1 รายการ (ใช้ทั้ง timeline และตารางรายงานรวม) */
export async function MovementChanges({ m }: { m: AssetMovement }) {
  const { t } = await getI18n();
  const registered = m.type === "registered";
  return (
    <div className="space-y-1">
      <Change
        icon={<MapPinIcon width={13} height={13} />}
        label={t("movements.location")}
        from={registered ? null : locLabel(m.from_location)}
        to={locLabel(m.to_location)}
        none={t("common.none")}
      />
      <Change
        icon={<UserIcon width={13} height={13} />}
        label={t("movements.custodian")}
        from={registered ? null : (m.from_custodian?.name ?? null)}
        to={m.to_custodian?.name ?? null}
        none={t("common.none")}
      />
      {m.reason && <p className="text-sm text-muted">{t("movements.reason", { reason: m.reason })}</p>}
    </div>
  );
}

export async function MovementTimeline({ movements, total }: { movements: AssetMovement[]; total: number }) {
  const { t, fmt } = await getI18n();
  return (
    <section className={`p-4 sm:p-6 ${card}`}>
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
          <HistoryIcon width={15} height={15} />
        </span>
        {t("movements.title")}
        <span className="text-sm font-normal text-muted">{t("movements.count", { count: fmt.number(total) })}</span>
      </h2>

      {movements.length === 0 ? (
        <p className="text-sm text-muted">{t("movements.empty")}</p>
      ) : (
        <ol className="relative space-y-5 border-l-2 border-accent-100 pl-6 dark:border-accent-400/20">
          {movements.map((m) => {
            const style = MOVEMENT_STYLE[m.type];
            return (
              <li key={m.id} className="relative">
                <span
                  className={`absolute -left-[37px] top-0 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-surface ${style.dot}`}
                >
                  <style.Icon width={14} height={14} />
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>{m.type_label}</span>
                  <time dateTime={m.moved_at} className="text-sm text-muted">
                    {fmt.dateTime(m.moved_at)}
                  </time>
                </div>
                <div className="mt-1.5">
                  <MovementChanges m={m} />
                  {m.performed_by && <p className="mt-1 text-xs text-faint">{t("movements.by", { name: m.performed_by.name })}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
