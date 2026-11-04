import type { CivilDate } from './models'

/** Money Saver's BRL business calendar. A civil date never comes from UTC slicing. */
export const FINANCIAL_TIME_ZONE = 'America/Sao_Paulo'
export function civilToday(instant: Date = new Date(), timeZone = FINANCIAL_TIME_ZONE): CivilDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const value = (type: string) => parts.find((p) => p.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}` as CivilDate
}
