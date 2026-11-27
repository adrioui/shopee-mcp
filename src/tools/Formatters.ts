import { Array, Match, Option, Predicate, Result, Schema } from "effect"
import {
  FlashSaleItemsPayload,
  OrderListPayload,
  type CartBlock,
  type CartItem,
  type CollectedResponse,
  type FlashSaleItem,
  type ItemBasic,
  type NotificationAction,
  type OrderDetail,
  type OrderListDetail,
  type PdpAttribute,
  type PdpItem,
  type PdpModel,
  type PdpPriceValue,
  type PdpResponse,
  type PdpShipping,
  type PdpShop,
  type Rating,
  type RatingSummary,
  type SearchItem,
  type SearchResult,
  type ShopBase,
  type ShopTabResponse,
  type ShopVoucher,
  type VariantRow,
  type WalletVoucher
} from "../api/Schemas.js"
import { truncate } from "../Errors.js"
import { formatPrice } from "../Price.js"

// ─── Search Helpers ───────────────────────────────────────────────────────────

const fromItemBasic = (b: ItemBasic): SearchResult => ({
  itemid: b.itemid,
  shopid: b.shopid,
  name: b.name,
  price: b.price,
  priceMin: b.price_min,
  priceMax: b.price_max,
  priceBeforeDiscount: b.price_before_discount,
  currency: b.currency,
  ratingStar: b.item_rating?.rating_star,
  sold: b.historical_sold || b.sold,
  shopLocation: b.shop_location,
  isOfficialShop: b.is_official_shop
})

const fromCard = (it: SearchItem): Option.Option<SearchResult> => {
  const d = it.item_data ?? undefined
  const asset = it.item_card_displayed_asset ?? undefined
  const p = d?.item_card_display_price ?? undefined
  const name = asset?.name?.trim()

  if (name === undefined || name === "" || p === undefined || !Predicate.isNumber(p.price)) {
    return Option.none()
  }

  const soldCount = d?.item_card_display_sold_count ?? undefined
  const before = p.original_price ?? p.strikethrough_price ?? undefined
  const real = it.real_items?.[0]

  return Option.some({
    itemid: real?.item_id ?? it.itemid ?? d?.itemid ?? 0,
    shopid: real?.shop_id ?? it.shopid ?? d?.shopid ?? 0,
    name,
    price: p.price,
    priceBeforeDiscount: before ?? undefined,
    currency: undefined,
    ratingStar: d?.item_rating?.rating_star,
    sold: soldCount?.historical_sold_count ?? soldCount?.monthly_sold_count ?? undefined,
    soldText:
      soldCount?.historical_sold_count_text ?? soldCount?.monthly_sold_count_text ?? undefined,
    shopLocation: asset?.shop_location ?? undefined,
    isOfficialShop: undefined
  })
}

export const flattenSearchItems = (
  items: ReadonlyArray<SearchItem> | null | undefined
): ReadonlyArray<SearchResult> =>
  (items ?? []).flatMap((it): ReadonlyArray<SearchResult> => {
    if (it.item_basic !== null && it.item_basic !== undefined) {
      return [fromItemBasic(it.item_basic)]
    }

    if (it.item_data != null || it.item_card_displayed_asset != null) {
      const card = fromCard(it)

      if (Option.isSome(card)) return [card.value]
    }

    if (it.real_items !== null && it.real_items !== undefined && it.real_items.length > 0) {
      return Array.filterMap(it.real_items, (ri) =>
        ri.item_basic !== null && ri.item_basic !== undefined
          ? Result.succeed(fromItemBasic(ri.item_basic))
          : Result.failVoid
      )
    }

    return []
  })

const searchPriceText = (r: SearchResult, fallbackCurrency: string): string => {
  const currency = r.currency || fallbackCurrency

  if (r.priceMin && r.priceMax && r.priceMin !== r.priceMax) {
    return `${formatPrice(r.priceMin, currency)} – ${formatPrice(r.priceMax, currency)}`
  }

  return formatPrice(r.price, currency)
}

export interface ResultListOptions {
  readonly title: string
  readonly page: number
  readonly limit: number
  readonly totalCount: number
  readonly nomore: boolean
  readonly baseUrl: string
  readonly currency: string
}

