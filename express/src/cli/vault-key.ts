import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { config } from "../config.js";
import { closePool, exec, select, transaction } from "../db.js";
import { audit } from "../services/audit.js";
import { decryptVaultWithKey, encryptVault, vaultKeyMode } from "../services/vault-crypto.js";

/**
 * กุญแจคลังบัญชี (VAULT_KEY) — แยกจาก APP_KEY
 *   npm run vault:keygen -- <path>   สร้างไฟล์กุญแจใหม่ (สิทธิ์อ่านเฉพาะเจ้าของ, ไม่เขียนทับไฟล์เดิม) — ไม่พิมพ์ค่ากุญแจออกจอ
 *   npm run vault:rekey [-- --dry-run]  เข้ารหัสรหัสผ่าน/หมายเหตุลับในคลังที่ยังใช้ APP_KEY ใหม่ด้วยกุญแจคลัง (สำรองฐานข้อมูลก่อน!)
 * กุญแจคลังหาย = อ่านรหัสผ่านในคลังไม่ได้อีก — เก็บสำเนาไว้นอกเครื่อง (ตู้เซฟ / password manager ของบริษัท)
 */
export async function rekeyVault(opts: { dryRun?: boolean } = {}): Promise<{ checked: number; rekeyed: number; failed: number[] }> {
  if (vaultKeyMode() !== "vault_key") throw new Error("VAULT_KEY / VAULT_KEY_FILE is not set — nothing to rekey");
  const rows = await select<{ id: number; password: string | null; secret_notes: string | null }>(
    "SELECT id, password, secret_notes FROM credentials WHERE password IS NOT NULL OR secret_notes IS NOT NULL",
  );
  const failed: number[] = [];
  const changes: { id: number; values: Record<string, string> }[] = [];
  for (const r of rows) {
    const values: Record<string, string> = {};
    try {
      for (const col of ["password", "secret_notes"] as const) {
        const v = r[col];
        if (v === null) continue;
        const d = decryptVaultWithKey(v);
        if (d.key === "app_key") values[col] = encryptVault(d.plain);
      }
    } catch {
      failed.push(Number(r.id));
      continue;
    }
    if (Object.keys(values).length) changes.push({ id: Number(r.id), values });
  }
  if (!opts.dryRun && changes.length) {
    await transaction(async () => {
      for (const c of changes) {
        const cols = Object.keys(c.values);
        // ไม่แตะ updated_at — ข้อมูลไม่ได้เปลี่ยน แค่กุญแจที่ใช้เข้ารหัส
        await exec(`UPDATE credentials SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...cols.map((k) => c.values[k]), c.id]);
      }
    });
    await audit({}, { action: "vault.rekeyed", subjectType: "vault", subjectId: "credentials", after: { rekeyed: changes.length, failed } });
  }
  return { checked: rows.length, rekeyed: changes.length, failed };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "keygen") {
    const file = args[0];
    if (!file) throw new Error("usage: npm run vault:keygen -- <path to key file>");
    if (existsSync(file)) throw new Error(`${file} already exists — refusing to overwrite (an existing key may still be in use)`);
    writeFileSync(file, `base64:${randomBytes(32).toString("base64")}\n`, { mode: 0o600, flag: "wx" });
    console.log(`created ${file} — set VAULT_KEY_FILE=${file}, restart the API, then run npm run vault:rekey`);
    console.log("keep an offline copy of this file: losing it makes the vault unreadable");
    return;
  }
  if (cmd === "rekey") {
    const dryRun = args.includes("--dry-run");
    console.log(`vault key source: ${config.vaultKeySource ?? "(none — APP_KEY)"}`);
    const r = await rekeyVault({ dryRun });
    console.log(`${dryRun ? "[dry-run] " : ""}checked ${r.checked} credential(s), ${dryRun ? "would re-encrypt" : "re-encrypted"} ${r.rekeyed}`);
    if (r.failed.length) {
      console.error(`could not decrypt credential id(s): ${r.failed.join(", ")} — left unchanged`);
      process.exitCode = 1;
    }
    return;
  }
  throw new Error("usage: vault-key.ts keygen <path> | rekey [--dry-run]");
}

// เรียกตรงจาก CLI เท่านั้น (เทสต์ import rekeyVault ได้)
if (process.argv[1] && /vault-key\.(ts|js)$/.test(process.argv[1])) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
