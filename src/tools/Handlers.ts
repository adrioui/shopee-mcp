import { Effect, Layer, Option, Schema } from "effect"
import { McpServer } from "effect/ai"
import type { Page } from "playwright"
import { AccountMode } from "../AccountMode.js"
import {
  ApiErrorEnvelope,
  CartResponse,
  CoinsSummaryResponse,
  CoinsTransactionsResponse,
  FlashSaleSessionsPayload,
  NotificationsResponse,
  OrderDetailResponse,
  OrderListPayload,
  PdpResponse,
  RatingsResponse,
  SaveVoucherResponse,
  SelectVariationResponse,
  ShopBaseResponse,
  ShopTabResponse,
  VoucherWalletResponse,
  type CartItem,
  type CollectedResponse,
  type PdpModel,
  type ShopVoucher
} from "../api/Schemas.js"
import { ShopeeClient } from "../api/ShopeeClient.js"
import { waitForCollected } from "../browser/BrowserSession.js"
import { AppConfig } from "../Config.js"
import {
  AUTH_REQUIRED_MESSAGE,
  formatShopeeApiError,
  ShopeeApiError,
  type ShopeeError
} from "../Errors.js"
import { formatPrice } from "../Price.js"
import {
  buildSearchPath,
  buildShopProductsPath,
  buildVariantRows,
  collectFlashItems,
  collectOrders,
  findCartItem,
  flashStockText,
  flattenSearchItems,
  formatCart,
  formatDateTime,
  formatNotification,
  formatOrder,
  formatOrderDetail,
  formatProductDetail,
  formatResultList,
  formatReview,
  formatShop,
  formatShopVouchers,
  formatTime,
  formatVariants,
  formatVoucher,
  modelOptionLabels,
  notificationTab,
  orderTabType,
  resolveProductIds,
  shopVouchersFrom,
  starBreakdown,
  voucherBenefit
} from "./Formatters.js"
import {
  AccountToolkit,
  MAX_QUANTITY_STEP,
  MAX_REVIEW_PAGE,
  PublicToolkit,
  REVIEWS_PER_PAGE
} from "./Toolkit.js"

const MISSING_PRODUCT_LOCATOR =
  "❌ Please provide both `shopId` and `itemId`, or a full product `url`."

const MAX_STOCK_LOOKUPS = 12
const RATINGS_API = "item/get_ratings"
const SESSIONS_API = "flash_sale/get_all_sessions"
const ITEMS_API = "flash_sale/flash_sale_batch_get_items"
const VOUCHER_BUTTON = "^(claim|klaim|simpan|use|pakai|gunakan|領取|使用)$"
const VOUCHER_CLAIM = "^(claim|klaim|simpan|領取)$"

const decodePdp = Schema.decodeUnknownOption(PdpResponse)
const decodeSelectVariation = Schema.decodeUnknownOption(SelectVariationResponse)
const decodeRatings = Schema.decodeUnknownOption(RatingsResponse)
const decodeFlashSessions = Schema.decodeUnknownOption(FlashSaleSessionsPayload)
const decodeOrderList = Schema.decodeUnknownOption(OrderListPayload)
const decodeCart = Schema.decodeUnknownOption(CartResponse)
const decodeCoinsSummary = Schema.decodeUnknownOption(CoinsSummaryResponse)
const decodeCoinsTx = Schema.decodeUnknownOption(CoinsTransactionsResponse)
const decodeNotifications = Schema.decodeUnknownOption(NotificationsResponse)
const decodeShopBase = Schema.decodeUnknownOption(ShopBaseResponse)
const decodeShopTab = Schema.decodeUnknownOption(ShopTabResponse)
const decodeSaveVoucher = Schema.decodeUnknownOption(SaveVoucherResponse)
const decodeEnvelope = Schema.decodeUnknownOption(ApiErrorEnvelope)

const findCollected = (
  got: ReadonlyArray<CollectedResponse>,
  match: string
): CollectedResponse | undefined => got.find((c) => c.url.includes(match))

const responseSucceeded = (c: CollectedResponse | undefined): boolean => {
  if (c === undefined) return false

  const env = decodeEnvelope(c.json)

  return Option.isSome(env) && (env.value.error ?? 0) === 0
}

const wheelDown = (page: Page, deltaY: number): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => page.mouse.wheel(0, deltaY),
    catch: () => undefined
  }).pipe(Effect.ignore)

// ─── DOM interaction helpers (executed inside browser page) ───────────────────

const clickReviewFilter = (page: Page, filter: string): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate((f: string) => {
        const chips = Array.from(
          document.querySelectorAll<HTMLElement>(".product-rating-overview__filter")
        )

        const labelled = chips.map((c) => ({ c, t: (c.textContent || "").trim().toLowerCase() }))

        let hit: { c: HTMLElement; t: string } | undefined

        if (/^[1-5]$/.test(f)) hit = labelled.find((x) => x.t.startsWith(`${f} `))
        else if (f === "with_comments") {
          hit = labelled.find((x) => /comment|komentar|評論|评论/.test(x.t))
        } else if (f === "with_media") {
          hit = labelled.find((x) => /media|foto|照片|相片/.test(x.t))
        }

        const chip = hit?.c

        if (!chip) return false

        chip.click()

        return true
      }, filter),
    catch: () => undefined
  }).pipe(Effect.orElseSucceed(() => false))

const clickNextReviewPage = (page: Page): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate(() => {
        const next = document.querySelector<HTMLButtonElement>(
          ".product-ratings__page-controller .shopee-icon-button--right"
        )

        if (!next || next.disabled) return false

        next.click()

        return true
      }),
    catch: () => undefined
  }).pipe(Effect.orElseSucceed(() => false))

const clickVariantOption = (page: Page, label: string): Promise<boolean> =>
  page.evaluate((l: string) => {
    const b = Array.from(document.querySelectorAll("button")).find(
      (x) => (x.getAttribute("aria-label") || x.textContent || "").trim() === l
    )

    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return false

    b.click()

    return true
  }, label)