export const formatResultList = (
  items: ReadonlyArray<SearchResult>,
  opts: ResultListOptions
): string => {
  const { page, limit, totalCount, baseUrl, currency } = opts
  const shown = items.slice(0, limit)
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / items.length) : page

  const lines: globalThis.Array<string> = [
    opts.title,
    `📊 ${totalCount.toLocaleString("id-ID")} total products | Page ${page}${totalPages > 1 ? `/${totalPages}` : ""}`,
    ""
  ]

  shown.forEach((r, i) => {
    const rank = (page - 1) * limit + i + 1
    const rating = r.ratingStar ? `⭐ ${r.ratingStar.toFixed(1)}` : "⭐ N/A"

    const soldLabel = r.soldText
      ? r.soldText
      : r.sold
        ? `${r.sold.toLocaleString("id-ID")} sold`
        : ""

    const soldText = soldLabel !== "" ? ` | 📦 ${soldLabel}` : ""
    const official = r.isOfficialShop ? " [Shopee Mall]" : ""
    const url = `${baseUrl}/product/${r.shopid}/${r.itemid}`

    lines.push(`${rank}. **${r.name}**`)
    lines.push(`   💰 ${searchPriceText(r, currency)}`)
    lines.push(
      `   ${rating}${soldText} | 🏪 ${r.shopLocation || "N/A"}${official} | 🆔 ${r.itemid}`
    )
    lines.push(`   🔗 ${url}`)

    if (i < shown.length - 1) lines.push("")
  })

  if (!opts.nomore) {
    lines.push("", `📄 Use page=${page + 1} to see more results.`)
  }

  return lines.join("\n")
}

export interface SearchFilters {
  readonly minPrice?: number | undefined
  readonly maxPrice?: number | undefined
  readonly minRating?: number | undefined
  readonly location?: string | undefined
  readonly officialMallOnly?: boolean | undefined
}

const searchSortParams = (sort: string): { readonly sortBy: string; readonly order?: string } =>
  Match.value(sort).pipe(
    Match.when("newest", () => ({ sortBy: "ctime" })),
    Match.when("top_sales", () => ({ sortBy: "sales" })),
    Match.when("price_low", () => ({ sortBy: "price", order: "asc" })),
    Match.when("price_high", () => ({ sortBy: "price", order: "desc" })),
    Match.orElse(() => ({ sortBy: "relevancy" }))
  )

export const buildSearchPath = (
  query: string,
  page: number,
  sort: string,
  filters: SearchFilters = {}
): string => {
  const { sortBy, order } = searchSortParams(sort)
  const qs = new URLSearchParams({ keyword: query, page: String(page - 1), sortBy })

  if (order !== undefined) qs.set("order", order)

  if (filters.minPrice !== undefined) qs.set("minPrice", String(filters.minPrice))

  if (filters.maxPrice !== undefined) qs.set("maxPrice", String(filters.maxPrice))

  if (filters.minRating !== undefined) qs.set("ratingFilter", String(filters.minRating))

  if (filters.location) qs.set("locations", filters.location)

  if (filters.officialMallOnly) qs.set("officialMall", "true")

  return `/search?${qs.toString()}`
}

// ─── Product Detail Helpers ───────────────────────────────────────────────────

export const priceText = (p: PdpPriceValue, currency: string): string => {
  if (p.range_min >= 0 && p.range_max >= 0 && p.range_min !== p.range_max) {
    return `${formatPrice(p.range_min, currency)} – ${formatPrice(p.range_max, currency)}`
  }

  return formatPrice(p.single_value, currency)
}

export const parseProductUrl = (
  url: string
): Option.Option<{ readonly shopId: string; readonly itemId: string }> => {
  const m1 = url.match(/\/product\/(\d+)\/(\d+)/)

  if (m1 !== null) return Option.some({ shopId: m1[1], itemId: m1[2] })

  const m2 = url.match(/-i\.(\d+)\.(\d+)/)

  if (m2 !== null) return Option.some({ shopId: m2[1], itemId: m2[2] })

  return Option.none()
}

export const resolveProductIds = (
  shopId?: string,
  itemId?: string,
  url?: string
): Option.Option<{ readonly shopId: string; readonly itemId: string }> => {
  if (shopId !== undefined && shopId !== "" && itemId !== undefined && itemId !== "") {
    return Option.some({ shopId, itemId })
  }

  return url !== undefined && url !== "" ? parseProductUrl(url) : Option.none()
}

export const specLines = (
  attrs: ReadonlyArray<PdpAttribute> | null | undefined,
  max = 12
): ReadonlyArray<string> => {
  const out: globalThis.Array<string> = []

  for (const a of attrs ?? []) {
    if (out.length >= max) break

    if (a.id !== null && a.id !== undefined && a.value !== "" && a.value.trim() !== "-") {
      out.push(`  • ${a.name}: ${a.value}`)
    }
  }

  return out
}

