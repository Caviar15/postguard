import { describe, expect, it } from "vitest";
import { calendarDay, timelineZone } from "./timeline";

describe("timeline timezone", () => {
  it("uses the channel zone when every post has that zone", () => {
    expect(timelineZone(["Europe/Amsterdam", "Europe/Amsterdam"])).toEqual({
      zone: "Europe/Amsterdam",
      label: "Europe/Amsterdam",
    });
  });

  it("labels the axis UTC when a timezone is missing or the channels disagree", () => {
    expect(timelineZone(["Europe/Amsterdam", null])).toEqual({ zone: "UTC", label: "UTC" });
    expect(timelineZone(["Europe/Amsterdam", "America/New_York"])).toEqual({ zone: "UTC", label: "UTC" });
    expect(timelineZone([])).toEqual({ zone: "UTC", label: "UTC" });
  });

  it("puts a late UTC instant on the next calendar day in Amsterdam", () => {
    expect(calendarDay("2026-11-10T23:30:00.000Z", "Europe/Amsterdam")).toBe("2026-11-11");
    expect(calendarDay("2026-11-10T23:30:00.000Z", "UTC")).toBe("2026-11-10");
  });
});
