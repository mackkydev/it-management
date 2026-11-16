import { describe, expect, it } from "vitest";
import { guest } from "./helpers.js";

describe("system status (login page chip)", () => {
  it("is public and reports the database as ok", async () => {
    const res = await guest().get("/api/v1/system-status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { database: "ok" } });
  });
});
