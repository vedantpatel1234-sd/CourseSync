export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const

export const TIME_SLOTS = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
  '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM'
] as const

export type Day = typeof DAYS[number]
export type TimeSlot = typeof TIME_SLOTS[number]

export function formatDayTime(day: string | null | undefined, timeSlot: string | null | undefined): string {
  if (!day || !timeSlot) return 'Not scheduled'
  return `${day} ${timeSlot}`
}