export const shippingLines = (
  ship: PdpShipping | null | undefined,
  currency: string
): ReadonlyArray<string> => {
  if (ship === null || ship === undefined) return []

  const lines: globalThis.Array<string> = []
  const from = ship.shipping_fee_info?.ship_from_location

  if (from) lines.push(`  📍 Ships from: ${from}`)

  const fee = ship.shipping_fee_info?.price

  if (fee !== null && fee !== undefined) {
    if (fee.single_value >= 0) {
      lines.push(`  💸 Shipping fee: ${formatPrice(fee.single_value, currency)}`)
    } else if (fee.range_max > 0) {
      lines.push(`  💸 Shipping fee: ${priceText(fee, currency)}`)
    }
  }

  const min = ship.free_shipping?.min_spend

  if (ship.free_shipping?.has_fss && min !== null && min !== undefined && min.single_value > 0) {
    lines.push(`  🚚 Free shipping on orders over ${formatPrice(min.single_value, currency)}`)
  }

  for (const ch of (ship.ungrouped_channel_infos ?? []).slice(0, 3)) {
    const edt = ch.channel_delivery_info?.edt_text

    if (edt) lines.push(`  🕒 ${ch.name}: ${edt}`)
  }

  return lines
}

export const sellerLines = (shop: PdpShop | null | undefined): ReadonlyArray<string> => {
  if (shop === null || shop === undefined) return []

  const badges = [
    shop.is_official_shop ? "Shopee Mall" : "",
    shop.is_preferred_plus_seller ? "Star+" : "",
    shop.is_shopee_verified ? "Verified" : ""
  ].filter(Boolean)

  const stats = [
    shop.rating_star ? `⭐ ${shop.rating_star.toFixed(1)}` : "",
    shop.response_rate !== undefined && shop.response_rate !== null
      ? `💬 ${shop.response_rate}% response`
      : "",
    shop.follower_count !== undefined && shop.follower_count !== null
      ? `👥 ${shop.follower_count.toLocaleString("id-ID")} followers`
      : ""
  ].filter(Boolean)

  return [
    `  🏪 ${shop.name}${badges.length > 0 ? ` [${badges.join(", ")}]` : ""} — Shop ID \`${shop.shopid}\``,
    stats.length > 0 ? `  ${stats.join(" | ")}` : "",
    shop.vacation ? "  🏖 Seller is on vacation — orders may be delayed" : ""
  ].filter(Boolean)
}

export const formatProductDetail = (
  data: PdpResponse,
  baseUrl: string,
  fallbackCurrency: string
): string => {
  const item = data.data?.item
  const pp = data.data?.product_price

  if (item === undefined || pp === undefined) {
    return "❌ Could not read product data. Check the shopId/itemId or URL."
  }

  const currency = item.currency || fallbackCurrency
  const price = priceText(pp.price, currency)

  const before =
    pp.price_before_discount !== null &&
    pp.price_before_discount !== undefined &&
    pp.price_before_discount.single_value > pp.price.single_value
      ? pp.price_before_discount
      : undefined

  const discountPct =
    before !== undefined
      ? Math.round((1 - pp.price.single_value / before.single_value) * 100)
      : 0

  const review = data.data?.product_review

  const conditionLabel =
    item.condition === 1 ? "New" : item.condition ? "Used" : "Unknown"

  const rating = item.item_rating?.rating_star
  const ratingCount = review?.total_rating_count ?? review?.cmt_count ?? 0

  const soldText =
    review?.sold_count_display ??
    review?.historical_sold_display ??
    review?.global_sold_display

  const breadcrumb = (item.categories ?? []).map((c) => c.display_name).join(" › ")
  const stock = item.stock ?? item.normal_stock ?? undefined

  const lines: globalThis.Array<string> = [
    `📦 **${item.title}**`,
    "",
    `💰 **Price:** ${price}${before !== undefined ? ` ~~${priceText(before, currency)}~~ (-${discountPct}%)` : ""}`,
    "",
    "📊 **Stats:**",
    `  ⭐ Rating: ${rating ? rating.toFixed(2) : "N/A"}${ratingCount ? ` (${ratingCount.toLocaleString("id-ID")} reviews)` : ""}`,
    soldText ? `  ✅ Sold: ${soldText}` : "",
    "",
    "📋 **Details:**",
    item.brand ? `  🏷 Brand: ${item.brand}` : "",
    `  🆕 Condition: ${conditionLabel}`,
    breadcrumb !== "" ? `  🗂 Category: ${breadcrumb}` : "",
    stock !== undefined && stock !== null ? `  📦 Stock: ${stock.toLocaleString("id-ID")}` : "",
    item.is_free_shipping ? "  🚚 Free shipping" : "",
    `  📍 Location: ${item.shop_location || "N/A"}`,
    `  🆔 Item ID: \`${item.item_id}\` | Shop ID: \`${item.shop_id}\``
  ].filter((l) => l !== "")

  const specs = specLines(data.data?.product_attributes?.attrs)

  if (specs.length > 0) lines.push("", "🧾 **Specs:**", ...specs)

  const shipping = shippingLines(data.data?.product_shipping, currency)

  if (shipping.length > 0) lines.push("", "🚚 **Shipping:**", ...shipping)

  const seller = sellerLines(data.data?.shop_detailed)

  if (seller.length > 0) lines.push("", "🏪 **Seller:**", ...seller)

  if (item.models !== null && item.models !== undefined && item.models.length > 1) {
    lines.push(
      "",
      `🎚 ${item.models.length} variants — use get_product_variants for per-variant prices.`
    )
  }

  if (item.description) {
    lines.push(
      "",
      "📝 **Description:**",
      truncate(item.description.replace(/\n+/g, " ").trim(), 400)
    )
  }

  lines.push("", `🔗 ${baseUrl}/product/${item.shop_id}/${item.item_id}`)

  return lines.join("\n")
}

