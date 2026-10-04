import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import { as, fakeImage, fakePdf, makeBranch, makeUser } from "./helpers.js";

/** ลายเซ็นในโปรไฟล์ → แสตมป์ลงใบแจ้งงาน (แทนการวาดตอนแจ้ง) */
describe("profile signature", () => {
  it("upload, show own url only, replace and delete", async () => {
    const u = await makeUser();
    const api = await as(u);

    const bad = await api.post("/api/v1/auth/me/signature").attach("signature", fakePdf(5), "sig.pdf");
    expect(bad.status).toBe(422);
    expect(bad.body.errors.signature[0]).toBe("ลายเซ็นต้องเป็นไฟล์รูปภาพ");
    const big = await api.post("/api/v1/auth/me/signature").attach("signature", fakeImage(1500, "png"), "big.png");
    expect(big.body.errors.signature[0]).toBe("ลายเซ็นต้องมีขนาดไม่เกิน 1024 KB");

    const up = await api.post("/api/v1/auth/me/signature").attach("signature", fakeImage(20, "png"), "sig.png");
    expect(up.status).toBe(200);
    expect(up.body.data.signature_url).toMatch(/^\/auth\/me\/signature\?v=signature-[A-Za-z0-9]{16}$/);
    expect((await api.get("/api/v1/auth/me")).body.data.signature_url).toBe(up.body.data.signature_url);

    const img = await api.get("/api/v1/auth/me/signature");
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");

    // อัปโหลดใหม่ → URL เปลี่ยน (cache-bust)
    const again = await api.post("/api/v1/auth/me/signature").attach("signature", fakeImage(10, "jpg"), "sig.jpg");
    expect(again.body.data.signature_url).not.toBe(up.body.data.signature_url);

    // คนอื่นไม่เห็น URL ลายเซ็นของเรา
    const admin = await as(await makeUser({ role: "admin" }));
    expect((await admin.get(`/api/v1/users/${u.id}`)).body.data.signature_url).toBeNull();

    expect((await api.delete("/api/v1/auth/me/signature")).status).toBe(204);
    expect((await api.get("/api/v1/auth/me")).body.data.signature_url).toBeNull();
    expect((await api.get("/api/v1/auth/me/signature")).status).toBe(404);
  });

  it("ticket stamps a snapshot of the profile signature; without one it falls back to the current profile signature", async () => {
    const branch = await makeBranch();
    const staff = await makeUser({ name: "Staff" });
    const api = await as(staff);
    const submit = () => api.post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "ติดตั้งโปรแกรม" });

    // ยังไม่มีลายเซ็น: แจ้งงานได้ ช่องลายเซ็นว่าง
    const noSig = await submit();
    expect(noSig.status).toBe(201);
    expect(noSig.body.data.signatures.requester).toBeNull();

    await api.post("/api/v1/auth/me/signature").attach("signature", fakeImage(20, "png"), "sig.png");

    // ใบงานเดิม (ไม่มีสำเนา) → แสตมป์ลายเซ็นปัจจุบันตอนดู/พิมพ์
    const old = await api.get(`/api/v1/tickets/${noSig.body.data.id}`);
    expect(old.body.data.signatures.requester).toBe(`/tickets/${noSig.body.data.id}/files/requester-signature`);
    expect((await api.get(`/api/v1/tickets/${noSig.body.data.id}/files/requester-signature`)).status).toBe(200);

    // ใบงานใหม่ → เก็บสำเนาไว้กับใบงาน ลบลายเซ็นในโปรไฟล์แล้วยังพิมพ์ได้
    const withSig = await submit();
    const path = await scalar<string>("SELECT requester_signature FROM it_tickets WHERE uuid = ?", [withSig.body.data.id]);
    expect(path).toMatch(/^tickets\/[0-9a-f-]{36}\/signatures\/requester-[A-Za-z0-9]{16}\.png$/);
    await api.delete("/api/v1/auth/me/signature");
    const file = await api.get(`/api/v1/tickets/${withSig.body.data.id}/files/requester-signature`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect((await first("SELECT signature_path FROM users WHERE id = ?", [staff.id]))?.signature_path).toBeNull();
  });
});
