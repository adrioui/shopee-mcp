import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"

export const REVIEWS_PER_PAGE = 6
export const MAX_REVIEW_PAGE = 10
export const MAX_QUANTITY_STEP = 20

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

const IntBetween = (min: number, max: number) =>
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(min), Schema.isLessThanOrEqualTo(max))

const NumericString = Schema.String.check(Schema.isPattern(/^\d+$/))

const ProductLocatorFields = {
  shopId: Schema.optional(
    Schema.String.annotate({ description: "Numeric shop ID (from search_products)" })
  ),
  itemId: Schema.optional(
    Schema.String.annotate({ description: "Numeric item/product ID (from search_products)" })
  ),
  url: Schema.optional(
    Schema.String.annotate({
      description: "Full product URL, e.g. https://shopee.co.id/product/78730497/47060432055"
    })
  )
}

// ─── Public Discovery Tools (always visible) ──────────────────────────────────

export const SearchProductsTool = Tool.make("search_products", {
  description:
    "Search for products on Shopee by keyword, with sorting, filters (price range, minimum rating, seller location, Shopee Mall only) and pagination. " +
    "Returns product names, prices, sold counts, ratings, seller location, product IDs, and direct URLs. " +
    "Requires a one-time login (run `pnpm run login`) because Shopee blocks anonymous requests.",
  parameters: Schema.Struct({
    query: Schema.NonEmptyString.annotate({
      description: 'The search query, e.g. "laptop gaming", "sepatu nike"'
    }),
    page: Schema.optional(PositiveInt.annotate({ description: "Page number (default: 1)" })),
    limit: Schema.optional(
      IntBetween(1, 60).annotate({
        description: "Max results to show from the page, 1-60 (default: 20)"
      })
    ),
    sort: Schema.optional(
      Schema.Literals(["relevance", "newest", "top_sales", "price_low", "price_high"]).annotate({
        description: "Sort order (default: relevance)"
      })
    ),
    minPrice: Schema.optional(
      Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
        description: "Minimum price in whole currency units, e.g. 200000 for Rp200.000"
      })
    ),
    maxPrice: Schema.optional(
      Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
        description: "Maximum price in whole currency units"
      })
    ),
    minRating: Schema.optional(
      IntBetween(1, 5).annotate({
        description: "Only products rated at least this many stars (1-5)"
      })
    ),
    location: Schema.optional(
      Schema.String.annotate({
        description: 'Seller location as Shopee names it, e.g. "DKI Jakarta", "Jawa Barat"'
      })
    ),
    officialMallOnly: Schema.optional(
      Schema.Boolean.annotate({ description: "Only products from Shopee Mall (official) shops" })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const GetProductDetailTool = Tool.make("get_product_detail", {
  description:
    "Get details for a Shopee product: title, price (and discount), brand, condition, category, rating, stock, specs, " +
    "shipping (origin, fee, free-shipping threshold, delivery estimate), seller summary, and description. " +
    "Provide the numeric shopId + itemId (from search_products), or a full product URL.",
  parameters: Schema.Struct(ProductLocatorFields),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const GetProductVariantsTool = Tool.make("get_product_variants", {
  description:
    "List every variant (model) of a Shopee product: exact model IDs, variant names, and per-variant prices. " +
    "Use the model ID to refer to one specific variant of a multi-option listing. " +
    "Set includeStock=true to also fetch exact stock counts (slower — Shopee only reveals them one variant at a time).",
  parameters: Schema.Struct({
    ...ProductLocatorFields,
    includeStock: Schema.optional(
      Schema.Boolean.annotate({
        description:
          "Fetch exact per-variant stock counts. Off by default because it costs a round trip per variant; when off, each variant is reported as in/out of stock."
      })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const GetProductReviewsTool = Tool.make("get_product_reviews", {
  description:
    "Read buyer reviews for a Shopee product: the rating summary (star breakdown, reviews with media/comments) " +
    `and a page of ${REVIEWS_PER_PAGE} reviews with star rating, variant bought, comment, and seller reply. ` +
    "Filter by star rating or to reviews with comments/media. Slower than get_product_detail — it scrolls the page and clicks through Shopee's review pager.",
  parameters: Schema.Struct({
    ...ProductLocatorFields,
    filter: Schema.optional(
      Schema.Literals(["all", "5", "4", "3", "2", "1", "with_comments", "with_media"]).annotate({
        description: '"all", a star rating "1"-"5", "with_comments", or "with_media" (default: all)'
      })
    ),
    page: Schema.optional(
      IntBetween(1, MAX_REVIEW_PAGE).annotate({
        description: `Review page, 1-${MAX_REVIEW_PAGE} (${REVIEWS_PER_PAGE} reviews each; default: 1)`
      })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const GetShopInfoTool = Tool.make("get_shop_info", {
  description:
    "Get a Shopee seller's profile: name, Shopee Mall / Star+ / verified badges, shop rating, product and follower " +
    "counts, chat response rate and time, join date, last active, vacation status, and description. " +
    "Takes the numeric shopId (shown by search_products / get_product_detail) or the shop's username.",
  parameters: Schema.Struct({
    shopId: Schema.optional(Schema.String.annotate({ description: "Numeric shop ID" })),
    username: Schema.optional(
      Schema.String.annotate({
        description: "Shop username — the part after the domain in the shop URL"
      })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const GetShopProductsTool = Tool.make("get_shop_products", {
  description:
    "List the products a Shopee shop sells, with sorting and pagination — names, prices, sold counts, ratings, " +
    "product IDs, and URLs. Use it to browse one seller's catalogue after search_products or get_shop_info.",
  parameters: Schema.Struct({
    shopId: Schema.NonEmptyString.annotate({ description: "Numeric shop ID" }),
    page: Schema.optional(PositiveInt.annotate({ description: "Page number (default: 1)" })),
    limit: Schema.optional(
      IntBetween(1, 60).annotate({
        description: "Max results to show from the page, 1-60 (default: 20)"
      })
    ),
    sort: Schema.optional(
      Schema.Literals(["popular", "newest", "top_sales", "price_low", "price_high"]).annotate({
        description: "Sort order (default: popular)"
      })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const GetFlashSaleTool = Tool.make("get_flash_sale", {
  description:
    "Show Shopee's current Flash Sale: the active session's time window, upcoming sessions, and the deals — " +
    "flash price vs. original price, discount, how much of the flash stock is claimed, and product URLs.",
  parameters: Schema.Struct({
    limit: Schema.optional(
      IntBetween(1, 60).annotate({
        description: "Max deals to list, 1-60 (default: 20). More deals take longer to load."
      })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true)

export const CheckLoginStatusTool = Tool.make("check_login_status", {
  description:
    "Check whether the saved browser session is logged into Shopee. " +
    "Useful to verify setup before calling search_products / get_product_detail, " +
    "since those fail slowly (a full page load) when the session is signed out.",
  parameters: Tool.EmptyParams,
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

// ─── Experimental Account Tools (visible only when logged in & auto) ──────────

export const GetOrdersTool = Tool.make("get_orders", {
  description:
    "[Experimental, account] List your Shopee orders: status, shop, items, and totals. Filter by tab " +
    "(all, to_ship, to_receive, completed, cancelled). Use get_order_detail for tracking.",
  parameters: Schema.Struct({
    status: Schema.optional(
      Schema.Literals(["all", "to_ship", "to_receive", "completed", "cancelled"]).annotate({
        description: "Which purchase tab to read (default: all)"
      })
    ),
    limit: Schema.optional(
      IntBetween(1, 30).annotate({ description: "Max orders, 1-30 (default: 10)" })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GetOrderDetailTool = Tool.make("get_order_detail", {
  description:
    "[Experimental, account] One of your orders in detail: status, items, total paid, payment channel, " +
    "timeline, courier, tracking number and latest tracking events. Your address and phone are omitted.",
  parameters: Schema.Struct({
    orderId: NumericString.annotate({ description: "Order ID (from get_orders)" })
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GetMyVouchersTool = Tool.make("get_my_vouchers", {
  description:
    "[Experimental, account] Vouchers saved in your voucher wallet: benefit, where it applies, minimum spend, and expiry.",
  parameters: Schema.Struct({
    limit: Schema.optional(
      IntBetween(1, 50).annotate({ description: "Max vouchers, 1-50 (default: 20)" })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GetCoinsTool = Tool.make("get_coins", {
  description: "[Experimental, account] Your Shopee Coins balance and recent coin transactions.",
  parameters: Tool.EmptyParams,
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GetNotificationsTool = Tool.make("get_notifications", {
  description:
    "[Experimental, account] Your Shopee notifications: order updates, promotions, or Shopee updates.",
  parameters: Schema.Struct({
    category: Schema.optional(
      Schema.Literals(["order", "promotion", "shopee"]).annotate({
        description: "Notification tab (default: order)"
      })
    ),
    limit: Schema.optional(
      IntBetween(1, 20).annotate({ description: "Max notifications, 1-20 (default: 10)" })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GetCartTool = Tool.make("get_cart", {
  description:
    "[Experimental] Read the logged-in Shopee cart: items grouped by shop, variant, quantity, price, and model IDs. Does not modify the cart.",
  parameters: Tool.EmptyParams,
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const AddToCartTool = Tool.make("add_to_cart", {
  description:
    '[Experimental — modifies your Shopee account] Add a product (and specific variant) to the logged-in cart by clicking Shopee\'s own "Add to Cart" button. Never checks out or pays. For multi-variant listings, call get_product_variants first and pass the exact modelId. Only call this when the user explicitly asks.',
  parameters: Schema.Struct({
    ...ProductLocatorFields,
    modelId: Schema.optional(
      Schema.String.annotate({
        description: "Exact model_id from get_product_variants. Required when the listing has variants."
      })
    ),
    quantity: Schema.optional(
      IntBetween(1, 20).annotate({ description: "Quantity to add, 1-20 (default: 1)" })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true)

export const UpdateCartItemTool = Tool.make("update_cart_item", {
  description:
    "[Experimental — modifies your Shopee account] Change the quantity of an item already in the cart, " +
    "or remove it with quantity=0, using the cart page's own +/−/Delete controls. Get itemId and modelId " +
    "from get_cart. Only call this when the user explicitly asks.",
  parameters: Schema.Struct({
    itemId: Schema.NonEmptyString.annotate({
      description: "Numeric item ID of the cart line (from get_cart)"
    }),
    modelId: Schema.optional(
      Schema.String.annotate({
        description:
          "model_id of the cart line (from get_cart). Required when the item is in the cart in several variants."
      })
    ),
    quantity: IntBetween(0, 999).annotate({
      description: `New quantity; 0 removes the line. Changes by at most ${MAX_QUANTITY_STEP} per call.`
    })
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const LikeProductTool = Tool.make("like_product", {
  description:
    "[Experimental — modifies your Shopee account] Like (favourite) or unlike a product, via the product " +
    "page's own heart button. Does nothing if it is already in the requested state.",
  parameters: Schema.Struct({
    ...ProductLocatorFields,
    like: Schema.optional(
      Schema.Boolean.annotate({ description: "true to like, false to unlike (default: true)" })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const FollowShopTool = Tool.make("follow_shop", {
  description:
    "[Experimental — modifies your Shopee account] Follow or unfollow a shop, via the shop page's own " +
    "Follow button. Does nothing if it is already in the requested state.",
  parameters: Schema.Struct({
    shopId: NumericString.annotate({ description: "Numeric shop ID" }),
    follow: Schema.optional(
      Schema.Boolean.annotate({ description: "true to follow, false to unfollow (default: true)" })
    )
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const GetShopVouchersTool = Tool.make("get_shop_vouchers", {
  description:
    "[Experimental, account] The vouchers a shop is currently giving away: benefit, minimum spend, expiry, " +
    "code, and whether you have already claimed each one. Claim one with claim_shop_voucher.",
  parameters: Schema.Struct({
    shopId: NumericString.annotate({ description: "Numeric shop ID" })
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const ClaimShopVoucherTool = Tool.make("claim_shop_voucher", {
  description:
    "[Experimental — modifies your Shopee account] Claim (save) one of a shop's vouchers into your voucher " +
    "wallet, via the shop page's own Claim button. Get the code from get_shop_vouchers. A claim cannot be undone.",
  parameters: Schema.Struct({
    shopId: NumericString.annotate({ description: "Numeric shop ID" }),
    voucherCode: Schema.NonEmptyString.annotate({
      description: "Voucher code from get_shop_vouchers"
    })
  }),
  success: Schema.String
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const PublicToolkit = Toolkit.make(
  SearchProductsTool,
  GetProductDetailTool,
  GetProductVariantsTool,
  GetProductReviewsTool,
  GetShopInfoTool,
  GetShopProductsTool,
  GetFlashSaleTool,
  CheckLoginStatusTool
)

export const AccountToolkit = Toolkit.make(
  GetOrdersTool,
  GetOrderDetailTool,
  GetMyVouchersTool,
  GetCoinsTool,
  GetNotificationsTool,
  GetCartTool,
  AddToCartTool,
  UpdateCartItemTool,
  LikeProductTool,
  FollowShopTool,
  GetShopVouchersTool,
  ClaimShopVoucherTool
)
