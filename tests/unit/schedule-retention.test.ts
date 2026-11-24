import { describe, expect, it } from "vitest";
import { nextRun } from "../../src/lib/schedule";
import { retentionPlan } from "../../src/lib/retention";

describe("schedules", () => {
  it("converts a daily local schedule to UTC", () => {
    expect(nextRun({ frequency: "daily", scheduled_time: "09:00", timezone: "Asia/Karachi", weekday: 1 }, new Date("2026-11-24T04:30:00Z"))).toBe("2026-11-25T04:00:00.000Z");
  });
  it("uses the selected weekly weekday", () => {
    expect(nextRun({ frequency: "weekly", scheduled_time: "22:12", timezone: "Asia/Karachi", weekday: 5 }, new Date("2026-11-24T04:30:00Z"))).toBe("2026-11-27T17:12:00.000Z");
  });
  it("advances through a daylight saving gap", () => {
    expect(nextRun({ frequency: "daily", scheduled_time: "02:30", timezone: "America/New_York", weekday: 0 }, new Date("2026-03-08T00:00:00Z"))).toBe("2026-03-08T07:30:00.000Z");
  });
  it("uses the first instant in a daylight saving fold", () => {
    expect(nextRun({ frequency: "daily", scheduled_time: "01:30", timezone: "America/New_York", weekday: 0 }, new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("retention", () => {
  const date = new Date("2026-11-24T12:00:00Z");
  const rows = [
    { id: "a", created_at: "2026-11-24T10:00:00Z", status: "verified" },
    { id: "b", created_at: "2026-11-24T08:00:00Z", status: "verified" },
    { id: "c", created_at: "2026-11-23T08:00:00Z", status: "verified" },
    { id: "d", created_at: "2026-08-25T08:00:00Z", status: "verified", passed: true },
    { id: "e", created_at: "2026-11-24T11:00:00Z", status: "corrupted" },
  ];
  it("retains the minimum verified points and latest proven restore", () => {
    expect(retentionPlan(rows, { keep_latest: 1, minimum: 2, daily: 0, weekly: 0, monthly: 0 }, date)).toEqual({ keep: ["a", "b", "d", "e"], remove: ["c"] });
  });
  it("retains one verified point per day bucket", () => {
    expect(retentionPlan(rows, { keep_latest: 1, minimum: 1, daily: 2, weekly: 0, monthly: 0 }, date).keep).toEqual(["a", "c", "d", "e"]);
  });
});
