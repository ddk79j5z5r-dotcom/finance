import { db } from './db'
import { fetchBond } from './domain/bonds'

const STALE_MS = 30 * 60 * 1000

/** Обновляет цены и графики бумаг, которые есть в сделках. Без сети тихо оставляет кэш. */
export async function refreshBonds(force = false) {
  const secids = [...new Set((await db.trades.toArray()).map(t => t.secid))]
  const fresh = []
  for (const secid of secids) {
    const cached = await db.bonds.get(secid)
    if (!force && cached && Date.now() - cached.updatedAt < STALE_MS) continue
    try {
      fresh.push(await fetchBond(secid))
    } catch {
      // нет сети или бумага снята с торгов — работаем по кэшу
    }
  }
  // Одной записью: каждая запись в базу перечитывает все данные и перерисовывает экран.
  if (fresh.length) await db.bonds.bulkPut(fresh)
}