// ─── Variants Helpers ─────────────────────────────────────────────────────────

export const buildVariantRows = (
  models: ReadonlyArray<PdpModel> | null | undefined,
  stockByName?: ReadonlyMap<string, number>
): ReadonlyArray<VariantRow> =>
  (models ?? []).map((m) => ({
    modelId: m.model_id,
    name: m.name,
    price: m.price,
    priceBeforeDiscount: m.price_before_discount ?? undefined,
    stock: stockByName?.get(m.name),
    inStock: m.has_stock ?? undefined,
    isPreOrder: m.extinfo?.is_pre_order
  }))

const stockLabel = (r: VariantRow): string => {
  if (r.stock !== undefined) return `📦 ${r.stock.toLocaleString("en-US")} in stock`

  if (r.inStock === true) return "✅ In stock"

  if (r.inStock === false) return "❌ Out of stock"

  return "📦 Stock unknown"
}

export const formatVariants = (
  item: PdpItem,
  rows: ReadonlyArray<VariantRow>,
  includeStock: boolean,
  baseUrl: string,
  fallbackCurrency: string
): string => {
  if (rows.length === 0) {
    return (
      `📦 **${item.title}**\n\nThis listing has no variants — it is sold as a single option.\n` +
      "Use get_product_detail for its price and stock."
    )
  }

  const currency = item.currency || fallbackCurrency
  const tiers = item.tier_variations ?? []

  const lines: globalThis.Array<string> = [
    `🎚 **${item.title}**`,
    `${rows.length} variant${rows.length === 1 ? "" : "s"}${tiers.length > 0 ? ` | ${tiers.map((t) => t.name).join(" × ")}` : ""}`,
    ""
  ]

  rows.forEach((r, i) => {
    const before =
      r.priceBeforeDiscount && r.priceBeforeDiscount > r.price
        ? ` ~~${formatPrice(r.priceBeforeDiscount, currency)}~~`
        : ""

    lines.push(`${i + 1}. **${r.name}**`)
    lines.push(`   💰 ${formatPrice(r.price, currency)}${before}`)
    lines.push(
      `   ${stockLabel(r)}${r.isPreOrder ? " | ⏳ Pre-order" : ""} | 🆔 model_id: \`${r.modelId}\``
    )

    if (i < rows.length - 1) lines.push("")
  })

  if (!includeStock) {
    lines.push("", "💡 Set `includeStock=true` for exact per-variant stock counts.")
  } else if (tiers.length > 1) {
    lines.push(
      "",
      `⚠️ This listing varies across ${tiers.length} options (${tiers.map((t) => t.name).join(" × ")}), ` +
        "so exact counts are unavailable — showing availability instead."
    )
  } else {
    const got = rows.filter((r) => r.stock !== undefined).length

    if (got < rows.length) {
      lines.push(
        "",
        `⚠️ Exact counts for ${got} of ${rows.length} variants — the rest show availability ` +
          "only (each count costs a round trip, and the lookup stops before the request " +
          "times out). Query a narrower listing for full counts."
      )
    }
  }

  lines.push("", `🔗 ${baseUrl}/product/${item.shop_id}/${item.item_id}`)

  return lines.join("\n")
}

