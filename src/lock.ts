import { db, type LockRow } from './db'

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

export async function getLock(): Promise<LockRow> {
  return (await db.lock.get('lock')) ?? { key: 'lock', credentialId: null, pinHash: null, pinSalt: null }
}

export const isLockEnabled = (l: LockRow) => l.pinHash != null

export const faceIdSupported = () => typeof PublicKeyCredential !== 'undefined' && window.isSecureContext

/**
 * Face ID работает как замок на вход: passkey создаётся на этом устройстве
 * и проверяется локально (userVerification: required). Данные им не шифруются.
 */
export async function enrollFaceId(): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Финансы' },
      user: { id: random(16), name: 'Финансы', displayName: 'Финансы' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Face ID не настроен')
  await db.lock.put({ ...(await getLock()), credentialId: b64(cred.rawId) })
}

export async function unlockWithFaceId(lock: LockRow): Promise<boolean> {
  if (!lock.credentialId) return false
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: unb64(lock.credentialId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    })
    return res != null
  } catch {
    return false
  }
}

async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 200_000, hash: 'SHA-256' }, key, 256)
  return b64(bits)
}

export async function setPin(pin: string) {
  const salt = random(16)
  await db.lock.put({ ...(await getLock()), pinHash: await hashPin(pin, salt), pinSalt: b64(salt.buffer) })
}

export async function checkPin(lock: LockRow, pin: string): Promise<boolean> {
  if (!lock.pinHash || !lock.pinSalt) return false
  return (await hashPin(pin, unb64(lock.pinSalt))) === lock.pinHash
}

export async function disableLock() {
  await db.lock.put({ key: 'lock', credentialId: null, pinHash: null, pinSalt: null })
}
