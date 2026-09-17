import type { Booking } from "./types";

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function minutesBetween(from?: string, to?: string) {
  const start = Date.parse(from || "");
  const end = Date.parse(to || "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 60000 : null;
}

export function summarizeDispatchPerformance(bookings: Booking[]) {
  const completed = bookings.filter((booking) => booking.status === "completed");
  const measured = completed.filter((booking) =>
    booking.actualMinutes !== undefined && booking.actualKm !== undefined && booking.actualCost !== undefined
  );
  const estimatedMeasuredCost = measured.reduce((sum, booking) => sum + booking.estCost, 0);
  const actualMeasuredCost = measured.reduce((sum, booking) => sum + (booking.actualCost || 0), 0);
  const approvalTimes = bookings
    .map((booking) => minutesBetween(booking.createdAt, booking.approvedAt))
    .filter((value): value is number => value !== null);

  return {
    pending: bookings.filter((booking) => booking.status === "pending").length,
    active: bookings.filter((booking) => booking.status === "in-progress").length,
    unassigned: bookings.filter((booking) =>
      (booking.status === "approved" || booking.status === "in-progress") && !booking.assignedTo?.trim()
    ).length,
    completed: completed.length,
    actualsRecorded: measured.length,
    actualCaptureRate: completed.length ? Math.round((measured.length / completed.length) * 100) : 0,
    avgApprovalMinutes: approvalTimes.length
      ? Math.round(approvalTimes.reduce((sum, value) => sum + value, 0) / approvalTimes.length)
      : null,
    estimatedMeasuredCost: money(estimatedMeasuredCost),
    actualMeasuredCost: money(actualMeasuredCost),
    costVariance: money(actualMeasuredCost - estimatedMeasuredCost),
    measuredSavings: money(estimatedMeasuredCost - actualMeasuredCost),
  };
}
