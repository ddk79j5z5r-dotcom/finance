import { todayISO } from './money'
import type { Tx } from './types'

export const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

/** Название дня для групп: «Сегодня, 31 октября», «Вчера, …», «Пт, 30 октября». */
export function dayTitle(date: string) {
  const today = todayISO()
  const y = new Date(); y.setDate(y.getDate() - 1)
  const d = new Date(date + 'T00:00:00')
  const dm = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })
  if (date === today) return `Сегодня, ${dm}`
  if (date === todayISO(y)) return `Вчера, ${dm}`
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' })
  return `${wd[0].toUpperCase()}${wd.slice(1)}, ${dm}`
}

/** Время записи — если операция записана в тот же день (для импортированных и прошлых дат не показываем). */
export function txTime(t: Tx) {
  const d = new Date(t.createdAt)
  return todayISO(d) === t.date ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null
}

/** Доля накопленного: при очень малой сумме — «<1%», а не ноль, и шкала не пустая; шкала не длиннее 100%. */
export function goalPct(saved: number, target: number) {
  if (target <= 0) return { pct: 0, label: '—', width: 0 }
  const raw = (saved / target) * 100
  const pct = Math.min(100, Math.floor(raw))
  return { pct, label: saved > 0 && raw < 1 ? '<1%' : `${pct}%`, width: saved > 0 ? Math.min(100, Math.max(raw, 1.5)) : 0 }
}

const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
/** «до декабря 2030 г.» */
export const monthYear = (ym: string) => `${MONTH_GEN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)} г.`
