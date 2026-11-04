import { describe, expect, it } from 'vitest'
import {
  amountToInput, dateLabel, evalAmount, formatMoney, hasOperator, monthGenitive, monthLabel, monthOf,
  parseAmount, plural, shiftMonth, toMajor, todayISO,
} from './money'

const NB = ' ' // неразрывный пробел: разделитель тысяч и перед символом валюты

describe('parseAmount', () => {
  it('понимает запятую и точку как десятичный разделитель', () => {
    expect(parseAmount('12,5')).toBe(1250)
    expect(parseAmount('12.5')).toBe(1250)
    expect(parseAmount('99.99')).toBe(9999)
  })
  it('игнорирует обычные и неразрывные пробелы', () => {
    expect(parseAmount('1 234,5')).toBe(123450)
    expect(parseAmount(`1${NB}234${NB}567`)).toBe(123456700)
    expect(parseAmount('  42  ')).toBe(4200)
  })
  it('дополняет одну цифру копеек нулём', () => {
    expect(parseAmount('1,05')).toBe(105)
    expect(parseAmount('1,5')).toBe(150)
    expect(parseAmount('0,07')).toBe(7)
  })
  it('целое число переводит в копейки', () => {
    expect(parseAmount('0')).toBe(0)
    expect(parseAmount('007')).toBe(700)
  })
  it('отклоняет более двух знаков после запятой', () => {
    expect(parseAmount('12,345')).toBeNull()
  })
  it('отклоняет отрицательные числа и пустой ввод', () => {
    expect(parseAmount('-5')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('   ')).toBeNull()
  })
  it('отклоняет мусор, второй разделитель и число без целой части', () => {
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('1,2,3')).toBeNull()
    expect(parseAmount('1.2.3')).toBeNull()
    expect(parseAmount(',5')).toBeNull()
    expect(parseAmount('5₽')).toBeNull()
  })
})

describe('evalAmount', () => {
  it('считает сумму и разность в копейках', () => {
    expect(evalAmount('300+85−20,5')).toBe(36450) // 300 + 85 − 20,50 = 364,50
    expect(evalAmount('100-30')).toBe(7000)
  })
  it('одиночное число равно parseAmount', () => {
    expect(evalAmount('12,5')).toBe(1250)
  })
  it('игнорирует висящий оператор в конце', () => {
    expect(evalAmount('5+')).toBe(500)
    expect(evalAmount('5−')).toBe(500)
  })
  it('допускает ведущий минус, если итог положительный', () => {
    expect(evalAmount('-5+10')).toBe(500)
  })
  it('возвращает null для пустого выражения и одного оператора', () => {
    expect(evalAmount('')).toBeNull()
    expect(evalAmount('+')).toBeNull()
  })
  it('возвращает null, если итог нулевой или отрицательный', () => {
    expect(evalAmount('5-5')).toBeNull()
    expect(evalAmount('5-10')).toBeNull()
    expect(evalAmount('0')).toBeNull()
  })
  it('возвращает null, если часть выражения некорректна', () => {
    expect(evalAmount('5+1,234')).toBeNull()
    expect(evalAmount('abc')).toBeNull()
  })
  it('не поддерживает деление и умножение: деление на ноль не даёт числа', () => {
    expect(evalAmount('5/0')).toBeNull()
    expect(evalAmount('5×2')).toBeNull()
  })
  it('нет потерь точности на копейках', () => {
    expect(evalAmount('0,1+0,2')).toBe(30)
  })
})

describe('hasOperator', () => {
  it('false для числа и пустой строки', () => {
    expect(hasOperator('123,45')).toBe(false)
    expect(hasOperator('')).toBe(false)
  })
  it('true, если оператор стоит после числа (в том числе висящий)', () => {
    expect(hasOperator('5+3')).toBe(true)
    expect(hasOperator('5−3')).toBe(true)
    expect(hasOperator('5-3')).toBe(true)
    expect(hasOperator('5+')).toBe(true)
  })
  it('ведущий знак оператором не считается', () => {
    expect(hasOperator('-5')).toBe(false)
    expect(hasOperator('−5')).toBe(false)
  })
})

