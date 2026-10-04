import { Icon } from './icons'

const ROWS = [['1', '2', '3', 'back'], ['4', '5', '6', '+'], ['7', '8', '9', '−']] as const

/** Применяет нажатие клавиши к выражению суммы. Не больше двух знаков после запятой в каждом числе. */
export function applyKey(expr: string, key: string): string {
  const current = expr.split(/[+−]/).at(-1) ?? ''
  if (key === 'back') return expr.slice(0, -1)
  if (key === '+' || key === '−') {
    if (!expr) return expr
    return /[+−]$/.test(expr) ? expr.slice(0, -1) + key : expr + key
  }
  if (key === ',') {
    if (current.includes(',')) return expr
    return expr + (current ? ',' : '0,')
  }
  // цифра
  if (/,\d\d$/.test(current)) return expr
  if (current === '0') return expr.slice(0, -1) + key
  if (current.replace(',', '').length >= 9) return expr
  return expr + key
}

export function Keypad({ onKey, onSave, saving, saveLabel = 'Сохранить' }: {
  onKey: (k: string) => void; onSave: () => void; saving: boolean; saveLabel?: string
}) {
  return (
    <div className="keypad" role="group" aria-label="Клавиатура суммы">
      {ROWS.flat().map(k => (
        <button key={k} type="button" className={k === 'back' || k === '+' || k === '−' ? 'key op' : 'key'}
          aria-label={k === 'back' ? 'Стереть' : k} onClick={() => onKey(k)}>
          {k === 'back' ? <Icon name="left" size={22} /> : k}
        </button>
      ))}
      <button type="button" className="key" onClick={() => onKey(',')}>,</button>
      <button type="button" className="key" onClick={() => onKey('0')}>0</button>
      <button type="button" className="key save-key" disabled={saving} onClick={onSave}>{saveLabel}</button>
    </div>
  )
}