// ─── Reviews Helpers ──────────────────────────────────────────────────────────

export const starBreakdown = (summary: RatingSummary): string =>
  [5, 4, 3, 2, 1]
    .map((star) => `${star}★ ${(summary.rating_count[star - 1] ?? 0).toLocaleString("id-ID")}`)
    .join(" · ")

export const formatReview = (r: Rating, index: number): string => {
  const stars = "★".repeat(r.rating_star) + "☆".repeat(Math.max(0, 5 - r.rating_star))
  const date = new Date(r.ctime * 1000).toISOString().slice(0, 10)
  const author = r.anonymous || !r.author_username ? "Anonymous" : r.author_username
  const variant = r.product_items?.[0]?.model_name
  const media = (r.images?.length ?? 0) + (r.videos?.length ?? 0)

  const meta = [
    stars,
    author,
    date,
    variant ? `variant: ${variant}` : "",
    media > 0 ? `📷 ${media}` : "",
    r.like_count ? `👍 ${r.like_count}` : ""
  ].filter(Boolean)

  const lines = [`${index}. ${meta.join(" | ")}`]
  const comment = (r.comment ?? "").replace(/\s+/g, " ").trim()

  lines.push(`   ${comment !== "" ? truncate(comment, 350) : "(no written comment)"}`)

  const reply = r.ItemRatingReply?.comment?.replace(/\s+/g, " ").trim()

  if (reply) lines.push(`   ↳ Seller: ${truncate(reply, 200)}`)

  return lines.join("\n")
}

// ─── Shop Helpers ─────────────────────────────────────────────────────────────

export const formatDuration = (seconds: number): string => {
  const minutes = Math.max(1, Math.round(seconds / 60))

  if (minutes < 60) return `${minutes} min`

  const hours = Math.round(minutes / 60)

  if (hours < 24) return `${hours} h`

  return `${Math.round(hours / 24)} days`
}

export const formatShop = (
  s: ShopBase,
  baseUrl: string,
  now: number = Date.now()
): string => {
  const badges = [
    s.is_official_shop ? "Shopee Mall" : "",
    s.is_preferred_plus_seller ? "Star+" : "",
    s.is_shopee_verified ? "Verified" : ""
  ].filter(Boolean)

  const username = s.account?.username

  const lines: globalThis.Array<string> = [
    `🏪 **${s.name}**${badges.length > 0 ? ` [${badges.join(", ")}]` : ""}`,
    username ? `👤 @${username}` : "",
    "",
    "📊 **Stats:**",
    s.rating_star ? `  ⭐ Shop rating: ${s.rating_star.toFixed(2)}` : "",
    s.item_count !== undefined ? `  📦 Products: ${s.item_count.toLocaleString("id-ID")}` : "",
    s.follower_count !== undefined
      ? `  👥 Followers: ${s.follower_count.toLocaleString("id-ID")}`
      : "",
    s.response_rate !== undefined
      ? `  💬 Chat response: ${s.response_rate}%${s.response_time ? ` (within ~${formatDuration(s.response_time)})` : ""}`
      : "",
    s.ctime ? `  📅 Joined: ${new Date(s.ctime * 1000).toISOString().slice(0, 10)}` : "",
    s.last_active_time
      ? `  🕒 Last active: ${formatDuration(Math.max(0, now / 1000 - s.last_active_time))} ago`
      : "",
    s.vacation ? "  🏖 On vacation — orders may be delayed" : "",
    `  🆔 Shop ID: \`${s.shopid}\``
  ]

  const desc = s.description?.replace(/\s+/g, " ").trim()

  if (desc) lines.push("", "📝 **About:**", truncate(desc, 400))

  lines.push(
    "",
    `🔗 ${baseUrl}/${username ?? `shop/${s.shopid}`}`,
    "💡 Use get_shop_products to browse this shop’s listings."
  )

  return lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== "")).join("\n")
}

export const buildShopProductsPath = (shopId: string, page: number, sort: string): string => {
  const { sortBy, order }: { readonly sortBy: string; readonly order?: string } = Match.value(
    sort
  ).pipe(
    Match.when("newest", () => ({ sortBy: "ctime" })),
    Match.when("top_sales", () => ({ sortBy: "sales" })),
    Match.when("price_low", () => ({ sortBy: "price", order: "asc" })),
    Match.when("price_high", () => ({ sortBy: "price", order: "desc" })),
    Match.orElse(() => ({ sortBy: "pop" }))
  )

  const qs = new URLSearchParams({ shop: shopId, page: String(page - 1), sortBy })

  if (order !== undefined) qs.set("order", order)

  return `/search?${qs.toString()}`
}

