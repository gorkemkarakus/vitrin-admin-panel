export type CustomerSegment = 'sadik' | 'yeni'

export const LOYAL_APPT_THRESHOLD = 3

export function segmentForStats(stats: { isNewThisMonth: boolean; completedCount: number }): CustomerSegment | null {
  if (stats.isNewThisMonth) return 'yeni'
  if (stats.completedCount >= LOYAL_APPT_THRESHOLD) return 'sadik'
  return null
}
