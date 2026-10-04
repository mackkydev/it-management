import { describe, expect, it } from "vitest";
import { msUntilNext } from "../src/jobs/scheduler.js";
import { decryptString, encryptString } from "../src/lib/laravel-crypt.js";
import { makeHash, verifyHash } from "../src/lib/validator.js";
import { isStrictBase64 } from "../src/services/ticket-files.js";

/** ความเข้ากันได้กับ Laravel ที่ไม่ต้องใช้ HTTP */
describe("Laravel compatibility", () => {
  // ciphertext ที่ Laravel (Crypt::encryptString) สร้างด้วย key 32 ไบต์ 0x01
  const key = Buffer.alloc(32, 1);

  it("encrypt/decrypt round trip with Laravel payload format", () => {
    const payload = encryptString("รหัส S3cret/+=", key);
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    expect(Object.keys(json)).toEqual(["iv", "value", "mac", "tag"]);
    expect(json.mac).toMatch(/^[0-9a-f]{64}$/);
    expect(decryptString(payload, key)).toBe("รหัส S3cret/+=");
  });

  it("rejects a tampered payload (MAC)", () => {
    const json = JSON.parse(Buffer.from(encryptString("x", key), "base64").toString("utf8"));
    json.value = Buffer.from("tampered").toString("base64");
    expect(() => decryptString(Buffer.from(JSON.stringify(json)).toString("base64"), key)).toThrow("The MAC is invalid.");
  });

  it("signature base64 follows PHP base64_decode($s, true)", () => {
    const cases: Array<[string, boolean]> = [
      ["QUJD", true], ["QUI=", true], ["QUI", true], ["QQ==", true], ["QQ", true], ["QUJDRA", true],
      ["QQ=", false], ["Q", false], ["QUJD=", false], ["QQ===", false], ["QU=I", false],
    ];
    for (const [s, ok] of cases) expect([s, isStrictBase64(s)]).toEqual([s, ok]);
  });

  it("bcrypt hashes use the $2y$ prefix Laravel expects", () => {
    const hash = makeHash("Secret123", 4);
    expect(hash.startsWith("$2y$04$")).toBe(true);
    expect(verifyHash("Secret123", hash)).toBe(true);
    expect(verifyHash("wrong", hash)).toBe(false);
  });

  it("scheduler computes the next 08:00 in Asia/Bangkok", () => {
    // 2026-10-03 00:30 UTC = 07:30 Bangkok → อีก 30 นาที
    expect(msUntilNext("08:00", "Asia/Bangkok", new Date(Date.UTC(2026, 9, 3, 0, 30)))).toBe(30 * 60_000);
    // 02:00 UTC = 09:00 Bangkok → พรุ่งนี้ 08:00 (อีก 23 ชั่วโมง)
    expect(msUntilNext("08:00", "Asia/Bangkok", new Date(Date.UTC(2026, 9, 3, 2, 0)))).toBe(23 * 3_600_000);
  });
});