// ─── Flash Sale Helpers ───────────────────────────────────────────────────────

const decodeFlashItems = Schema.decodeUnknownOption(FlashSaleItemsPayload)

export const collectFlashItems = (
  collected: ReadonlyArray<CollectedResponse>,
  itemsApi = "flash_sale/flash_sale_batch_get_items"
): ReadonlyArray<FlashSaleItem> => {
  const seen = new Set<string>()
  const out: globalThis.Array<FlashSaleItem> = []

  for (const c of collected) {
    if (!c.url.includes(itemsApi)) continue

    const parsed = decodeFlashItems(c.json)

    if (Option.isNone(parsed)) continue

    for (const it of parsed.value.data?.items ?? []) {
      const key = `${it.shopid}/${it.itemid}`

      if (seen.has(key)) continue

      seen.add(key)
      out.push(it)
    }
  }

  return out
}

export const formatTime = (unixSeconds: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(unixSeconds * 1000))

export const flashStockText = (it: FlashSaleItem): string => {
  if (!it.flash_sale_stock || it.stock === undefined) return ""

  const sold = Math.max(0, it.flash_sale_stock - it.stock)

  return it.stock === 0
    ? "🔥 Sold out"
    : `📦 ${sold.toLocaleString("id-ID")}/${it.flash_sale_stock.toLocaleString("id-ID")} claimed`
}

// ─── Account Helpers ──────────────────────────────────────────────────────────

