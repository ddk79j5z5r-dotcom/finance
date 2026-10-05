import { useSyncExternalStore } from 'react'

/** Всплывающее сообщение внизу экрана; с `undo` — с кнопкой «Отменить» на 5 секунд. */
export interface Notice { id: number; text: string; undo?: () => Promise<void> | void }

let current: Notice | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function notify(text: string, undo?: Notice['undo']) {
  clearTimeout(timer)
  current = { id: ++seq, text, undo }
  emit()
  timer = setTimeout(() => { current = null; emit() }, undo ? 5000 : 1600)
}

export async function runUndo() {
  const n = current
  clearTimeout(timer)
  current = null
  emit()
  await n?.undo?.()
}

export function useNotice() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => current)
}