const setBuyBoxQuantity = async (page: Page, quantity: number): Promise<void> => {
  const read = (): Promise<string | null> =>
    page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) =>
        /^(increase|tambah|增加)$/i.test((x.getAttribute("aria-label") || "").trim())
      )

      return b?.parentElement?.querySelector("input")?.value ?? null
    })

  let shown = await read()

  for (let attempt = 0; attempt < quantity + 5 && shown !== String(quantity); attempt++) {
    if (shown !== null && Number(shown) > quantity) break

    const ok = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) =>
        /^(increase|tambah|增加)$/i.test((x.getAttribute("aria-label") || "").trim())
      )

      if (!b || b.disabled) return false

      b.click()

      return true
    })

    if (!ok) break

    await page.waitForTimeout(350)
    shown = await read()
  }

  if (shown !== String(quantity)) {
    throw new Error(
      `Could not set the quantity to ${quantity} (the page shows ${shown ?? "nothing"}; stock or a purchase limit may cap it). Nothing was added.`
    )
  }
}

const clickAddToCart = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const re = /add to cart|masukkan keranjang|tambah ke keranjang|加入購物車|加入购物车/i

    const b = Array.from(document.querySelectorAll("button")).find((x) =>
      re.test((x.getAttribute("aria-label") || x.textContent || "").trim())
    )

    if (!b || b.disabled) return false

    b.click()

    return true
  })

const clickInCartRow = (page: Page, line: CartItem, control: string): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate(
        ({ shopid, itemid, variant, ctrl }) => {
          const links = Array.from(document.querySelectorAll("a")).filter((a) =>
            (a.getAttribute("href") || "").includes(`i.${shopid}.${itemid}`)
          )

          for (const link of links) {
            let row: HTMLElement | null = link

            for (let i = 0; i < 12 && row; i++) {
              const hasControls = Array.from(row.querySelectorAll("button")).some(
                (b) => (b.getAttribute("aria-label") || b.textContent || "").trim() === ctrl
              )

              if (hasControls && row.querySelector("input")) break

              row = row.parentElement
            }

            if (!row) continue

            if (variant && !(row.textContent || "").includes(variant)) continue

            const btn = Array.from(row.querySelectorAll("button")).find(
              (b) => (b.getAttribute("aria-label") || b.textContent || "").trim() === ctrl
            )

            if (!btn || btn.disabled) return false

            btn.click()

            return true
          }

          return false
        },
        { shopid: line.shopid, itemid: line.itemid, variant: line.model_name || "", ctrl: control }
      ),
    catch: () => undefined
  }).pipe(Effect.orElseSucceed(() => false))

const clickButtonByPattern = (page: Page, pattern: string): Effect.Effect<string | null> =>
  Effect.tryPromise({
    try: () =>
      page.evaluate((src: string) => {
        const re = new RegExp(src, "i")

        const b = Array.from(document.querySelectorAll("button")).find((x) =>
          re.test((x.textContent || "").trim())
        )

        if (!b) return null

        b.click()

        return (b.textContent || "").trim()
      }, pattern),
    catch: () => undefined
  }).pipe(Effect.orElseSucceed(() => null))

const cartEditsForItem = (
  got: ReadonlyArray<CollectedResponse>,
  itemid: number
): ReadonlyArray<CollectedResponse> =>
  got.filter(
    (c) =>
      c.url.includes("cart/update") &&
      /"action_type":[12]/.test(c.postData) &&
      c.postData.includes(`"itemid":${itemid}`)
  )

// ─── Error Handler Helper ─────────────────────────────────────────────────────

const makeCatchShopeeError = (mode: AccountMode["Service"]) => (
  effect: Effect.Effect<string, ShopeeError>
): Effect.Effect<string> =>
  effect.pipe(
    Effect.catchTags({
      ShopeeAuthRequiredError: () =>
        mode.setLoggedIn(false).pipe(Effect.as(AUTH_REQUIRED_MESSAGE)),
      ShopeeApiError: (err) => Effect.succeed(formatShopeeApiError(err))
    })
  )

// ─── Public Tool Handlers ─────────────────────────────────────────────────────

