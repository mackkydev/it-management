/** ช่วงวันของตารางเดือน 6 สัปดาห์ (เริ่มวันอาทิตย์) — ใช้ทั้งฝั่ง server (โหลดครั้งแรก) และ client (เปลี่ยนเดือน) */
export function monthGrid(month: string): { from: string; to: string; days: string[] } {
  const first = new Date(`${month}-01T00:00:00Z`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const days: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return { from: days[0], to: days[41], days };
}

/** เดือนก่อน / ถัดไป ("YYYY-MM") */
export function shiftMonth(month: string, n: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
