import { db } from './db'
import { fetchBond } from './domain/bonds'

const STALE_MS = 30 * 60 * 1000

/** Обновляет цены и графики бумаг, которые есть в сделках. Без сети тихо оставляет кэш. */
export async function refreshBonds(force = false) {
  const secids = [...new Set((await db.trades.toArray()).map(t => t.secid))]
  for (const secid of secids) {
    const cached = await db.bonds.get(secid)
    if (!force && cached && Date.now() - cached.updatedAt < STALE_MS) continue
    try {
      await db.bonds.put(await fetchBond(secid))
    } catch {
      // нет сети или бумага снята с торгов — работаем по кэшу
    }
  }
}
