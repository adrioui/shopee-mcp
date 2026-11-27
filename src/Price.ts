import { Match } from "effect"

interface CurrencyFormat {
  readonly symbol: string
  readonly locale: string
  readonly decimals: number
}

const currencyFormatFor = (currency: string): CurrencyFormat | undefined =>
  Match.value(currency).pipe(
    Match.when("IDR", () => ({ symbol: "Rp", locale: "id-ID", decimals: 0 })),
    Match.when("MYR", () => ({ symbol: "RM", locale: "en-MY", decimals: 2 })),
    Match.when("SGD", () => ({ symbol: "S$", locale: "en-SG", decimals: 2 })),
    Match.when("TWD", () => ({ symbol: "NT$", locale: "zh-TW", decimals: 0 })),
    Match.orElse(() => undefined)
  )

/** Render a raw Shopee price (real amount × 100000) for display. */
export const formatPrice = (raw: number, currency = "IDR"): string => {
  const amount = raw / 100000
  const fmt = currencyFormatFor(currency)

  if (fmt === undefined) {
    return `${currency} ${amount.toLocaleString("id-ID")}`
  }

  return `${fmt.symbol}${amount.toLocaleString(fmt.locale, {
    minimumFractionDigits: fmt.decimals,
    maximumFractionDigits: fmt.decimals
  })}`
}
