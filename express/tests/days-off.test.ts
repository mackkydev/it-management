import { describe, expect, it } from "vitest";
import { insert } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { holidayCalendarFor } from "../src/services/calendar.js";
import { as, makeUser } from "./helpers.js";

/** GET /calendar/days-off — วันหยุดบริษัทของสาขาผู้ดู ให้ปฏิทินทุกหน้าระบายสีพื้น */
describe("calendar days off", () => {
  it("lists company holidays in the range for the viewer's holiday calendar", async () => {
    const user = await makeUser();
    await insert("company_holidays", { calendar_id: await holidayCalendarFor(null), date: "2033-04-13", name: "สงกรานต์", created_at: nowDb(), updated_at: nowDb() });
    const res = await (await as(user)).get("/api/v1/calendar/days-off?from=2033-04-01&to=2033-04-30");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ date: "2033-04-13", name: "สงกรานต์" }]);
    expect((await (await as(user)).get("/api/v1/calendar/days-off?from=2033-05-01&to=2033-05-31")).body.data).toEqual([]);
  });
});
