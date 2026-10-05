import type { Account, AccountColor } from '../domain/types'

export const COLOR_LABEL: Record<AccountColor, string> = {
  yellow: 'Жёлтый', green: 'Зелёный', blue: 'Синий', sky: 'Голубой', orange: 'Оранжевый', pink: 'Розовый', violet: 'Фиолетовый', gray: 'Серый',
}

/** Цветной кружок с первой буквой названия счёта. */
export function AccountBadge({ account, color, size = 40 }: { account: Pick<Account, 'name'>; color: AccountColor; size?: number }) {
  const letter = account.name.trim().replace(/^[^\p{L}\p{N}]+/u, '')[0]?.toUpperCase() ?? '•'
  return (
    <span className={`acc-badge acc-${color}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {letter}
    </span>
  )
}

export function AccountDot({ color }: { color: AccountColor }) {
  return <span className={`acc-dot acc-${color}`} aria-hidden="true" />
}
