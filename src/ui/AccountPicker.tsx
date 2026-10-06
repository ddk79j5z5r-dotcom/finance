import { useState } from 'react'
import { accountKind } from '../domain/calc'
import type { Account } from '../domain/types'
import { AccountBadge } from './AccountBadge'
import { Money, Sheet } from './common'
import type { Data } from './data'
import { Icon } from './icons'

/** Кнопка с выбранным счётом; по нажатию — список счетов цветными плашками (карты, затем копилки). */
export function AccountPicker({ data, accounts, value, onChange, label, exclude }: {
  data: Data; accounts: Account[]; value: number | null; onChange: (id: number) => void; label: string; exclude?: number | null
}) {
  const [open, setOpen] = useState(false)
  const acc = accounts.find(a => a.id === value)
  const list = accounts.filter(a => a.id !== exclude)
  const groups: [string, Account[]][] = [
    ['Карты', list.filter(a => accountKind(a) === 'card')],
    ['Копилки', list.filter(a => accountKind(a) === 'savings')],
    ['Облигации', list.filter(a => accountKind(a) === 'broker')],
  ]
  return (
    <>
      <button type="button" className="acc-pick" onClick={() => setOpen(true)} aria-label={`${label}: ${acc?.name ?? 'не выбран'}`}>
        {acc ? <AccountBadge account={acc} color={data.colorOf(acc)} size={36} /> : <span className="badge tone-transfer" style={{ width: 36, height: 36 }}><Icon name="wallet" size={18} /></span>}
        <span className="body">
          <span className="k">{label}</span>
          <span className="v">{acc?.name ?? 'Выбери счёт'}</span>
        </span>
        {acc && <span className="bal"><Money v={data.bal.get(acc.id!) ?? 0} cur={acc.currency} /></span>}
        <Icon name="right" size={18} />
      </button>
      {open && (
        <Sheet title="Выберите счёт" onClose={() => setOpen(false)}>
          {groups.filter(([, l]) => l.length).map(([title, l]) => (
            <div key={title}>
              <div className="day">{title}</div>
              <div className="acc-bars">
                {l.map(a => (
                  <button key={a.id} type="button" className={`acc-bar acc-${data.colorOf(a)} ${a.id === value ? 'on' : ''}`}
                    onClick={() => { onChange(a.id!); setOpen(false) }}>
                    <span className="n">{a.name}</span>
                    <span className="num"><Money v={data.bal.get(a.id!) ?? 0} cur={a.currency} /></span>
                    {a.id === value && <Icon name="check" size={18} />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Sheet>
      )}
    </>
  )
}