export const humanizeLabel = (key?: string): string => {
  if (key === undefined || key === "") return "Unknown"

  const words = key.replace(/^label_/, "").replace(/_/g, " ").trim()

  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const formatDateTime = (unixSeconds: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(unixSeconds * 1000))

export const orderTabType = (
  status: "all" | "to_ship" | "to_receive" | "completed" | "cancelled"
): number =>
  Match.value(status).pipe(
    Match.when("all", () => 6),
    Match.when("to_ship", () => 7),
    Match.when("to_receive", () => 8),
    Match.when("completed", () => 3),
    Match.when("cancelled", () => 4),
    Match.exhaustive
  )

const decodeOrderList = Schema.decodeUnknownOption(OrderListPayload)

export const collectOrders = (
  collected: ReadonlyArray<CollectedResponse>
): ReadonlyArray<OrderListDetail> => {
  const seen = new Set<number>()
  const out: globalThis.Array<OrderListDetail> = []

  for (const c of collected) {
    const parsed = decodeOrderList(c.json)

    if (Option.isNone(parsed)) continue

    const j = parsed.value

    const list: ReadonlyArray<OrderListDetail | undefined> =
      j.data?.details_list ??
      (j.new_data?.order_or_checkout_data ?? []).map((e) => e.order_list_detail)

    for (const o of list) {
      const id = o?.info_card?.order_id

      if (o === undefined || id === undefined || seen.has(id)) continue

      seen.add(id)
      out.push(o)
    }
  }

  return out
}

export const formatOrder = (o: OrderListDetail, index: number, currency: string): string => {
  const card = o.info_card

  if (card === undefined) return ""

  const status = humanizeLabel(
    o.status?.list_view_status_label?.text ?? o.status?.status_label?.text
  )

  const lines: globalThis.Array<string> = [`${index}. **Order \`${card.order_id}\`** — ${status}`]

  for (const c of card.order_list_cards ?? []) {
    if (c.shop_info?.shop_name) lines.push(`   🏪 ${c.shop_info.shop_name}`)

    for (const g of c.product_info?.item_groups ?? []) {
      for (const it of g.items ?? []) {
        const price = it.order_price ?? it.item_price

        lines.push(
          `   • ${truncate(it.name, 90)}${it.model_name ? ` (${it.model_name})` : ""} × ${it.amount}` +
            (price !== undefined ? ` — ${formatPrice(price, currency)}` : "")
        )
      }
    }
  }

  if (card.final_total !== undefined) {
    lines.push(`   💰 Total: ${formatPrice(card.final_total, currency)}`)
  }

  return lines.join("\n")
}

export const formatOrderDetail = (
  orderId: string,
  d: OrderDetail,
  baseUrl: string,
  fallbackCurrency: string,
  timeZone: string
): string => {
  const currency = d.info_card?.currency || fallbackCurrency
  const p = d.pc_processing_info ?? {}

  const lines: globalThis.Array<string> = [
    `🧾 **Order \`${orderId}\`**${p.order_sn ? ` (${p.order_sn})` : ""}`,
    `📌 Status: ${humanizeLabel(d.status?.status_label?.text)}`,
    "",
    "📦 **Items:**"
  ]

  for (const c of d.info_card?.parcel_cards ?? []) {
    if (c.shop_info?.shop_name) lines.push(`  🏪 ${c.shop_info.shop_name}`)

    for (const g of c.product_info?.item_groups ?? []) {
      for (const it of g.items ?? []) {
        const price = it.order_price ?? it.item_price

        lines.push(
          `  • ${truncate(it.name, 90)}${it.model_name ? ` (${it.model_name})` : ""} × ${it.amount}` +
            (price !== undefined ? ` — ${formatPrice(price, currency)}` : "") +
            ` | 🔗 ${baseUrl}/product/${it.shop_id}/${it.item_id}`
        )
      }
    }
  }

  if (d.info_card?.final_total !== undefined) {
    lines.push(`  💰 Total paid: ${formatPrice(d.info_card.final_total, currency)}`)
  }

  const pay = d.payment_method?.payment_channel_name?.text

  if (pay) lines.push(`  💳 Payment: ${pay}`)

  const timeline: ReadonlyArray<readonly [string, number | undefined]> = [
    ["Ordered", p.create_time],
    ["Paid", p.pay_time],
    ["Shipped", p.shipping_confirm_time],
    ["Delivered", p.delivery_time],
    ["Completed", p.complete_time]
  ]

  const stepLines = Array.filterMap(timeline, ([label, t]) =>
    t !== undefined && t > 0
      ? Result.succeed(`  ${label}: ${formatDateTime(t, timeZone)}`)
      : Result.failVoid
  )

  if (stepLines.length > 0) {
    lines.push("", "🗓 **Timeline:**", ...stepLines)
  }

  const carrier = d.pc_shipping?.fulfilment_carrier?.text
  const parcels = d.pc_shipping?.forder_shipping_info_list ?? []

  if (carrier || parcels.length > 0) {
    lines.push("", "🚚 **Shipping:**")

    if (carrier) lines.push(`  Courier: ${carrier}`)

    for (const parcel of parcels) {
      if (parcel.tracking_number) lines.push(`  Tracking no.: ${parcel.tracking_number}`)

      for (const ev of (parcel.tracking_info_list ?? []).slice(0, 6)) {
        lines.push(`  • ${formatDateTime(ev.ctime, timeZone)} — ${(ev.description ?? "").trim()}`)
      }
    }
  }

  if (p.is_rated === false && p.complete_time) {
    lines.push("", "⭐ Not rated yet.")
  }

  return lines.join("\n")
}

export const voucherBenefit = (v: WalletVoucher, currency: string): string => {
  if (v.discount_value) return `${formatPrice(v.discount_value, currency)} off`

  if (v.discount_percentage) {
    return `${v.discount_percentage}% off${v.discount_cap ? ` (max ${formatPrice(v.discount_cap, currency)})` : ""}`
  }

  if (v.reward_percentage) {
    return `${v.reward_percentage}% coins cashback${v.reward_cap ? ` (max ${(v.reward_cap / 100000).toLocaleString("id-ID")} coins)` : ""}`
  }

  return "Discount"
}

export const formatVoucher = (
  v: WalletVoucher,
  index: number,
  currency: string,
  timeZone: string
): string => {
  const scope = v.shop_name || v.icon_text || "Shopee"

  const meta = [
    v.min_spend ? `min. spend ${formatPrice(v.min_spend, currency)}` : "no min. spend",
    v.end_time ? `until ${formatDateTime(v.end_time, timeZone)}` : "",
    v.percentage_used ? `${v.percentage_used}% used up` : ""
  ].filter(Boolean)

  return `${index}. **${voucherBenefit(v, currency)}** — ${scope}${v.voucher_code ? ` | \`${v.voucher_code}\`` : ""}\n   ${meta.join(" | ")}`
}

export const notificationTab = (
  category: "order" | "promotion" | "shopee"
): { readonly path: string; readonly cate: number } =>
  Match.value(category).pipe(
    Match.when("order", () => ({ path: "order", cate: 4 })),
    Match.when("promotion", () => ({ path: "promotion", cate: 1 })),
    Match.when("shopee", () => ({ path: "shopee", cate: 6 })),
    Match.exhaustive
  )

export const decodeNotificationText = (hex?: string): string => {
  if (hex === undefined || hex === "") return ""

  const decoded =
    /^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0
      ? Buffer.from(hex, "hex").toString("utf8")
      : hex

  return decoded.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
}

export const formatNotification = (
  a: NotificationAction,
  index: number,
  timeZone: string
): string => {
  const title = decodeNotificationText(a.title)
  const body = decodeNotificationText(a.content)
  const when = a.createtime ? formatDateTime(a.createtime, timeZone) : ""
  const order = a.id_info?.orderid ? ` | order \`${a.id_info.orderid}\`` : ""

  return `${index}. ${title !== "" ? `**${title}**` : ""}${when !== "" ? ` (${when})` : ""}${order}\n   ${truncate(body, 240)}`
}

