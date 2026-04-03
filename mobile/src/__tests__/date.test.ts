import { formatRelativeDate, formatDateTime, formatTime } from "~/utils/date";

describe("formatRelativeDate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should return 'Today' for past dates on the same day", () => {
    expect(formatRelativeDate("2025-06-15T10:00:00Z")).toBe("Today");
  });

  it("should return 'Yesterday' for dates one day ago", () => {
    expect(formatRelativeDate("2025-06-14T12:00:00Z")).toBe("Yesterday");
  });

  it("should return 'N days ago' for older dates", () => {
    expect(formatRelativeDate("2025-06-12T12:00:00Z")).toBe("3 days ago");
  });

  it("should return 'in Nm' for events less than 1 hour away", () => {
    const result = formatRelativeDate("2025-06-15T12:30:00Z");
    expect(result).toMatch(/^in \d+m$/);
  });

  it("should return 'in Nh' for events less than 24 hours away", () => {
    const result = formatRelativeDate("2025-06-15T18:00:00Z");
    expect(result).toMatch(/^in \d+h$/);
  });

  it("should return 'Tomorrow' for events one day away", () => {
    expect(formatRelativeDate("2025-06-16T12:00:00Z")).toBe("Tomorrow");
  });

  it("should return 'in N days' for events within a week", () => {
    expect(formatRelativeDate("2025-06-18T12:00:00Z")).toBe("in 3 days");
  });

  it("should return formatted date for events more than a week away", () => {
    const result = formatRelativeDate("2025-06-30T12:00:00Z");
    // Should contain month and day
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});

describe("formatDateTime", () => {
  it("should return a formatted date string", () => {
    const result = formatDateTime("2025-06-15T14:30:00Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("formatTime", () => {
  it("should return a formatted time string", () => {
    const result = formatTime("2025-06-15T14:30:00Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