const PublicHandlersLayer = PublicToolkit.toLayer(
  Effect.gen(function*() {
    const config = yield* AppConfig
    const client = yield* ShopeeClient
    const mode = yield* AccountMode
    const catchErr = makeCatchShopeeError(mode)

    return PublicToolkit.of({
      search_products: Effect.fn("tool.search_products")(function*(params) {
        const page = params.page ?? 1
        const limit = params.limit ?? 20
        const sort = params.sort ?? "relevance"

        const filters = {
          minPrice: params.minPrice,
          maxPrice: params.maxPrice,
          minRating: params.minRating,
          location: params.location,
          officialMallOnly: params.officialMallOnly
        }

        return yield* catchErr(
          Effect.gen(function*() {
            const searchPath = buildSearchPath(params.query, page, sort, filters)
            const data = yield* client.searchItems(searchPath)
            const items = flattenSearchItems(data.items)

            if (items.length === 0) {
              const filtered = Object.values(filters).some((v) => v !== undefined)

              return (
                `No products found for "${params.query}"` +
                (filtered
                  ? " with these filters. Try loosening them."
                  : ". Try a different keyword.")
              )
            }

            return formatResultList(items, {
              title: `🛒 Search Results for "${params.query}"`,
              page,
              limit,
              totalCount: data.total_count ?? 0,
              nomore: data.nomore ?? false,
              baseUrl: config.baseUrl,
              currency: config.currency
            })
          })
        )
      }),

      get_product_detail: Effect.fn("tool.get_product_detail")(function*({
        shopId,
        itemId,
        url
      }) {
        const idsOpt = resolveProductIds(shopId, itemId, url)

        if (Option.isNone(idsOpt)) return MISSING_PRODUCT_LOCATOR

        const { shopId: sid, itemId: iid } = idsOpt.value

        return yield* catchErr(
          client
            .getProductPdp(sid, iid)
            .pipe(Effect.map((data) => formatProductDetail(data, config.baseUrl, config.currency)))
        )
      }),

      get_product_variants: Effect.fn("tool.get_product_variants")(function*({
        shopId,
        itemId,
        url,
        includeStock
      }) {
        const idsOpt = resolveProductIds(shopId, itemId, url)

        if (Option.isNone(idsOpt)) return MISSING_PRODUCT_LOCATOR

        const { shopId: sid, itemId: iid } = idsOpt.value
        const fetchStock = includeStock ?? false

        return yield* catchErr(
          Effect.gen(function*() {
            let data: PdpResponse
            let stockByName: Map<string, number> | undefined

            if (fetchStock) {
              const pageUrl = client.shopeeUrl(`/product/${sid}/${iid}`)

              const { primary, selections } = yield* client.captureWithSelections(pageUrl, {
                apiMatch: "pdp/get_pc",
                selectionApiMatch: "cart_panel/select_variation_pc",
                maxSelections: MAX_STOCK_LOOKUPS,
                labelsFrom: (p) => {
                  const parsed = decodePdp(p)

                  return Option.isSome(parsed)
                    ? (parsed.value.data?.item.models ?? []).map((m) => m.name)
                    : []
                }
              })

              const parsedPrimary = decodePdp(primary)

              if (Option.isNone(parsedPrimary)) {
                return "❌ Could not read product data. Check the shopId/itemId or URL."
              }

              data = parsedPrimary.value
              stockByName = new Map()

              for (const [name, selJson] of selections) {
                const sel = decodeSelectVariation(selJson)

                if (Option.isSome(sel)) {
                  const n = sel.value.data?.stock

                  if (n !== undefined && n !== null) {
                    stockByName.set(name, n)
                  }
                }
              }
            } else {
              data = yield* client.getProductPdp(sid, iid)
            }

            const item = data.data?.item

            if (item === undefined) {
              return "❌ Could not read product data. Check the shopId/itemId or URL."
            }

            const rows = buildVariantRows(item.models, stockByName)

            return formatVariants(item, rows, fetchStock, config.baseUrl, config.currency)
          })
        )
      }),

      get_product_reviews: Effect.fn("tool.get_product_reviews")(function*({
        shopId,
        itemId,
        url,
        filter,
        page
      }) {
        const idsOpt = resolveProductIds(shopId, itemId, url)

        if (Option.isNone(idsOpt)) return MISSING_PRODUCT_LOCATOR

        const ids = idsOpt.value
        const chosenFilter = filter ?? "all"
        const requestedPage = page ?? 1

        return yield* catchErr(
          Effect.gen(function*() {
            let reachedPage = 1
            let filterMissing = false
            const isRatings = (c: CollectedResponse): boolean => c.url.includes(RATINGS_API)
            const pageUrl = client.shopeeUrl(`/product/${ids.shopId}/${ids.itemId}`)

            const collected = yield* client.captureAll(pageUrl, {
              apiMatches: [RATINGS_API],
              interact: (p, got) =>
                Effect.gen(function*() {
                  const count = (): number => got.filter(isRatings).length

                  const loaded = yield* waitForCollected(
                    got,
                    () => count() > 0,
                    "30 seconds",
                    wheelDown(p, 800)
                  )

                  if (!loaded) return

                  if (chosenFilter !== "all") {
                    const before = count()
                    const clicked = yield* clickReviewFilter(p, chosenFilter)

                    if (!clicked) {
                      filterMissing = true

                      return
                    }

                    const filtered = yield* waitForCollected(
                      got,
                      () => count() > before,
                      "12 seconds"
                    )

                    if (!filtered) {
                      filterMissing = true

                      return
                    }
                  }

                  for (let n = 2; n <= requestedPage; n++) {
                    const before = count()
                    const clickedNext = yield* clickNextReviewPage(p)

                    if (!clickedNext) break

                    const paged = yield* waitForCollected(
                      got,
                      () => count() > before,
                      "12 seconds"
                    )

                    if (!paged) break

                    reachedPage = n
                  }
                })
            })

            if (filterMissing) {
              return `❌ Could not apply the "${chosenFilter}" review filter on this product (there may be no such reviews). Try filter="all".`
            }

            const lastRaw = collected.filter(isRatings).at(-1)
            const lastOpt = lastRaw !== undefined ? decodeRatings(lastRaw.json) : Option.none()

            if (Option.isNone(lastOpt)) {
              return yield* new ShopeeApiError({
                message:
                  "Reviews never loaded on the product page. Check the IDs, or retry — Shopee lazy-loads them.",
                endpoint: RATINGS_API
              })
            }

            const last = lastOpt.value

            if (last.error) {
              return yield* new ShopeeApiError({
                message: `Shopee API error ${last.error}${last.error_msg ? `: ${last.error_msg}` : ""}`,
                statusCode: 200,
                endpoint: RATINGS_API,
                shopeeError: last.error
              })
            }

            const ratings = last.data?.ratings ?? []
            const summary = last.data?.item_rating_summary
            const lines: Array<string> = [`💬 **Reviews** for product \`${ids.itemId}\``]

            if (summary !== null && summary !== undefined) {
              lines.push(
                `📊 ${summary.rating_total.toLocaleString("id-ID")} ratings | ${starBreakdown(summary)}`
              )

              const extras = [
                summary.rcount_with_context !== undefined
                  ? `${summary.rcount_with_context.toLocaleString("id-ID")} with comments`
                  : "",
                summary.rcount_with_media !== undefined
                  ? `${summary.rcount_with_media.toLocaleString("id-ID")} with media`
                  : ""
              ].filter(Boolean)

              if (extras.length > 0) lines.push(`   ${extras.join(" | ")}`)
            }

            lines.push(`🔎 Filter: ${chosenFilter} | Page ${reachedPage}`, "")

            if (ratings.length === 0) {
              lines.push("No reviews match this filter.")
            } else {
              ratings.forEach((r, i) => {
                lines.push(formatReview(r, (reachedPage - 1) * REVIEWS_PER_PAGE + i + 1))

                if (i < ratings.length - 1) lines.push("")
              })
            }

            if (reachedPage < requestedPage) {
              lines.push(
                "",
                `⚠️ Only reached page ${reachedPage} of the ${requestedPage} requested — no more reviews.`
              )
            } else if (
              last.data?.has_more !== false &&
              ratings.length === REVIEWS_PER_PAGE &&
              requestedPage < MAX_REVIEW_PAGE
            ) {
              lines.push("", `📄 Use page=${requestedPage + 1} for more.`)
            }

            lines.push("", `🔗 ${config.baseUrl}/product/${ids.shopId}/${ids.itemId}`)

            return lines.join("\n")
          })
        )
      }),

      get_shop_info: Effect.fn("tool.get_shop_info")(function*({ shopId, username }) {
        const handle = username?.replace(/^@/, "").trim()

        if ((shopId === undefined || shopId === "") && (handle === undefined || handle === "")) {
          return "❌ Please provide a `shopId` or a shop `username`."
        }

        return yield* catchErr(
          Effect.gen(function*() {
            const path =
              shopId !== undefined && shopId !== ""
                ? `/shop/${shopId}`
                : `/${encodeURIComponent(handle ?? "")}`

            const data = yield* client.getShopBase(path)

            if (data.data === null || data.data === undefined || !data.data.shopid) {
              return "❌ Could not read shop data. Check the shopId or username."
            }

            return formatShop(data.data, config.baseUrl)
          })
        )
      }),

      get_shop_products: Effect.fn("tool.get_shop_products")(function*({
        shopId,
        page,
        limit,
        sort
      }) {
        const currentPage = page ?? 1
        const maxItems = limit ?? 20
        const sortOrder = sort ?? "popular"

        return yield* catchErr(
          Effect.gen(function*() {
            const data = yield* client.searchItems(
              buildShopProductsPath(shopId, currentPage, sortOrder)
            )

            const items = flattenSearchItems(data.items)

            if (items.length === 0) {
              return `No products found for shop \`${shopId}\`${currentPage > 1 ? ` on page ${currentPage}` : ""}.`
            }

            return formatResultList(items, {
              title: `🏪 Products from shop \`${shopId}\``,
              page: currentPage,
              limit: maxItems,
              totalCount: data.total_count ?? 0,
              nomore: data.nomore ?? false,
              baseUrl: config.baseUrl,
              currency: config.currency
            })
          })
        )
      }),

      get_flash_sale: Effect.fn("tool.get_flash_sale")(function*({ limit }) {
        const maxDeals = limit ?? 20

        return yield* catchErr(
          Effect.gen(function*() {
            const collected = yield* client.captureAll(client.shopeeUrl("/flash_sale"), {
              apiMatches: [SESSIONS_API, ITEMS_API],
              interact: (page, got) =>
                waitForCollected(
                  got,
                  (c) => collectFlashItems(c).length >= maxDeals,
                  Math.min(45_000, 12_000 + maxDeals * 600),
                  wheelDown(page, 900)
                ).pipe(Effect.asVoid)
            })

            const sessionsRaw = findCollected(collected, SESSIONS_API)

            const sessionsOpt =
              sessionsRaw !== undefined ? decodeFlashSessions(sessionsRaw.json) : Option.none()

            const sessions = Option.isSome(sessionsOpt)
              ? (sessionsOpt.value.data?.sessions ?? [])
              : []

            const items = collectFlashItems(collected)

            if (items.length === 0) {
              return yield* new ShopeeApiError({
                message:
                  "No flash-sale deals loaded. There may be no active session, or retry — Shopee lazy-loads them.",
                endpoint: ITEMS_API
              })
            }

            const current = sessions.find((s) => s.is_ongoing) ?? sessions[0]
            const lines: Array<string> = ["⚡ **Shopee Flash Sale**"]

            if (current !== undefined) {
              lines.push(
                `🕒 ${current.is_ongoing ? "Now" : "Next"}: ${formatTime(current.start_time, config.timezone)} – ${formatTime(current.end_time, config.timezone)} (${config.timezone})`
              )
            }

            const upcoming = sessions.filter(
              (s) => s !== current && s.start_time > (current?.start_time ?? 0)
            )

            if (upcoming.length > 0) {
              lines.push(
                `⏭ Upcoming: ${upcoming.map((s) => formatTime(s.start_time, config.timezone)).join(", ")}`
              )
            }

            lines.push("")

            const shown = items.slice(0, maxDeals)

            shown.forEach((it, i) => {
              const before =
                it.price_before_discount && it.price_before_discount > it.price
                  ? ` ~~${formatPrice(it.price_before_discount, config.currency)}~~`
                  : ""

              const meta = [
                it.discount ? `🏷 ${it.discount}` : "",
                flashStockText(it),
                it.item_rating?.rating_star ? `⭐ ${it.item_rating.rating_star.toFixed(1)}` : "",
                `🆔 ${it.itemid}`
              ].filter(Boolean)

              lines.push(`${i + 1}. **${it.name}**`)
              lines.push(`   💰 ${formatPrice(it.price, config.currency)}${before}`)
              lines.push(`   ${meta.join(" | ")}`)
              lines.push(`   🔗 ${config.baseUrl}/product/${it.shopid}/${it.itemid}`)

              if (i < shown.length - 1) lines.push("")
            })

            if (shown.length < maxDeals) {
              lines.push("", `ℹ️ Only ${shown.length} deals loaded within the time budget.`)
            }

            return lines.join("\n")
          })
        )
      }),

      check_login_status: Effect.fn("tool.check_login_status")(function*() {
        return yield* catchErr(
          Effect.gen(function*() {
            const loggedIn = yield* client.isLoggedIn

            yield* mode.setLoggedIn(loggedIn)

            const modeNote =
              config.accountTools === "off"
                ? "Account tools are turned off (default read-only mode; set SHOPEE_ACCOUNT_TOOLS=auto to opt in)."
                : "Experimental account tools (orders, vouchers, coins, notifications, cart, likes, follows) are enabled."

            return loggedIn
              ? `✅ Logged in to ${config.domain}. All discovery tools are ready.\n${modeNote}`
              : `🔒 Not logged in to ${config.domain} — read-only mode, account tools hidden.\n\n` +
                  "Run `pnpm run login` (or `shopee-mcp-login`) once, " +
                  "sign in in the Chromium window that opens, then retry."
          })
        )
      })
    })
  })
)

