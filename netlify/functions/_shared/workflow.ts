import type { BookingStatus } from "./types";

export const bookingTransitions: Record<BookingStatus, BookingStatus[]> = {
  pending: ["approved", "declined"],
  approved: ["in-progress", "declined"],
  "in-progress": ["completed"],
  completed: [],
  declined: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus) {
  return bookingTransitions[from].includes(to);
}
