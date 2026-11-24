export type Timing = { frequency: "daily" | "weekly"; scheduled_time: string; timezone: string; weekday: number };

function localParts(date: Date, format: Intl.DateTimeFormat) {
  const values = format.formatToParts(date);
  const part = (name: string) => Number(values.find((value) => value.type === name)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

export function nextRun(timing: Timing, after = new Date()) {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timing.timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const [hour, minute] = timing.scheduled_time.split(":").map(Number);
  const today = localParts(after, format);
  for (let day = 0; day <= 7; day++) {
    const local = Date.UTC(today.year, today.month - 1, today.day + day, hour, minute);
    if (timing.frequency === "weekly" && new Date(local).getUTCDay() !== timing.weekday) continue;
    const localAsUtc = (stamp: number) => {
      const parts = localParts(new Date(stamp), format);
      return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    };
    const offsets = new Set([local - 86_400_000, local, local + 86_400_000].map((stamp) => localAsUtc(stamp) - stamp));
    const candidates = [...offsets].map((offset) => local - offset).sort((a, b) => a - b);
    // Select the first occurrence on repeated wall-clock times. On a gap, move forward by the offset change.
    const selected = candidates.find((stamp) => localAsUtc(stamp) === local)
      ?? candidates.find((stamp) => localAsUtc(stamp) > local);
    if (selected !== undefined && selected > +after) return new Date(selected).toISOString();
  }
  throw new RangeError("Could not calculate the next schedule time.");
}
