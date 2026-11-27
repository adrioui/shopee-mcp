import { Option, Schema } from "effect"

/** Shopee's anti-bot/anti-fraud rejection — almost always means "not logged in / detected". */
export const SHOPEE_ANTIBOT_ERROR = 90309999

export class ShopeeApiError extends Schema.TaggedError<ShopeeApiError>()("ShopeeApiError", {
  message: Schema.String,
  statusCode: Schema.optional(Schema.Int),
  endpoint: Schema.optional(Schema.String),
  shopeeError: Schema.optional(Schema.Int)
}) {}

export class ShopeeAuthRequiredError extends Schema.TaggedError<ShopeeAuthRequiredError>()(
  "ShopeeAuthRequiredError",
  {
    endpoint: Schema.optional(Schema.String)
  }
) {}

export type ShopeeError = ShopeeApiError | ShopeeAuthRequiredError

export const AUTH_REQUIRED_MESSAGE =
  "🔒 Not signed in to Shopee.\n\n" +
  "Shopee blocks anonymous product requests. Run this once in the project folder:\n" +
  "`pnpm run login`\n\n" +
  "A Chromium window opens — log into your Shopee account, then come back and press Enter. " +
  "The session is saved and reused; retry your request afterwards."

export const formatShopeeApiError = (error: ShopeeApiError): string => {
  const base = `❌ Shopee API Error: ${error.message}`
  const status = Option.fromNullishOr(error.statusCode)

  if (Option.isNone(status)) return base

  if (status.value === 429) {
    return `${base}\n\n💡 Tip: Rate limited by Shopee. Please wait a moment before retrying.`
  }

  if (status.value >= 500) {
    return `${base}\n\n💡 Tip: Shopee is having a temporary issue. Please retry shortly.`
  }

  return base
}

/** Truncate text to max chars. */
export const truncate = (text: string, maxLen = 200): string => {
  if (text.length <= maxLen) return text

  return `${text.slice(0, maxLen).trimEnd()}…`
}
