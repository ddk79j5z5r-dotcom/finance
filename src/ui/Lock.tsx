import { useEffect, useState } from 'react'
import type { LockRow } from '../db'
import { checkPin, unlockWithFaceId } from '../lock'
import { Icon } from './icons'

export function LockScreen({ lock, onUnlock }: { lock: LockRow; onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  const faceId = async () => {
    if (await unlockWithFaceId(lock)) onUnlock()
  }
  // Safari может потребовать нажатие для Face ID — тогда сработает кнопка.
  useEffect(() => { if (lock.credentialId) faceId() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function enter(v: string) {
    setPin(v)
    setError('')
    if (v.length === 6) {
      if (await checkPin(lock, v)) onUnlock()
      else { setError('Неверный PIN'); setPin('') }
    }
  }

  return (
    <div className="lock">
      <div className="lock-icon"><Icon name="lock" size={32} /></div>
      <h1>Финансы</h1>
      {lock.credentialId && <button className="primary" onClick={faceId}>Войти по Face ID</button>}
      <input
        className="pin"
        inputMode="numeric"
        type="password"
        autoComplete="off"
        maxLength={6}
        value={pin}
        placeholder="PIN"
        onChange={e => enter(e.target.value.replace(/\D/g, ''))}
      />
      {error && <div className="error">{error}</div>}
    </div>
  )
}
