"use client";

import { useState, useTransition } from "react";
import { clearFixedAssets, saveFixedAssetSettings, startFixedAssetSync, testFixedAssetConnection } from "@/app/actions/fixed-assets";
import { useConfirm } from "@/components/dialog-provider";
import { ChipList } from "@/components/chip-list";
import { CheckCircleIcon, DatabaseIcon, ResetIcon, SaveIcon, SpinnerIcon, AlertIcon, TrashIcon } from "@/components/icons";
import { ResultToast } from "@/components/toast";
import { alert, btn, card, input, inputError, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { FixedAssetConnectionTest, FixedAssetSyncRun, FixedAssetSyncSettings } from "@/lib/types";

/** รหัสหมวดสินทรัพย์ (faclass) ที่รู้จักชื่อ — ใช้เป็นตัวเลือกเมื่อยังไม่เคยซิงค์ (หลังซิงค์ใช้รหัสที่พบจริงจาก source_codes) */
const CLASS_SUGGESTIONS = ["OFFI", "INTA", "STEQ", "SIMA", "MACH", "VEHI", "LINV", "ROLV", "BLDG", "LAND", "UTIL"] as const;
const CODE_RE = /^[A-Z0-9_-]{1,20}$/;
const SITE_RE = /^[A-Z0-9]{1,8}$/;

const RUN_TONE = { ok: tone.success.badge, partial: tone.warning.badge, failed: tone.danger.badge, running: tone.info.badge } as const;

/**
 * ตั้งค่าระบบ → SyteLine Fixed Assets: สวิตช์ซิงค์อัตโนมัติ, path ของรายงาน, ขอบเขต (สาขา / แผนก / หมวด), ทดสอบการเชื่อมต่อ, ซิงค์ตอนนี้, ประวัติ
 * บัญชี/รหัสผ่านของ API ตั้งใน .env ของ API เท่านั้น — หน้านี้แสดงแค่ว่าตั้งแล้วหรือยัง
 */
export function FixedAssetSync({
  initial,
  runs,
  canSync,
  pager,
}: {
  initial: FixedAssetSyncSettings;
  runs: FixedAssetSyncRun[];
  canSync: boolean;
  /** แถบเปลี่ยนหน้าของประวัติการซิงค์ (หน้าละ 10 รอบ — server component) */
  pager?: React.ReactNode;
}) {
  const { t, fmt } = useI18n();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok?: boolean; message?: string } | null>(null);
  const [test, setTest] = useState<FixedAssetConnectionTest | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"save" | "test" | "sync" | "clear_unlinked" | "clear_all" | null>(null);
  const confirm = useConfirm();

  /** ล้าง error ของช่องทันทีเมื่อผู้ใช้แก้ */
  const clearError = (key: string) =>
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  const set = <K extends keyof FixedAssetSyncSettings>(k: K, value: FixedAssetSyncSettings[K]) => {
    setV({ ...v, [k]: value });
    clearError(k);
  };
  const setPath = (value: string) => {
    setV({ ...v, paths: { info: value } });
    clearError("paths.info");
  };

  const run = (kind: NonNullable<typeof busy>, fn: () => Promise<void>) =>
    start(async () => {
      setBusy(kind);
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });

  const save = () =>
    run("save", async () => {
      const res = await saveFixedAssetSettings({
        enabled: v.enabled,
        sites: v.sites,
        departments: v.departments,
        classes: v.classes,
        include_inactive: v.include_inactive,
        time: v.time,
        paths: v.paths,
      });
      setErrors((res.errors ?? {}) as Record<string, string>);
      setResult(res);
    });

  const testConn = () =>
    run("test", async () => {
      const res = await testFixedAssetConnection();
      if (res.data) setTest(res.data);
      else setResult(res);
    });

  /** ลบข้อมูลที่ซิงค์แล้ว (ถามยืนยันพร้อมจำนวน) แล้วกดซิงค์ใหม่ได้ */
  const clear = async (scope: "unlinked" | "all") => {
    const { total, linked } = initial.synced;
    const n = scope === "all" ? total : total - linked;
    const msg = scope === "all"
      ? t("fixedAssetSync.clearAllConfirm", { n: fmt.number(n), linked: fmt.number(linked) })
      : t("fixedAssetSync.clearUnlinkedConfirm", { n: fmt.number(n) });
    if (!(await confirm(msg, { confirmText: t("common.delete") }))) return;
    run(scope === "all" ? "clear_all" : "clear_unlinked", async () => {
      setResult(await clearFixedAssets(scope));
    });
  };

  const syncNow = () =>
    run("sync", async () => {
      setResult(await startFixedAssetSync());
    });

  const code = (re: RegExp, list: string[]) => (raw: string) => {
    const x = raw.trim().toUpperCase();
    if (!re.test(x)) return t("fixedAssetSync.codeInvalid");
    return list.includes(x) ? t("fixedAssetSync.duplicate") : null;
  };
  const upper = (items: string[]) => [...new Set(items.map((x) => x.trim().toUpperCase()))];
  const err = (k: string) => errors[k] && <p className="mt-1 text-xs text-red-500">{errors[k]}</p>;
  const field = (k: string) => (errors[k] ? `${input} ${inputError}` : input);
  const label = "mb-1 block text-sm font-medium";
  const conn = v.connection;
  const known = (c: string): c is (typeof CLASS_SUGGESTIONS)[number] => (CLASS_SUGGESTIONS as readonly string[]).includes(c);

  /** ตัวเลือกจากรอบซิงค์ล่าสุด (รหัส + จำนวนรายการ) — กดเพื่อเพิ่ม; ยังไม่เคยซิงค์ = fallback */
  const suggestions = (
    key: "departments" | "classes",
    found: Record<string, number> | undefined,
    fallback: readonly string[],
  ) => {
    const selected = v[key];
    const list = found ? Object.entries(found).sort(([, a], [, b]) => b - a) : fallback.map((c) => [c, null] as const);
    const rest = list.filter(([c]) => !selected.includes(c));
    if (rest.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">{t("fixedAssetSync.quickAdd")}</span>
        {rest.map(([c, n]) => (
          <button
            key={c}
            type="button"
            onClick={() => set(key, [...selected, c])}
            className="cursor-pointer rounded-full bg-subtle px-2.5 py-0.5 text-xs hover:bg-accent-100 hover:text-accent-900 dark:hover:bg-accent-400/15 dark:hover:text-accent-100"
          >
            + {c}
            {key === "classes" && known(c) && <span className="text-muted"> {t(`fixedAssetSync.classNames.${c}`)}</span>}
            {n !== null && <span className="text-muted"> ({fmt.number(n)})</span>}
          </button>
        ))}
      </div>
    );
  };
  const codesNote = v.source_codes
    ? t("fixedAssetSync.codesFrom", { at: fmt.dateTime(v.source_codes.at) })
    : t("fixedAssetSync.codesNotYet");

  return (
    <div className="space-y-5">
      {result?.message && <ResultToast result={result} />}

      <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-semibold">
              <DatabaseIcon className="text-accent-500" />
              {t("fixedAssetSync.title")}
            </h2>
            <p className="mt-1 text-sm text-muted">{t("fixedAssetSync.hint")}</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <button
              type="button"
              role="switch"
              aria-checked={v.enabled}
              aria-label={t("fixedAssetSync.enabled")}
              onClick={() => set("enabled", !v.enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${v.enabled ? "bg-accent-500" : "bg-line"}`}
            >
              <span className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${v.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
            {t("fixedAssetSync.enabled")}
          </label>
        </div>

        {/* การเชื่อมต่อ (ค่าจาก .env ของ API — แก้ที่หน้านี้ไม่ได้) */}
        <div className="rounded-xl bg-subtle p-3 text-sm sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{t("fixedAssetSync.connection")}</p>
              {conn.configured ? (
                <p className="text-muted">
                  {t("fixedAssetSync.connectionInfo", { host: conn.host ?? "—", user: conn.username ?? "—" })}
                </p>
              ) : (
                <p className="text-warning-700 dark:text-warning-300">{t("fixedAssetSync.notConfigured")}</p>
              )}
              <p className="text-xs text-muted">{t("fixedAssetSync.envHint")}</p>
            </div>
            <button type="button" onClick={testConn} disabled={pending || !conn.configured} className={`${btn.secondary} ${btn.sm}`}>
              {busy === "test" ? <SpinnerIcon width={14} height={14} /> : <CheckCircleIcon width={14} height={14} />}
              {t("fixedAssetSync.test")}
            </button>
          </div>
          {test && (
            <ul className="mt-3 space-y-1 text-xs">
              {(
                [
                  ["health", test.health],
                  ["login", test.login],
                  ["appIds", test.app_ids !== null],
                ] as const
              ).map(([k, ok]) => (
                <li key={k} className="flex items-center gap-1.5">
                  {ok ? <CheckCircleIcon width={13} height={13} className={tone.success.icon} /> : <AlertIcon width={13} height={13} className={tone.danger.icon} />}
                  {t(`fixedAssetSync.testSteps.${k}`)}
                  {k === "appIds" && test.app_ids && <span className="text-muted">{test.app_ids.length ? test.app_ids.join(", ") : "—"}</span>}
                </li>
              ))}
              {test.error && (
                <li className="text-danger-700 dark:text-danger-300">
                  {t("fixedAssetSync.testError", { error: test.error, status: test.status ?? "—" })}
                </li>
              )}
            </ul>
          )}
        </div>

        <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
          {/* path ของ API Fixed assets info (คู่มือข้อ 3.27) — API เดียวที่เรียก */}
          <div className="lg:max-w-xl">
            <label htmlFor="fa-path-info" className={label}>{t("fixedAssetSync.pathInfo")}</label>
            <input
              id="fa-path-info"
              value={v.paths.info}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/api/v1/reports/fainfo"
              className={field("paths.info")}
            />
            {err("paths.info")}
            <p className="mt-1 text-xs text-muted">{t("fixedAssetSync.pathInfoHint")}</p>
          </div>

          {/* ขอบเขตข้อมูล */}
          <div>
            <p className={label}>{t("fixedAssetSync.sites")}</p>
            <ChipList
              items={v.sites}
              onChange={(items) => set("sites", upper(items))}
              placeholder="HO"
              addLabel={t("fixedAssetSync.addCode")}
              validate={code(SITE_RE, v.sites)}
              grid
            />
            {err("sites")}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className={label}>{t("fixedAssetSync.departments")}</p>
              <ChipList
                items={v.departments}
                onChange={(items) => set("departments", upper(items))}
                placeholder="IT"
                addLabel={t("fixedAssetSync.addCode")}
                emptyText={t("fixedAssetSync.allDepartments")}
                validate={code(CODE_RE, v.departments)}
              />
              {err("departments")}
              {suggestions("departments", v.source_codes?.departments, [])}
              <p className="mt-1 text-xs text-muted">{t("fixedAssetSync.departmentsHint")}</p>
              <p className="mt-1 text-xs text-muted">{codesNote}</p>
            </div>
            <div>
              <p className={label}>{t("fixedAssetSync.classes")}</p>
              <ChipList
                items={v.classes}
                onChange={(items) => set("classes", upper(items))}
                placeholder="OFFI"
                addLabel={t("fixedAssetSync.addCode")}
                emptyText={t("fixedAssetSync.allClasses")}
                validate={code(CODE_RE, v.classes)}
              />
              {err("classes")}
              {suggestions("classes", v.source_codes?.classes, CLASS_SUGGESTIONS)}
              <p className="mt-1 text-xs text-muted">{t("fixedAssetSync.classesHint")}</p>
              <p className="mt-1 text-xs text-muted">{codesNote}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fa-time" className={label}>{t("fixedAssetSync.time")}</label>
              <input id="fa-time" type="time" value={v.time} onChange={(e) => set("time", e.target.value)} className={`${field("time")} max-w-40`} />
              {err("time")}
            </div>
            <label className="flex cursor-pointer items-start gap-2 self-center text-sm">
              <input
                type="checkbox"
                checked={v.include_inactive}
                onChange={(e) => set("include_inactive", e.target.checked)}
                className="mt-0.5 cursor-pointer accent-[var(--accent-500)]"
              />
              <span>
                {t("fixedAssetSync.includeInactive")}
                <span className="block text-xs text-muted">{t("fixedAssetSync.includeInactiveHint")}</span>
              </span>
            </label>
          </div>
        </fieldset>

        {v.enabled && !v.paths.info &&<p className={alert.warning}>{t("fixedAssetSync.needPath")}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          {canSync && (
            <button type="button" onClick={syncNow} disabled={pending || !initial.ready} aria-busy={busy === "sync"} className={btn.secondary}>
              {busy === "sync" ? <SpinnerIcon /> : <ResetIcon />}
              {t("fixedAssetSync.syncNow")}
            </button>
          )}
          <button type="button" onClick={save} disabled={pending} aria-busy={busy === "save"} className={btn.primary}>
            {busy === "save" ? <SpinnerIcon /> : <SaveIcon />}
            {busy === "save" ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </section>

      {/* ลบข้อมูลที่ซิงค์แล้ว เพื่อซิงค์ใหม่ (fixed_assets.sync) — ไม่แตะสินทรัพย์ในระบบ / ประวัติการซิงค์ */}
      {canSync && (
        <section className={`space-y-3 p-4 sm:p-6 ${card}`}>
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <TrashIcon className="text-danger-500" />
              {t("fixedAssetSync.clearTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("fixedAssetSync.clearHint", { total: fmt.number(initial.synced.total), linked: fmt.number(initial.synced.linked) })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => clear("unlinked")}
              disabled={pending || initial.synced.total - initial.synced.linked === 0}
              aria-busy={busy === "clear_unlinked"}
              className={btn.secondary}
            >
              {busy === "clear_unlinked" ? <SpinnerIcon /> : <TrashIcon />}
              {t("fixedAssetSync.clearUnlinked", { n: fmt.number(initial.synced.total - initial.synced.linked) })}
            </button>
            <button
              type="button"
              onClick={() => clear("all")}
              disabled={pending || initial.synced.total === 0}
              aria-busy={busy === "clear_all"}
              className={btn.danger}
            >
              {busy === "clear_all" ? <SpinnerIcon /> : <TrashIcon />}
              {t("fixedAssetSync.clearAll", { n: fmt.number(initial.synced.total) })}
            </button>
          </div>
        </section>
      )}

      {/* ประวัติการซิงค์ — หน้าละ 10 รอบ */}
      <section className={`space-y-3 p-4 sm:p-6 ${card}`}>
        <h2 className="font-semibold">{t("fixedAssetSync.history")}</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted">{t("fixedAssetSync.noRuns")}</p>
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>{t("fixedAssetSync.runStarted")}</th>
                  <th className={table.th}>{t("fixedAssetSync.runStatus")}</th>
                  <th className={table.th}>{t("fixedAssetSync.runResult")}</th>
                  <th className={table.th}>{t("fixedAssetSync.runBy")}</th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {runs.map((r) => {
                  const sites = Object.entries(r.stats ?? {}).filter(([k]) => !k.startsWith("_")) as [string, NonNullable<FixedAssetSyncRun["stats"]>[string]][];
                  const sum = (k: "fetched" | "inserted" | "updated" | "missing") => sites.reduce((n, [, s]) => n + (typeof s === "object" ? s[k] : 0), 0);
                  const failed = sites.filter(([, s]) => typeof s === "object" && s.error).map(([k]) => k);
                  return (
                    <tr key={r.id} className={table.row}>
                      <td className={`${table.td} whitespace-nowrap`}>{fmt.dateTime(r.started_at)}</td>
                      <td className={table.td}>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RUN_TONE[r.status]}`}>{t(`fixedAssetSync.runStatuses.${r.status}`)}</span>
                      </td>
                      <td className={`${table.td} text-xs`}>
                        {r.status === "running" ? (
                          "—"
                        ) : (
                          <>
                            {t("fixedAssetSync.runSummary", {
                              fetched: fmt.number(sum("fetched")),
                              inserted: fmt.number(sum("inserted")),
                              updated: fmt.number(sum("updated")),
                              missing: fmt.number(sum("missing")),
                              linked: fmt.number(Number(r.stats?._linked ?? 0)),
                            })}
                            {failed.length > 0 && <span className="block text-warning-700 dark:text-warning-300">{t("fixedAssetSync.runSitesFailed", { sites: failed.join(", ") })}</span>}
                            {r.error && <span className="block text-danger-700 dark:text-danger-300">{r.error}</span>}
                          </>
                        )}
                      </td>
                      <td className={`${table.td} text-xs text-muted`}>{r.trigger === "schedule" ? t("fixedAssetSync.bySchedule") : (r.triggered_by ?? "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pager}
      </section>
    </div>
  );
}
