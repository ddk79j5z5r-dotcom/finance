import { useState, type ReactNode } from 'react'
import type { Category, IncomeKind } from '../domain/types'
import { INCOME_LABEL } from '../domain/types'
import { Sheet } from './common'
import { childrenOf, type Data } from './data'
import { Badge, categoryIcon, Icon, INCOME_ICON } from './icons'

/** Строка выбора «Откуда / Куда»: значок, подпись, значение, справа — доп. информация и стрелка. */
export function PickRow({ icon, label, value, extra, onClick, empty = false }: {
  icon: ReactNode; label: string; value: string; extra?: ReactNode; onClick: () => void; empty?: boolean
}) {
  return (
    <button type="button" className={empty ? 'acc-pick empty' : 'acc-pick'} onClick={onClick} aria-label={`${label}: ${value}`}>
      {icon}
      <span className="body"><span className="k">{label}</span><span className="v">{value}</span></span>
      {extra && <span className="bal">{extra}</span>}
      <Icon name="right" size={18} />
    </button>
  )
}

/** Выбор категории расхода: сетка конвертов (частые первыми), затем — подкатегория, если есть. */
export function CategoryPicker({ data, roots, rootId, subId, onPick, open, setOpen }: {
  data: Data; roots: Category[]; rootId: number | null; subId: number | null
  onPick: (root: number, sub: number | null) => void; open: boolean; setOpen: (v: boolean) => void
}) {
  const [step, setStep] = useState<Category | null>(null)
  const root = data.categories.find(c => c.id === rootId)
  const sub = data.categories.find(c => c.id === subId)
  const close = () => { setOpen(false); setStep(null) }

  function pickRoot(c: Category) {
    if (childrenOf(data.categories, c.id!).length) setStep(c)
    else { onPick(c.id!, null); close() }
  }

  return (
    <>
      <PickRow
        icon={root ? <Badge icon={categoryIcon(root)} tone="needs" size={36} /> : <span className="badge tone-transfer" style={{ width: 36, height: 36 }}><Icon name="tag" size={18} /></span>}
        label="Куда" value={root ? (sub ? `${root.name} · ${sub.name}` : root.name) : 'Выбери категорию'} empty={!root}
        onClick={() => setOpen(true)} />
      {open && (
        <Sheet title={step ? step.name : 'Категория'} onClose={close}>
          {step ? (
            <>
              <div className="card tight">
                <button className="row" onClick={() => { onPick(step.id!, null); close() }}>
                  <Badge icon={categoryIcon(step)} tone="needs" />
                  <span className="body title">Без подкатегории</span>
                  {rootId === step.id && subId == null && <Icon name="check" size={18} />}
                </button>
                {childrenOf(data.categories, step.id!).map(c => (
                  <button key={c.id} className="row" onClick={() => { onPick(step.id!, c.id!); close() }}>
                    <span className="badge" style={{ width: 40, height: 40, background: 'var(--card-2)' }} />
                    <span className="body title">{c.name}</span>
                    {subId === c.id && <Icon name="check" size={18} />}
                  </button>
                ))}
              </div>
              <button className="secondary" onClick={() => setStep(null)}>Назад к категориям</button>
            </>
          ) : (
            <div className="tile-grid">
              {roots.map(c => (
                <button key={c.id} type="button" className={c.id === rootId ? 'tile-btn on' : 'tile-btn'} onClick={() => pickRoot(c)}>
                  <span className="badge tone-needs"><Icon name={categoryIcon(c)} size={22} /></span>
                  <span className="tile-label">{c.name}{childrenOf(data.categories, c.id!).length > 0 && ' ›'}</span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}

const KINDS = Object.keys(INCOME_LABEL) as IncomeKind[]

/** Выбор вида дохода («Откуда» для дохода). */
export function IncomeKindPicker({ value, onPick }: { value: IncomeKind; onPick: (k: IncomeKind) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <PickRow icon={<Badge icon={INCOME_ICON[value]} tone="income" size={36} />} label="Откуда" value={INCOME_LABEL[value]} onClick={() => setOpen(true)} />
      {open && (
        <Sheet title="Откуда доход" onClose={() => setOpen(false)}>
          <div className="tile-grid">
            {KINDS.map(k => (
              <button key={k} type="button" className={k === value ? 'tile-btn on' : 'tile-btn'} onClick={() => { onPick(k); setOpen(false) }}>
                <span className="badge tone-income"><Icon name={INCOME_ICON[k]} size={22} /></span>
                <span className="tile-label">{INCOME_LABEL[k]}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}