// ─── Experimental Account Tool Handlers ───────────────────────────────────────

const AccountHandlersLayer = AccountToolkit.toLayer(
  Effect.gen(function*() {
    const config = yield* AppConfig
    const client = yield* ShopeeClient
    const mode = yield* AccountMode
    const catchErr = makeCatchShopeeError(mode)

    return AccountToolkit.of({
      get_orders: Effect.fn("tool.get_orders")(function*({ status, limit }) {
        const chosenStatus = status ?? "all"
        const maxOrders = limit ?? 10

        return yield* catchErr(
          Effect.gen(function*() {
            const isOrderList = (c: CollectedResponse): boolean =>
              c.url.includes("order/get_order_list") ||
              c.url.includes("order/get_all_order_and_checkout_list")

            const listIsDone = (c: ReadonlyArray<CollectedResponse>): boolean => {
              const lists = c.filter(isOrderList)
              const last = lists.at(-1)

              if (last === undefined) return false

              const parsed = decodeOrderList(last.json)

              if (Option.isNone(parsed)) return false

              const n = (
                parsed.value.data?.details_list ??
                parsed.value.new_data?.order_or_checkout_data ??
                []
              ).length

              return lists.length > 0 && n === 0
            }

            const collected = yield* client.captureAll(
              client.shopeeUrl(`/user/purchase/?type=${orderTabType(chosenStatus)}`),
              {
                apiMatches: ["order/get_order_list", "order/get_all_order_and_checkout_list"],
                interact: (page, got) =>
                  waitForCollected(
                    got,
                    (c) =>
                      collectOrders(c.filter(isOrderList)).length >= maxOrders || listIsDone(c),
                    Math.min(45_000, 10_000 + maxOrders * 1200),
                    wheelDown(page, 1200)
                  ).pipe(Effect.asVoid)
              }
            )

            const orders = collectOrders(collected.filter(isOrderList)).slice(0, maxOrders)

            if (!collected.some(isOrderList)) {
              return yield* new ShopeeApiError({
                message: "Your order list did not load. Retry in a moment."
              })
            }

            if (orders.length === 0) return `🧾 No orders in "${chosenStatus}".`

            return [
              `🧾 **Your orders** — ${chosenStatus} (${orders.length} shown)`,
              "",
              orders.map((o, i) => formatOrder(o, i + 1, config.currency)).join("\n\n")
            ].join("\n")
          })
        )
      }),

      get_order_detail: Effect.fn("tool.get_order_detail")(function*({ orderId }) {
        return yield* catchErr(
          client
            .capture(
              client.shopeeUrl(`/user/purchase/order/${orderId}`),
              "order/get_order_detail",
              OrderDetailResponse
            )
            .pipe(
              Effect.map((data) =>
                data.data !== null && data.data !== undefined
                  ? formatOrderDetail(
                      orderId,
                      data.data,
                      config.baseUrl,
                      config.currency,
                      config.timezone
                    )
                  : `❌ Could not read order ${orderId}.`
              )
            )
        )
      }),

      get_my_vouchers: Effect.fn("tool.get_my_vouchers")(function*({ limit }) {
        const maxVouchers = limit ?? 20

        return yield* catchErr(
          client
            .capture(
              client.shopeeUrl("/user/voucher-wallet"),
              "api/v2/voucher_wallet/get_user_voucher_list",
              VoucherWalletResponse
            )
            .pipe(
              Effect.map((data) => {
                const list = (data.data?.user_voucher_list ?? []).slice(0, maxVouchers)

                if (list.length === 0) return "🎟 Your voucher wallet is empty."

                return [
                  `🎟 **Your vouchers** (${list.length} shown)`,
                  "",
                  ...list.map((v, i) => formatVoucher(v, i + 1, config.currency, config.timezone))
                ].join("\n")
              })
            )
        )
      }),

      get_coins: Effect.fn("tool.get_coins")(function*() {
        return yield* catchErr(
          Effect.gen(function*() {
            const got = yield* client.captureAll(client.shopeeUrl("/user/coin"), {
              apiMatches: ["coin/get_user_coins_summary", "coin/get_user_coin_transaction_list"],
              interact: (_page, c) =>
                waitForCollected(c, (x) => x.length >= 2, "20 seconds").pipe(Effect.asVoid)
            })

            const summaryRaw = findCollected(got, "get_user_coins_summary")

            const summaryOpt =
              summaryRaw !== undefined ? decodeCoinsSummary(summaryRaw.json) : Option.none()

            if (Option.isNone(summaryOpt)) {
              return yield* new ShopeeApiError({
                message: "Your coin balance did not load. Retry in a moment."
              })
            }

            const txRaw = findCollected(got, "get_user_coin_transaction_list")
            const txOpt = txRaw !== undefined ? decodeCoinsTx(txRaw.json) : Option.none()
            const tx = Option.isSome(txOpt) ? (txOpt.value.data?.coin_transactions ?? []) : []

            const info = summaryOpt.value.data?.coin_info
            const balance = info?.fe_available_amount ?? (info?.available_amount ?? 0) / 100000
            const lines: Array<string> = [`🪙 **Shopee Coins:** ${balance.toLocaleString("id-ID")}`]

            if (tx.length > 0) {
              lines.push("", "**Recent transactions:**")

              for (const t of tx.slice(0, 10)) {
                const amt = (t.amount ?? 0) / 100000

                lines.push(
                  `  • ${amt > 0 ? "+" : ""}${amt.toLocaleString("id-ID")}${t.name || t.reason ? ` — ${t.name ?? t.reason}` : ""}${t.ctime ? ` (${formatDateTime(t.ctime, config.timezone)})` : ""}`
                )
              }
            } else {
              lines.push("No coin transactions yet.")
            }

            return lines.join("\n")
          })
        )
      }),

      get_notifications: Effect.fn("tool.get_notifications")(function*({ category, limit }) {
        const chosenCategory = category ?? "order"
        const maxItems = limit ?? 10
        const tab = notificationTab(chosenCategory)

        return yield* catchErr(
          Effect.gen(function*() {
            const isTab = (c: CollectedResponse): boolean =>
              c.url.includes("notification/get_notifications") &&
              c.url.includes(`action_cate=${tab.cate}`)

            const got = yield* client.captureAll(
              client.shopeeUrl(`/user/notifications/${tab.path}`),
              {
                apiMatches: ["notification/get_notifications"],
                interact: (_page, c) =>
                  waitForCollected(c, (x) => x.some(isTab), "20 seconds").pipe(Effect.asVoid)
              }
            )

            const resRaw = got.find(isTab)
            const resOpt = resRaw !== undefined ? decodeNotifications(resRaw.json) : Option.none()

            if (Option.isNone(resOpt)) {
              return yield* new ShopeeApiError({
                message: "Your notifications did not load. Retry in a moment."
              })
            }

            const actions = (resOpt.value.data?.actions ?? []).slice(0, maxItems)

            if (actions.length === 0) return `🔔 No ${chosenCategory} notifications.`

            return [
              `🔔 **${chosenCategory.charAt(0).toUpperCase() + chosenCategory.slice(1)} notifications**`,
              "",
              ...actions.map((a, i) => formatNotification(a, i + 1, config.timezone))
            ].join("\n")
          })
        )
      }),

      get_cart: Effect.fn("tool.get_cart")(function*() {
        return yield* catchErr(
          client
            .capture(client.shopeeUrl("/cart"), "cart/get", CartResponse)
            .pipe(
              Effect.map((data) =>
                formatCart(data.data?.cart_blocks ?? [], config.currency, config.baseUrl)
              )
            )
        )
      }),

      add_to_cart: Effect.fn("tool.add_to_cart")(function*({
        shopId,
        itemId,
        url,
        modelId,
        quantity
      }) {
        const idsOpt = resolveProductIds(shopId, itemId, url)

        if (Option.isNone(idsOpt)) return MISSING_PRODUCT_LOCATOR

        const ids = idsOpt.value
        const qty = quantity ?? 1

        return yield* catchErr(
          Effect.gen(function*() {
            const productUrl = client.shopeeUrl(`/product/${ids.shopId}/${ids.itemId}`)
            const data = yield* client.getProductPdp(ids.shopId, ids.itemId)
            const item = data.data?.item

            if (item === undefined) {
              return "❌ Could not read product data. Nothing was added."
            }

            const models = item.models ?? []

            let model: PdpModel | undefined

            if (modelId !== undefined && modelId !== "") {
              model = models.find((m) => String(m.model_id) === modelId)

              if (model === undefined) {
                return `❌ model_id ${modelId} is not a variant of this listing. Call get_product_variants for valid IDs. Nothing was added.`
              }
            } else if (models.length > 1) {
              return `❌ This listing has ${models.length} variants — call get_product_variants and pass the exact \`modelId\`. Nothing was added.`
            } else {
              model = models[0]
            }

            if (model?.has_stock === false) {
              return `❌ "${model.name}" is out of stock. Nothing was added.`
            }

            const labelsOpt =
              model !== undefined
                ? modelOptionLabels(item, model)
                : Option.some<ReadonlyArray<string>>([])

            if (Option.isNone(labelsOpt)) {
              return "❌ Could not map this variant to the page’s options. Nothing was added."
            }

            const labels = labelsOpt.value

            const result = yield* client.withPage("cart/add_to_cart", async (page) => {
              await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
              await page
                .waitForFunction(
                  () =>
                    Array.from(document.querySelectorAll("button")).some((b) =>
                      /add to cart|masukkan keranjang|tambah ke keranjang|加入購物車|加入购物车/i.test(
                        b.getAttribute("aria-label") || b.textContent || ""
                      )
                    ),
                  undefined,
                  { timeout: 30_000 }
                )
                .catch(() => undefined)

              await page.waitForTimeout(1500)

              for (const label of labels) {
                let selected = false

                for (let attempt = 0; attempt < 2 && !selected; attempt++) {
                  const fired = page
                    .waitForResponse((r) => r.url().includes("cart_panel/select_variation_pc"), {
                      timeout: 6_000
                    })
                    .then(() => true)
                    .catch(() => false)

                  if (!(await clickVariantOption(page, label))) {
                    void fired.catch(() => undefined)
                    throw new Error(
                      `Could not select the "${label}" option on the page. Nothing was added.`
                    )
                  }

                  selected = await fired

                  if (!selected) await page.waitForTimeout(1500)
                }

                if (!selected) {
                  throw new Error(
                    `Shopee did not register the "${label}" option. Nothing was added.`
                  )
                }
              }

              await page.waitForTimeout(1200)
              await setBuyBoxQuantity(page, qty)

              const response = page.waitForResponse(
                (r) =>
                  r.url().includes("/api/v4/cart/add_to_cart") && r.request().method() === "POST",
                { timeout: 15_000 }
              )

              if (!(await clickAddToCart(page))) {
                void response.catch(() => undefined)
                throw new Error('Could not find an enabled "Add to Cart" button. Nothing was added.')
              }

              const r = await response
              const envelope = decodeEnvelope(await r.json())

              return {
                error: Option.isSome(envelope) ? envelope.value.error : undefined,
                error_msg: Option.isSome(envelope) ? envelope.value.error_msg : undefined,
                sent: r.request().postData() ?? ""
              }
            })

            if (result.error) {
              return `❌ Shopee rejected the cart update: ${result.error_msg || `error ${result.error}`}`
            }

            const sentModel = /"modelid":(\d+)/.exec(result.sent)?.[1]

            const variantNote =
              model !== undefined && sentModel !== undefined && sentModel !== String(model.model_id)
                ? `\n⚠️ Shopee recorded model_id ${sentModel}, not ${model.model_id} — check your cart.`
                : ""

            const price = model?.price ?? data.data?.product_price.price.single_value

            return (
              [
                "✅ Added to your Shopee cart.",
                `📦 ${item.title}${model?.name ? ` (${model.name})` : ""}`,
                `🔢 Quantity: ${qty}${price !== undefined ? ` × ${formatPrice(price, item.currency || config.currency)}` : ""}`,
                `🔗 ${config.baseUrl}/product/${ids.shopId}/${ids.itemId}`,
                "",
                "No checkout or payment was performed."
              ].join("\n") + variantNote
            )
          })
        )
      }),

      update_cart_item: Effect.fn("tool.update_cart_item")(function*({
        itemId,
        modelId,
        quantity
      }) {
        return yield* catchErr(
          Effect.gen(function*() {
            let outcome: string | undefined
            let line: CartItem | undefined
            let applied = 0

            yield* client.captureAll(client.shopeeUrl("/cart"), {
              apiMatches: ["cart/get", "cart/update"],
              interact: (page, got) =>
                Effect.gen(function*() {
                  const loaded = yield* waitForCollected(
                    got,
                    (c) => c.some((x) => x.url.includes("cart/get")),
                    "30 seconds"
                  )

                  const cartRaw = findCollected(got, "cart/get")
                  const cartOpt = cartRaw !== undefined ? decodeCart(cartRaw.json) : Option.none()

                  if (!loaded || Option.isNone(cartOpt)) {
                    outcome = "❌ The cart did not load. Nothing was changed."

                    return
                  }

                  const { matches, item: itemOpt } = findCartItem(
                    cartOpt.value.data?.cart_blocks ?? [],
                    itemId,
                    modelId
                  )

                  if (matches.length === 0) {
                    outcome = `❌ Item ${itemId}${modelId ? ` (model_id ${modelId})` : ""} is not in your cart. Nothing was changed.`

                    return
                  }

                  if (Option.isNone(itemOpt)) {
                    outcome = `❌ Item ${itemId} is in your cart in ${matches.length} variants — pass the exact \`modelId\` from get_cart. Nothing was changed.`

                    return
                  }

                  const item = itemOpt.value

                  line = item
                  yield* Effect.sleep("1500 millis")

                  const diff = quantity - item.quantity

                  if (quantity === 0) {
                    const clickedDelete = yield* clickInCartRow(page, item, "Delete")

                    if (!clickedDelete) {
                      outcome = "❌ Could not find this line’s Delete button. Nothing was changed."

                      return
                    }

                    yield* waitForCollected(
                      got,
                      (c) => cartEditsForItem(c, item.itemid).length > 0,
                      "12 seconds"
                    )
                    applied = cartEditsForItem(got, item.itemid).length

                    return
                  }

                  if (diff === 0) {
                    outcome = `ℹ️ Quantity is already ${quantity}. Nothing was changed.`

                    return
                  }

                  if (Math.abs(diff) > MAX_QUANTITY_STEP) {
                    outcome = `❌ That changes the quantity by ${Math.abs(diff)}; the limit is ${MAX_QUANTITY_STEP} per call. Nothing was changed.`

                    return
                  }

                  for (let n = 0; n < Math.abs(diff); n++) {
                    const before = cartEditsForItem(got, item.itemid).length

                    const clickedStep = yield* clickInCartRow(
                      page,
                      item,
                      diff > 0 ? "Increase" : "Decrease"
                    )

                    if (!clickedStep) break

                    const updated = yield* waitForCollected(
                      got,
                      (c) => cartEditsForItem(c, item.itemid).length > before,
                      "12 seconds"
                    )

                    if (!updated) break
                  }

                  applied = cartEditsForItem(got, item.itemid).length
                })
            })

            if (outcome !== undefined) return outcome

            if (line === undefined) return "❌ Nothing was changed."

            const name = `${line.name}${line.model_name ? ` (${line.model_name})` : ""}`

            if (quantity === 0) {
              return applied > 0
                ? `🗑 Removed from your cart: ${name}`
                : `❌ Shopee did not confirm removing ${name}.`
            }

            const target = Math.abs(quantity - line.quantity)
            const reached = line.quantity + Math.sign(quantity - line.quantity) * applied

            return applied === target
              ? `✅ ${name}: quantity ${line.quantity} → ${quantity}`
              : `⚠️ ${name}: only reached quantity ${reached} of ${quantity} (stock or a purchase limit may cap it).`
          })
        )
      }),

      like_product: Effect.fn("tool.like_product")(function*({ shopId, itemId, url, like }) {
        const idsOpt = resolveProductIds(shopId, itemId, url)

        if (Option.isNone(idsOpt)) return MISSING_PRODUCT_LOCATOR

        const ids = idsOpt.value
        const wantLike = like ?? true

        return yield* catchErr(
          Effect.gen(function*() {
            let already: boolean | undefined
            let clicked = false
            const action = wantLike ? "pages/like_items" : "pages/unlike_items"

            const got = yield* client.captureAll(
              client.shopeeUrl(`/product/${ids.shopId}/${ids.itemId}`),
              {
                apiMatches: ["pdp/get_pc", action],
                interact: (page, c) =>
                  Effect.gen(function*() {
                    const loaded = yield* waitForCollected(
                      c,
                      (x) => findCollected(x, "pdp/get_pc") !== undefined,
                      "30 seconds"
                    )

                    if (!loaded) return

                    const pdpRaw = findCollected(c, "pdp/get_pc")
                    const pdpOpt = pdpRaw !== undefined ? decodePdp(pdpRaw.json) : Option.none()

                    if (Option.isSome(pdpOpt)) {
                      const liked = pdpOpt.value.data?.product_review?.liked

                      already = liked ?? undefined
                    }

                    if (already === wantLike) return

                    yield* Effect.sleep("1500 millis")

                    const clickedBtn = yield* clickButtonByPattern(
                      page,
                      "^(favorite|favorit|disukai|suka|喜歡|喜欢)\\s*\\("
                    )

                    clicked = clickedBtn !== null

                    if (clicked) {
                      yield* waitForCollected(
                        c,
                        (x) => findCollected(x, action) !== undefined,
                        "12 seconds"
                      )
                    }
                  })
              }
            )

            const link = `🔗 ${config.baseUrl}/product/${ids.shopId}/${ids.itemId}`

            if (already === undefined) {
              return "❌ Could not read the product page. Nothing was changed."
            }

            if (already === wantLike) {
              return `ℹ️ Already ${wantLike ? "liked" : "not liked"}. Nothing was changed.\n${link}`
            }

            if (!clicked) {
              return "❌ Could not find the like button. Nothing was changed."
            }

            return responseSucceeded(findCollected(got, action))
              ? `${wantLike ? "❤️ Liked" : "🤍 Unliked"} the product.\n${link}`
              : `❌ Shopee did not confirm the ${wantLike ? "like" : "unlike"}.\n${link}`
          })
        )
      }),

      follow_shop: Effect.fn("tool.follow_shop")(function*({ shopId, follow }) {
        const wantFollow = follow ?? true

        return yield* catchErr(
          Effect.gen(function*() {
            let already: boolean | undefined
            let name = `shop ${shopId}`
            let clicked = false
            const action = wantFollow ? "shop/follow" : "shop/unfollow"

            const got = yield* client.captureAll(client.shopeeUrl(`/shop/${shopId}`), {
              apiMatches: ["shop/get_shop_base_v2", action],
              interact: (page, c) =>
                Effect.gen(function*() {
                  const loaded = yield* waitForCollected(
                    c,
                    (x) => findCollected(x, "get_shop_base_v2") !== undefined,
                    "30 seconds"
                  )

                  if (!loaded) return

                  const baseRaw = findCollected(c, "get_shop_base_v2")

                  const baseOpt =
                    baseRaw !== undefined ? decodeShopBase(baseRaw.json) : Option.none()

                  if (Option.isSome(baseOpt) && baseOpt.value.data != null) {
                    already = baseOpt.value.data.followed

                    if (baseOpt.value.data.name) name = baseOpt.value.data.name
                  }

                  if (already === wantFollow) return

                  yield* Effect.sleep("1500 millis")

                  const clickedBtn = yield* clickButtonByPattern(
                    page,
                    wantFollow
                      ? "^(follow|ikuti|關注|关注)$"
                      : "^(following|mengikuti|已關注|已关注)$"
                  )

                  clicked = clickedBtn !== null

                  if (clicked) {
                    yield* waitForCollected(
                      c,
                      (x) => findCollected(x, action) !== undefined,
                      "12 seconds"
                    )
                  }
                })
            })

            if (already === undefined) {
              return "❌ Could not read the shop page. Nothing was changed."
            }

            if (already === wantFollow) {
              return `ℹ️ Already ${wantFollow ? "following" : "not following"} ${name}. Nothing was changed.`
            }

            if (!clicked) {
              return "❌ Could not find the Follow button. Nothing was changed."
            }

            return responseSucceeded(findCollected(got, action))
              ? `${wantFollow ? "➕ Now following" : "➖ Unfollowed"} ${name}.\n🔗 ${config.baseUrl}/shop/${shopId}`
              : `❌ Shopee did not confirm the ${wantFollow ? "follow" : "unfollow"}.`
          })
        )
      }),

      get_shop_vouchers: Effect.fn("tool.get_shop_vouchers")(function*({ shopId }) {
        return yield* catchErr(
          Effect.gen(function*() {
            const got = yield* client.captureAll(client.shopeeUrl(`/shop/${shopId}`), {
              apiMatches: ["shop/get_shop_tab"],
              interact: (_page, c) =>
                waitForCollected(c, (x) => x.length > 0, "30 seconds").pipe(Effect.asVoid)
            })

            const tabRaw = got[0]
            const tabOpt = tabRaw !== undefined ? decodeShopTab(tabRaw.json) : Option.none()

            if (Option.isNone(tabOpt)) return "❌ Could not read the shop page."

            return formatShopVouchers(
              shopId,
              shopVouchersFrom(tabOpt.value),
              config.currency,
              config.timezone
            )
          })
        )
      }),

      claim_shop_voucher: Effect.fn("tool.claim_shop_voucher")(function*({
        shopId,
        voucherCode
      }) {
        return yield* catchErr(
          Effect.gen(function*() {
            let outcome: string | undefined
            let target: ShopVoucher | undefined

            const got = yield* client.captureAll(client.shopeeUrl(`/shop/${shopId}`), {
              apiMatches: ["shop/get_shop_tab", "voucher_wallet/save_voucher"],
              interact: (page, c) =>
                Effect.gen(function*() {
                  const loaded = yield* waitForCollected(
                    c,
                    (x) => findCollected(x, "get_shop_tab") !== undefined,
                    "30 seconds"
                  )

                  if (!loaded) {
                    outcome = "❌ Could not read the shop page. Nothing was claimed."

                    return
                  }

                  const tabRaw = findCollected(c, "get_shop_tab")
                  const tabOpt = tabRaw !== undefined ? decodeShopTab(tabRaw.json) : Option.none()
                  const vouchers = shopVouchersFrom(Option.getOrUndefined(tabOpt))
                  const index = vouchers.findIndex((v) => v.voucher_code === voucherCode)

                  if (index < 0) {
                    outcome = `❌ Shop ${shopId} has no voucher \`${voucherCode}\` right now (see get_shop_vouchers). Nothing was claimed.`

                    return
                  }

                  target = vouchers[index]

                  if (target.is_claimed_before) {
                    outcome = `ℹ️ You already claimed \`${voucherCode}\`. Nothing was changed.`

                    return
                  }

                  yield* Effect.sleep("1500 millis")

                  const clicked = yield* Effect.tryPromise({
                    try: () =>
                      page.evaluate(
                        ({ all, claim, idx, total }) => {
                          const btns = Array.from(document.querySelectorAll("button")).filter((b) =>
                            new RegExp(all, "i").test((b.textContent || "").trim())
                          )

                          if (btns.length !== total) return `mismatch:${btns.length}`

                          const b = btns[idx]

                          if (!new RegExp(claim, "i").test((b.textContent || "").trim())) {
                            return "not-claimable"
                          }

                          b.click()

                          return "ok"
                        },
                        {
                          all: VOUCHER_BUTTON,
                          claim: VOUCHER_CLAIM,
                          idx: index,
                          total: vouchers.length
                        }
                      ),
                    catch: () => undefined
                  }).pipe(Effect.orElseSucceed(() => "error"))

                  if (clicked !== "ok") {
                    outcome =
                      clicked === "not-claimable"
                        ? `ℹ️ \`${voucherCode}\` is not claimable (already claimed or fully used). Nothing was changed.`
                        : `❌ The page’s voucher buttons didn’t line up with the shop’s voucher list (${clicked}), so nothing was clicked.`

                    return
                  }

                  yield* waitForCollected(
                    c,
                    (x) => findCollected(x, "save_voucher") !== undefined,
                    "12 seconds"
                  )
                })
            })

            if (outcome !== undefined) return outcome

            const saved = findCollected(got, "save_voucher")
            const savedOpt = saved !== undefined ? decodeSaveVoucher(saved.json) : Option.none()

            const code = Option.isSome(savedOpt)
              ? savedOpt.value.data?.voucher?.voucher_code
              : undefined

            if (!responseSucceeded(saved)) {
              return `❌ Shopee did not confirm claiming \`${voucherCode}\`.`
            }

            if (code !== undefined && code !== voucherCode) {
              return `⚠️ Shopee saved \`${code}\`, not \`${voucherCode}\` — check your voucher wallet.`
            }

            return `🎟 Claimed \`${voucherCode}\` — ${target !== undefined ? voucherBenefit(target, config.currency) : "saved"} — into your voucher wallet.`
          })
        )
      })
    })
  })
)

const AccountVisibilityLayer = Layer.unwrap(
  Effect.gen(function*() {
    const mode = yield* AccountMode

    return McpServer.visibility(() => mode.isActive).layer
  })
)

export const ShopeeRegistrations = Layer.mergeAll(
  McpServer.toolkit(PublicToolkit).pipe(Layer.provide(PublicHandlersLayer)),
  McpServer.toolkit(AccountToolkit).pipe(
    Layer.provide(AccountVisibilityLayer),
    Layer.provide(AccountHandlersLayer)
  )
)