// ─── Cart & Actions Helpers ───────────────────────────────────────────────────

export const formatCart = (
  blocks: ReadonlyArray<CartBlock>,
  fallbackCurrency: string,
  baseUrl: string
): string => {
  const groups = blocks.filter((b) => (b.items?.length ?? 0) > 0)

  if (groups.length === 0) return "🛒 Your Shopee cart is empty."

  let count = 0
  let subtotal = 0
  let currency = fallbackCurrency
  const lines: globalThis.Array<string> = []

  for (const b of groups) {
    lines.push(`🏪 **${b.shops?.[0]?.shopname ?? `Shop ${b.shops?.[0]?.shopid ?? "?"}`}**`)

    for (const it of b.items ?? []) {
      currency = it.currency || currency
      count += it.quantity
      subtotal += it.price * it.quantity

      const variant = it.model_name ? ` (${it.model_name})` : ""

      lines.push(
        `  • ${it.name}${variant}`,
        `    ${it.quantity} × ${formatPrice(it.price, currency)}` +
          (it.modelid ? ` | model_id: \`${it.modelid}\`` : "") +
          ` | 🔗 ${baseUrl}/product/${it.shopid}/${it.itemid}`
      )
    }

    lines.push("")
  }

  lines.unshift(
    `🛒 **Shopee Cart** — ${count} item${count === 1 ? "" : "s"}, ${formatPrice(subtotal, currency)} before vouchers & shipping`,
    ""
  )

  return lines.join("\n").trim()
}

export const modelOptionLabels = (
  item: PdpItem,
  model: PdpModel
): Option.Option<ReadonlyArray<string>> => {
  const tiers = item.tier_variations ?? []
  const indexes = model.extinfo?.tier_index ?? []

  if (tiers.length === 0) return Option.some([])

  if (indexes.length !== tiers.length) return Option.none()

  const labels: globalThis.Array<string> = []

  for (let tierIndex = 0; tierIndex < indexes.length; tierIndex++) {
    const label = tiers[tierIndex]?.options?.[indexes[tierIndex]]

    if (!Predicate.isString(label)) return Option.none()

    labels.push(label)
  }

  return Option.some(labels)
}

export interface CartItemMatch {
  readonly matches: ReadonlyArray<CartItem>
  readonly item: Option.Option<CartItem>
}

export const findCartItem = (
  blocks: ReadonlyArray<CartBlock>,
  itemId: string,
  modelId?: string
): CartItemMatch => {
  const matches = blocks
    .flatMap((b) => b.items ?? [])
    .filter(
      (it) =>
        String(it.itemid) === itemId &&
        (modelId === undefined || String(it.modelid) === modelId)
    )

  return {
    matches,
    item: matches.length === 1 ? Option.some(matches[0]) : Option.none()
  }
}

export const shopVouchersFrom = (tab: ShopTabResponse | undefined): ReadonlyArray<ShopVoucher> =>
  (tab?.data?.decoration ?? []).flatMap((d) => d.shop_voucher?.voucher_list ?? [])

export const formatShopVouchers = (
  shopId: string,
  vouchers: ReadonlyArray<ShopVoucher>,
  currency: string,
  timeZone: string
): string => {
  if (vouchers.length === 0) return `🎟 Shop \`${shopId}\` has no claimable vouchers right now.`

  const lines: globalThis.Array<string> = [`🎟 **Vouchers from shop \`${shopId}\`**`, ""]

  vouchers.forEach((v, i) => {
    const meta = [
      v.min_spend ? `min. spend ${formatPrice(v.min_spend, currency)}` : "no min. spend",
      v.end_time ? `until ${formatDateTime(v.end_time, timeZone)}` : "",
      v.percentage_used ? `${v.percentage_used}% used up` : "",
      v.is_claimed_before ? "✅ claimed" : ""
    ].filter(Boolean)

    lines.push(
      `${i + 1}. **${voucherBenefit(v, currency)}** | code \`${v.voucher_code}\``,
      `   ${meta.join(" | ")}`
    )
  })

  return lines.join("\n")
}