describe('amountToInput', () => {
  it('целая сумма без дробной части', () => {
    expect(amountToInput(100)).toBe('1')
    expect(amountToInput(0)).toBe('0')
    expect(amountToInput(1234500)).toBe('12345')
  })
  it('убирает незначащий нуль в копейках', () => {
    expect(amountToInput(123450)).toBe('1234,5')
    expect(amountToInput(150)).toBe('1,5')
  })
  it('сохраняет ведущий нуль в копейках', () => {
    expect(amountToInput(105)).toBe('1,05')
    expect(amountToInput(5)).toBe('0,05')
  })
  it('обратим через parseAmount', () => {
    for (const v of [0, 5, 100, 105, 150, 99999, 123456]) expect(parseAmount(amountToInput(v))).toBe(v)
  })
  it('отрицательная сумма превращается в корректную строку', () => {
    expect(amountToInput(-150)).toBe('-1,5')
  })
})

describe('formatMoney', () => {
  it('группирует тысячи неразрывным пробелом и ставит символ рубля', () => {
    expect(formatMoney(1250000)).toBe(`12${NB}500${NB}₽`)
    expect(formatMoney(100000000)).toBe(`1${NB}000${NB}000${NB}₽`)
  })
  it('нуль и малые суммы', () => {
    expect(formatMoney(0)).toBe(`0${NB}₽`)
    expect(formatMoney(5)).toBe(`0,05${NB}₽`)
    expect(formatMoney(99900)).toBe(`999${NB}₽`)
  })
  it('копейки показывает только если они есть, всегда двумя цифрами', () => {
    expect(formatMoney(12345)).toBe(`123,45${NB}₽`)
    expect(formatMoney(150)).toBe(`1,50${NB}₽`)
  })
  it('отрицательные суммы с типографским минусом', () => {
    expect(formatMoney(-150000)).toBe(`−1${NB}500${NB}₽`)
  })
  it('символы валют', () => {
    expect(formatMoney(10000, 'USD')).toBe(`100${NB}$`)
    expect(formatMoney(10000, 'EUR')).toBe(`100${NB}€`)
  })
  it('округляет дробные копейки', () => {
    expect(formatMoney(150.6)).toBe(`1,51${NB}₽`)
  })
  it('крошечная отрицательная сумма не даёт «−0»', () => {
    expect(formatMoney(-0.4)).toBe(`0${NB}₽`)
  })
})

describe('toMajor', () => {
  it('переводит копейки в рубли', () => {
    expect(toMajor(12345)).toBe(123.45)
    expect(toMajor(0)).toBe(0)
  })
})

describe('даты и месяцы', () => {
  it('todayISO форматирует локальную дату с ведущими нулями', () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(todayISO(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })
  it('monthOf берёт год и месяц из даты', () => {
    expect(monthOf('2026-09-17')).toBe('2026-09')
  })
  it('shiftMonth двигает вперёд и назад в пределах года', () => {
    expect(shiftMonth('2026-05', 1)).toBe('2026-06')
    expect(shiftMonth('2026-05', -1)).toBe('2026-04')
    expect(shiftMonth('2026-05', 0)).toBe('2026-05')
  })
  it('shiftMonth переходит через границу года вперёд', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
  it('shiftMonth переходит через границу года назад', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
  it('shiftMonth на много месяцев', () => {
    expect(shiftMonth('2026-11', 14)).toBe('2028-01')
    expect(shiftMonth('2026-03', -27)).toBe('2023-12')
  })
  it('monthLabel — название месяца с заглавной буквы и год', () => {
    expect(monthLabel('2026-03')).toBe('Март 2026')
    expect(monthLabel('2027-12')).toBe('Декабрь 2027')
  })
  it('monthGenitive — родительный падеж', () => {
    expect(monthGenitive('2027-06')).toBe('июня 2027')
    expect(monthGenitive('2026-01')).toBe('января 2026')
  })
  it('dateLabel содержит число и месяц в родительном падеже', () => {
    const s = dateLabel('2026-11-03')
    expect(s).toContain('3')
    expect(s).toContain('ноября')
  })
})

describe('plural', () => {
  const F: [string, string, string] = ['операция', 'операции', 'операций']
  it.each([
    [0, 'операций'], [1, 'операция'], [2, 'операции'], [4, 'операции'], [5, 'операций'], [9, 'операций'],
    [10, 'операций'], [11, 'операций'], [12, 'операций'], [14, 'операций'], [19, 'операций'],
    [20, 'операций'], [21, 'операция'], [22, 'операции'], [25, 'операций'],
    [100, 'операций'], [101, 'операция'], [111, 'операций'], [112, 'операций'], [121, 'операция'], [1011, 'операций'],
  ])('%i → %s', (n, word) => {
    expect(plural(n, F)).toBe(word)
  })
  it('отрицательные числа склоняются по модулю', () => {
    expect(plural(-1, F)).toBe('операция')
    expect(plural(-11, F)).toBe('операций')
  })
})
