"use client";

import { useState, useTransition } from "react";
import { saveFixedAssetSettings, startFixedAssetSync, testFixedAssetConnection } from "@/app/actions/fixed-assets";
import { ChipList } from "@/components/chip-list";
import { CheckCircleIcon, DatabaseIcon, ResetIcon, SaveIcon, SpinnerIcon, AlertIcon } from "@/components/icons";
import { ResultToast } from "@/components/toast";
import { alert, btn, card, input, inputError, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { FixedAssetConnectionTest, FixedAssetSyncRun, FixedAssetSyncSettings } from "@/lib/types";

/** รหัสหมวดสินทรัพย์ (faclass) ที่พบในรายงานของ SyteLine — กดเพื่อเพิ่มเร็ว (พิมพ์รหัสอื่นเองได้) */
const CLASS_SUGGESTIONS = ["OFFI", "INTA", "STEQ", "SIMA", "MACH", "VEHI", "LINV", "ROLV", "BLDG", "LAND", "UTIL"] as const;
const CODE_RE = /^[A-Z0-9_-]{1,20}$/;
const SITE_RE = /^[A-Z0-9]{1,8}$/;

const RUN_TONE = { ok: tone.success.badge, partial: tone.warning.badge, failed: tone.danger.badge, running: tone.info.badge } as const;

/**
 * ตั้งค่าระบบ → SyteLine Fixed Assets: สวิตช์ซิงค์อัตโนมัติ, path ของรายงาน, ขอบเขต (สาขา / แผนก / หมวด), ทดสอบการเชื่อมต่อ, ซิงค์ตอนนี้, ประวัติ
 * บัญชี/รหัสผ่านของ API ตั้งใน .env ของ API เท่านั้น — หน้านี้แสดงแค่ว่าตั้งแล้วหรือยัง
 */
export function FixedAssetSync({ initial, runs, canSync }: { initial: FixedAssetSyncSettings; runs: FixedAssetSyncRun[]; canSync: boolean }) {
  const { t, fmt } = useI18n();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok?: boolean; message?: string } | null>(null);
  const [test, setTest] = useState<FixedAssetConnectionTest | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"save" | "test" | "sync" | null>(null);

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
  const setPath = (k: "depreciation" | "classdept", value: string) => {
    setV({ ...v, paths: { ...v.paths, [k]: value } });
    clearError(`paths.${k}`);
  };

  const run = (kind: "save" | "test" | "sync", fn: () => Promise<void>) =>
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
          {/* path ของรายงาน — ยืนยันกับฝ่าย IT ของ STEC */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label htmlFor="fa-path-dep" className={label}>{t("fixedAssetSync.pathDepreciation")}</label>
              <input
                id="fa-path-dep"
                value={v.paths.depreciation}
                onChange={(e) => setPath("depreciation", e.target.value)}
                placeholder="/api/v1/reports/..."
                className={field("paths.depreciation")}
              />
              {err("paths.depreciation")}
              <p className="mt-1 text-xs text-muted">{t("fixedAssetSync.pathDepreciationHint")}</p>
            </div>
            <div>
              <label htmlFor="fa-path-cd" className={label}>{t("fixedAssetSync.pathClassdept")}</label>
              <input
                id="fa-path-cd"
                value={v.paths.classdept}
                onChange={(e) => setPath("classdept", e.target.value)}
                placeholder="/api/v1/reports/..."
                className={field("paths.classdept")}
              />
              {err("paths.classdept")}
              <p className="mt-1 text-xs text-muted">{t("fixedAssetSync.pathClassdeptHint")}</p>
            </div>
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
              <p className="mt-1 text-xs text-muted">{t("fixedAssetSync.departmentsHint")}</p>
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
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">{t("fixedAssetSync.quickAdd")}</span>
                {CLASS_SUGGESTIONS.filter((c) => !v.classes.includes(c)).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set("classes", [...v.classes, c])}
                    className="cursor-pointer rounded-full bg-subtle px-2.5 py-0.5 text-xs hover:bg-accent-100 hover:text-accent-900 dark:hover:bg-accent-400/15 dark:hover:text-accent-100"
                  >
                    + {c} <span className="text-muted">{t(`fixedAssetSync.classNames.${c}`)}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">{t("fixedAssetSync.classesHint")}</p>
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

        {v.enabled && !v.paths.depreciation && <p className={alert.warning}>{t("fixedAssetSync.needPath")}</p>}

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

      {/* ประวัติการซิงค์ 20 รอบล่าสุด */}
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
      </section>
    </div>
  );
}
