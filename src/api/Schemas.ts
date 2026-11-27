import { Schema } from "effect"

export type JsonValue = Schema.Json

export type JsonObject = Schema.JsonObject

export const ApiErrorEnvelope = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String))
})

// ─── Search Schemas ───────────────────────────────────────────────────────────

export const ItemRating = Schema.Struct({
  rating_star: Schema.Number,
  rating_count: Schema.Array(Schema.Number)
})

export type ItemRating = typeof ItemRating.Type

export const ItemBasic = Schema.Struct({
  itemid: Schema.Number,
  shopid: Schema.Number,
  name: Schema.String,
  price: Schema.Number,
  price_min: Schema.Number,
  price_max: Schema.Number,
  price_before_discount: Schema.Number,
  currency: Schema.String,
  stock: Schema.Number,
  sold: Schema.Number,
  historical_sold: Schema.Number,
  liked_count: Schema.Number,
  discount: Schema.optional(Schema.NullOr(Schema.String)),
  item_rating: Schema.optional(Schema.NullOr(ItemRating)),
  shop_location: Schema.String,
  is_official_shop: Schema.Boolean,
  shopee_verified: Schema.Boolean,
  image: Schema.String
})

export type ItemBasic = typeof ItemBasic.Type

export const CardDisplayPrice = Schema.Struct({
  price: Schema.Number,
  strikethrough_price: Schema.optional(Schema.NullOr(Schema.Number)),
  original_price: Schema.optional(Schema.NullOr(Schema.Number)),
  discount: Schema.optional(Schema.NullOr(Schema.Number))
})

export const CardSoldCount = Schema.Struct({
  historical_sold_count: Schema.optional(Schema.NullOr(Schema.Number)),
  monthly_sold_count: Schema.optional(Schema.NullOr(Schema.Number)),
  historical_sold_count_text: Schema.optional(Schema.NullOr(Schema.String)),
  monthly_sold_count_text: Schema.optional(Schema.NullOr(Schema.String))
})

export const CardItemData = Schema.Struct({
  itemid: Schema.optional(Schema.Number),
  shopid: Schema.optional(Schema.Number),
  item_card_display_price: Schema.optional(Schema.NullOr(CardDisplayPrice)),
  item_card_display_sold_count: Schema.optional(Schema.NullOr(CardSoldCount)),
  item_rating: Schema.optional(Schema.NullOr(ItemRating)),
  shop_data: Schema.optional(
    Schema.NullOr(Schema.Struct({ shop_name: Schema.optional(Schema.NullOr(Schema.String)) }))
  ),
  shopee_verified: Schema.optional(Schema.NullOr(Schema.Boolean))
})

export const CardDisplayedAsset = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  image: Schema.optional(Schema.NullOr(Schema.String)),
  shop_location: Schema.optional(Schema.NullOr(Schema.String))
})

export const RealItemEntry = Schema.Struct({
  item_basic: Schema.optional(Schema.NullOr(ItemBasic)),
  item_id: Schema.optional(Schema.Number),
  shop_id: Schema.optional(Schema.Number),
  model_id: Schema.optional(Schema.Number)
})

export const SearchItem = Schema.Struct({
  itemid: Schema.Number,
  shopid: Schema.Number,
  item_basic: Schema.optional(Schema.NullOr(ItemBasic)),
  item_data: Schema.optional(Schema.NullOr(CardItemData)),
  item_card_displayed_asset: Schema.optional(Schema.NullOr(CardDisplayedAsset)),
  real_items: Schema.optional(Schema.NullOr(Schema.Array(RealItemEntry)))
})

export type SearchItem = typeof SearchItem.Type

export const SearchItemsResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  total_count: Schema.optional(Schema.NullOr(Schema.Number)),
  nomore: Schema.optional(Schema.Boolean),
  items: Schema.optional(Schema.NullOr(Schema.Array(SearchItem)))
})

export type SearchItemsResponse = typeof SearchItemsResponse.Type

export interface SearchResult {
  readonly itemid: number
  readonly shopid: number
  readonly name: string
  readonly price: number
  readonly priceMin?: number | undefined
  readonly priceMax?: number | undefined
  readonly priceBeforeDiscount?: number | undefined
  readonly currency?: string | undefined
  readonly ratingStar?: number | undefined
  readonly sold?: number | undefined
  readonly soldText?: string | undefined
  readonly shopLocation?: string | undefined
  readonly isOfficialShop?: boolean | undefined
}

// ─── Product Detail Schemas ───────────────────────────────────────────────────

export const PdpCategory = Schema.Struct({
  display_name: Schema.String
})

export const PdpModel = Schema.Struct({
  model_id: Schema.Number,
  name: Schema.String,
  price: Schema.Number,
  price_before_discount: Schema.optional(Schema.NullOr(Schema.Number)),
  stock: Schema.optional(Schema.NullOr(Schema.Number)),
  normal_stock: Schema.optional(Schema.NullOr(Schema.Number)),
  has_stock: Schema.optional(Schema.NullOr(Schema.Boolean)),
  status: Schema.optional(Schema.NullOr(Schema.Number)),
  extinfo: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        tier_index: Schema.optional(Schema.Array(Schema.Number)),
        is_pre_order: Schema.optional(Schema.Boolean),
        estimated_days: Schema.optional(Schema.Number)
      })
    )
  )
})

export type PdpModel = typeof PdpModel.Type

export const PdpTierVariation = Schema.Struct({
  name: Schema.String,
  options: Schema.Array(Schema.String)
})

export const SelectVariationResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(
    Schema.NullOr(Schema.Struct({ stock: Schema.optional(Schema.NullOr(Schema.Number)) }))
  )
})

export type SelectVariationResponse = typeof SelectVariationResponse.Type

export const PdpItem = Schema.Struct({
  item_id: Schema.Number,
  shop_id: Schema.Number,
  title: Schema.String,
  models: Schema.optional(Schema.NullOr(Schema.Array(PdpModel))),
  tier_variations: Schema.optional(Schema.NullOr(Schema.Array(PdpTierVariation))),
  brand: Schema.optional(Schema.NullOr(Schema.String)),
  condition: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  item_rating: Schema.optional(Schema.NullOr(ItemRating)),
  shop_location: Schema.optional(Schema.NullOr(Schema.String)),
  categories: Schema.optional(Schema.NullOr(Schema.Array(PdpCategory))),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  image: Schema.optional(Schema.NullOr(Schema.String)),
  stock: Schema.optional(Schema.NullOr(Schema.Number)),
  normal_stock: Schema.optional(Schema.NullOr(Schema.Number)),
  historical_sold: Schema.optional(Schema.NullOr(Schema.Number)),
  global_sold_count: Schema.optional(Schema.NullOr(Schema.Number)),
  is_free_shipping: Schema.optional(Schema.NullOr(Schema.Boolean)),
  is_official_shop: Schema.optional(Schema.NullOr(Schema.Boolean))
})

export type PdpItem = typeof PdpItem.Type

export const PdpPriceValue = Schema.Struct({
  single_value: Schema.Number,
  range_min: Schema.Number,
  range_max: Schema.Number
})

export type PdpPriceValue = typeof PdpPriceValue.Type

export const PdpProductPrice = Schema.Struct({
  discount: Schema.optional(Schema.NullOr(Schema.Number)),
  price: PdpPriceValue,
  price_before_discount: Schema.optional(Schema.NullOr(PdpPriceValue))
})

export const PdpProductReview = Schema.Struct({
  total_rating_count: Schema.optional(Schema.NullOr(Schema.Number)),
  cmt_count: Schema.optional(Schema.NullOr(Schema.Number)),
  sold_count_display: Schema.optional(Schema.NullOr(Schema.String)),
  historical_sold_display: Schema.optional(Schema.NullOr(Schema.String)),
  global_sold_display: Schema.optional(Schema.NullOr(Schema.String)),
  liked: Schema.optional(Schema.NullOr(Schema.Boolean))
})

export const PdpAttribute = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  id: Schema.optional(Schema.NullOr(Schema.Number))
})

export type PdpAttribute = typeof PdpAttribute.Type

export const PdpChannel = Schema.Struct({
  name: Schema.String,
  price: Schema.optional(Schema.NullOr(PdpPriceValue)),
  channel_delivery_info: Schema.optional(
    Schema.NullOr(Schema.Struct({ edt_text: Schema.optional(Schema.NullOr(Schema.String)) }))
  )
})

export const PdpShipping = Schema.Struct({
  free_shipping: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        min_spend: Schema.optional(Schema.NullOr(PdpPriceValue)),
        has_fss: Schema.optional(Schema.Boolean)
      })
    )
  ),
  shipping_fee_info: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        ship_from_location: Schema.optional(Schema.NullOr(Schema.String)),
        price: Schema.optional(Schema.NullOr(PdpPriceValue))
      })
    )
  ),
  ungrouped_channel_infos: Schema.optional(Schema.NullOr(Schema.Array(PdpChannel)))
})

export type PdpShipping = typeof PdpShipping.Type

export const PdpShop = Schema.Struct({
  shopid: Schema.Number,
  name: Schema.String,
  place: Schema.optional(Schema.NullOr(Schema.String)),
  rating_star: Schema.optional(Schema.NullOr(Schema.Number)),
  response_rate: Schema.optional(Schema.NullOr(Schema.Number)),
  follower_count: Schema.optional(Schema.NullOr(Schema.Number)),
  item_count: Schema.optional(Schema.NullOr(Schema.Number)),
  is_official_shop: Schema.optional(Schema.NullOr(Schema.Boolean)),
  is_shopee_verified: Schema.optional(Schema.NullOr(Schema.Boolean)),
  is_preferred_plus_seller: Schema.optional(Schema.NullOr(Schema.Boolean)),
  vacation: Schema.optional(Schema.NullOr(Schema.Boolean))
})

export type PdpShop = typeof PdpShop.Type

export const PdpResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        item: PdpItem,
        product_price: PdpProductPrice,
        product_review: Schema.optional(Schema.NullOr(PdpProductReview)),
        product_attributes: Schema.optional(
          Schema.NullOr(Schema.Struct({ attrs: Schema.optional(Schema.NullOr(Schema.Array(PdpAttribute))) }))
        ),
        product_shipping: Schema.optional(Schema.NullOr(PdpShipping)),
        shop_detailed: Schema.optional(Schema.NullOr(PdpShop))
      })
    )
  )
})

export type PdpResponse = typeof PdpResponse.Type

export interface VariantRow {
  readonly modelId: number
  readonly name: string
  readonly price: number
  readonly priceBeforeDiscount?: number | undefined
  readonly stock?: number | undefined
  readonly inStock?: boolean | undefined
  readonly isPreOrder?: boolean | undefined
}

// ─── Review Schemas ───────────────────────────────────────────────────────────

export const Rating = Schema.Struct({
  cmtid: Schema.Number,
  rating_star: Schema.Number,
  comment: Schema.optional(Schema.NullOr(Schema.String)),
  author_username: Schema.optional(Schema.NullOr(Schema.String)),
  anonymous: Schema.optional(Schema.Boolean),
  ctime: Schema.Number,
  like_count: Schema.optional(Schema.NullOr(Schema.Number)),
  images: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  videos: Schema.optional(Schema.NullOr(Schema.Array(Schema.Json))),
  product_items: Schema.optional(
    Schema.NullOr(
      Schema.Array(Schema.Struct({ model_name: Schema.optional(Schema.NullOr(Schema.String)) }))
    )
  ),
  ItemRatingReply: Schema.optional(
    Schema.NullOr(Schema.Struct({ comment: Schema.optional(Schema.NullOr(Schema.String)) }))
  )
})

export type Rating = typeof Rating.Type

export const RatingSummary = Schema.Struct({
  rating_total: Schema.Number,
  rating_count: Schema.Array(Schema.Number),
  rcount_with_context: Schema.optional(Schema.Number),
  rcount_with_media: Schema.optional(Schema.Number)
})

export type RatingSummary = typeof RatingSummary.Type

export const RatingsResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        ratings: Schema.optional(Schema.NullOr(Schema.Array(Rating))),
        item_rating_summary: Schema.optional(Schema.NullOr(RatingSummary)),
        has_more: Schema.optional(Schema.Boolean)
      })
    )
  )
})

export type RatingsResponse = typeof RatingsResponse.Type

// ─── Shop Schemas ─────────────────────────────────────────────────────────────

export const ShopBase = Schema.Struct({
  shopid: Schema.Number,
  userid: Schema.optional(Schema.Number),
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  account: Schema.optional(
    Schema.NullOr(Schema.Struct({ username: Schema.optional(Schema.String) }))
  ),
  rating_star: Schema.optional(Schema.Number),
  follower_count: Schema.optional(Schema.Number),
  item_count: Schema.optional(Schema.Number),
  response_rate: Schema.optional(Schema.Number),
  response_time: Schema.optional(Schema.Number),
  ctime: Schema.optional(Schema.Number),
  last_active_time: Schema.optional(Schema.Number),
  vacation: Schema.optional(Schema.Boolean),
  followed: Schema.optional(Schema.Boolean),
  is_official_shop: Schema.optional(Schema.Boolean),
  is_shopee_verified: Schema.optional(Schema.Boolean),
  is_preferred_plus_seller: Schema.optional(Schema.Boolean)
})

export type ShopBase = typeof ShopBase.Type

export const ShopBaseResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(Schema.NullOr(ShopBase))
})

export type ShopBaseResponse = typeof ShopBaseResponse.Type

// ─── Flash Sale Schemas ───────────────────────────────────────────────────────

export const FlashSaleSession = Schema.Struct({
  promotionid: Schema.Number,
  name: Schema.optional(Schema.String),
  start_time: Schema.Number,
  end_time: Schema.Number,
  is_ongoing: Schema.optional(Schema.Boolean)
})

export type FlashSaleSession = typeof FlashSaleSession.Type

export const FlashSaleItem = Schema.Struct({
  itemid: Schema.Number,
  shopid: Schema.Number,
  name: Schema.String,
  price: Schema.Number,
  price_before_discount: Schema.optional(Schema.Number),
  discount: Schema.optional(Schema.NullOr(Schema.String)),
  stock: Schema.optional(Schema.Number),
  flash_sale_stock: Schema.optional(Schema.Number),
  promotionid: Schema.optional(Schema.Number),
  item_rating: Schema.optional(
    Schema.NullOr(Schema.Struct({ rating_star: Schema.optional(Schema.Number) }))
  )
})

export type FlashSaleItem = typeof FlashSaleItem.Type

export const FlashSaleSessionsPayload = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(Schema.Struct({ sessions: Schema.optional(Schema.NullOr(Schema.Array(FlashSaleSession))) }))
  )
})

export const FlashSaleItemsPayload = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(Schema.Struct({ items: Schema.optional(Schema.NullOr(Schema.Array(FlashSaleItem))) }))
  )
})

// ─── Cart Schemas ─────────────────────────────────────────────────────────────

export const CartItem = Schema.Struct({
  itemid: Schema.Number,
  shopid: Schema.Number,
  modelid: Schema.optional(Schema.Number),
  name: Schema.String,
  model_name: Schema.optional(Schema.NullOr(Schema.String)),
  price: Schema.Number,
  price_before_discount: Schema.optional(Schema.NullOr(Schema.Number)),
  quantity: Schema.Number,
  item_stock: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: Schema.optional(Schema.String)
})

export type CartItem = typeof CartItem.Type

export const CartBlock = Schema.Struct({
  shops: Schema.optional(
    Schema.NullOr(
      Schema.Array(Schema.Struct({ shopname: Schema.optional(Schema.String), shopid: Schema.Number }))
    )
  ),
  items: Schema.optional(Schema.NullOr(Schema.Array(CartItem)))
})

export type CartBlock = typeof CartBlock.Type

export const CartResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(
    Schema.NullOr(Schema.Struct({ cart_blocks: Schema.optional(Schema.NullOr(Schema.Array(CartBlock))) }))
  )
})

export type CartResponse = typeof CartResponse.Type

// ─── Account / Orders / Vouchers / Coins / Notifications Schemas ──────────────

export const OrderItem = Schema.Struct({
  item_id: Schema.Number,
  shop_id: Schema.Number,
  model_id: Schema.optional(Schema.Number),
  name: Schema.String,
  model_name: Schema.optional(Schema.String),
  amount: Schema.Number,
  item_price: Schema.optional(Schema.Number),
  order_price: Schema.optional(Schema.Number)
})

export const OrderCard = Schema.Struct({
  shop_info: Schema.optional(
    Schema.Struct({ shop_id: Schema.Number, shop_name: Schema.optional(Schema.String) })
  ),
  product_info: Schema.optional(
    Schema.Struct({
      item_groups: Schema.optional(Schema.Array(Schema.Struct({ items: Schema.optional(Schema.Array(OrderItem)) })))
    })
  )
})

export const OrderListDetail = Schema.Struct({
  status: Schema.optional(
    Schema.Struct({
      status_label: Schema.optional(Schema.Struct({ text: Schema.optional(Schema.String) })),
      list_view_status_label: Schema.optional(Schema.Struct({ text: Schema.optional(Schema.String) }))
    })
  ),
  info_card: Schema.optional(
    Schema.Struct({
      order_id: Schema.Number,
      order_list_cards: Schema.optional(Schema.Array(OrderCard)),
      product_count: Schema.optional(Schema.Number),
      final_total: Schema.optional(Schema.Number)
    })
  )
})

export type OrderListDetail = typeof OrderListDetail.Type

export const OrderListPayload = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(Schema.Struct({ details_list: Schema.optional(Schema.NullOr(Schema.Array(OrderListDetail))) }))
  ),
  new_data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        order_or_checkout_data: Schema.optional(
          Schema.NullOr(
            Schema.Array(Schema.Struct({ order_list_detail: Schema.optional(OrderListDetail) }))
          )
        )
      })
    )
  )
})

export const TrackingEvent = Schema.Struct({
  ctime: Schema.Number,
  description: Schema.optional(Schema.String)
})

export const OrderDetail = Schema.Struct({
  status: Schema.optional(
    Schema.Struct({ status_label: Schema.optional(Schema.Struct({ text: Schema.optional(Schema.String) })) })
  ),
  pc_shipping: Schema.optional(
    Schema.Struct({
      fulfilment_carrier: Schema.optional(Schema.Struct({ text: Schema.optional(Schema.String) })),
      forder_shipping_info_list: Schema.optional(
        Schema.NullOr(
          Schema.Array(
            Schema.Struct({
              tracking_number: Schema.optional(Schema.String),
              tracking_info_list: Schema.optional(Schema.NullOr(Schema.Array(TrackingEvent)))
            })
          )
        )
      )
    })
  ),
  info_card: Schema.optional(
    Schema.Struct({
      parcel_cards: Schema.optional(
        Schema.Array(
          Schema.Struct({
            shop_info: Schema.optional(Schema.Struct({ shop_name: Schema.optional(Schema.String) })),
            product_info: Schema.optional(
              Schema.Struct({
                item_groups: Schema.optional(
                  Schema.Array(Schema.Struct({ items: Schema.optional(Schema.Array(OrderItem)) }))
                )
              })
            )
          })
        )
      ),
      subtotal: Schema.optional(Schema.Number),
      final_total: Schema.optional(Schema.Number),
      currency: Schema.optional(Schema.String)
    })
  ),
  payment_method: Schema.optional(
    Schema.Struct({ payment_channel_name: Schema.optional(Schema.Struct({ text: Schema.optional(Schema.String) })) })
  ),
  pc_processing_info: Schema.optional(
    Schema.Struct({
      order_sn: Schema.optional(Schema.String),
      create_time: Schema.optional(Schema.Number),
      pay_time: Schema.optional(Schema.Number),
      shipping_confirm_time: Schema.optional(Schema.Number),
      delivery_time: Schema.optional(Schema.Number),
      complete_time: Schema.optional(Schema.Number),
      is_rated: Schema.optional(Schema.Boolean)
    })
  )
})

export type OrderDetail = typeof OrderDetail.Type

export const OrderDetailResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(Schema.NullOr(OrderDetail))
})

export const WalletVoucher = Schema.Struct({
  voucher_code: Schema.optional(Schema.String),
  min_spend: Schema.optional(Schema.Number),
  discount_value: Schema.optional(Schema.Number),
  discount_percentage: Schema.optional(Schema.Number),
  discount_cap: Schema.optional(Schema.Number),
  reward_percentage: Schema.optional(Schema.Number),
  reward_cap: Schema.optional(Schema.Number),
  reward_type: Schema.optional(Schema.Number),
  end_time: Schema.optional(Schema.Number),
  shop_name: Schema.optional(Schema.NullOr(Schema.String)),
  icon_text: Schema.optional(Schema.NullOr(Schema.String)),
  percentage_used: Schema.optional(Schema.NullOr(Schema.Number))
})

export type WalletVoucher = typeof WalletVoucher.Type

export const VoucherWalletResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ user_voucher_list: Schema.optional(Schema.NullOr(Schema.Array(WalletVoucher))) })
    )
  )
})

export const CoinsSummaryResponse = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        coin_info: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              available_amount: Schema.optional(Schema.Number),
              fe_available_amount: Schema.optional(Schema.Number)
            })
          )
        )
      })
    )
  )
})

export const CoinsTransactionsResponse = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        coin_transactions: Schema.optional(
          Schema.NullOr(
            Schema.Array(
              Schema.Struct({
                ctime: Schema.optional(Schema.Number),
                amount: Schema.optional(Schema.Number),
                name: Schema.optional(Schema.String),
                reason: Schema.optional(Schema.String)
              })
            )
          )
        )
      })
    )
  )
})

export const NotificationAction = Schema.Struct({
  title: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  createtime: Schema.optional(Schema.Number),
  id_info: Schema.optional(
    Schema.NullOr(Schema.Struct({ orderid: Schema.optional(Schema.NullOr(Schema.Number)) }))
  )
})

export type NotificationAction = typeof NotificationAction.Type

export const NotificationsResponse = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(Schema.Struct({ actions: Schema.optional(Schema.NullOr(Schema.Array(NotificationAction))) }))
  )
})

export const ShopVoucher = Schema.Struct({
  ...WalletVoucher.fields,
  promotionid: Schema.Number,
  voucher_code: Schema.String,
  is_claimed_before: Schema.optional(Schema.Boolean)
})

export type ShopVoucher = typeof ShopVoucher.Type

export const ShopTabResponse = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        decoration: Schema.optional(
          Schema.NullOr(
            Schema.Array(
              Schema.Struct({
                shop_voucher: Schema.optional(
                  Schema.NullOr(
                    Schema.Struct({ voucher_list: Schema.optional(Schema.NullOr(Schema.Array(ShopVoucher))) })
                  )
                )
              })
            )
          )
        )
      })
    )
  )
})

export type ShopTabResponse = typeof ShopTabResponse.Type

export const SaveVoucherResponse = Schema.Struct({
  error: Schema.optional(Schema.NullOr(Schema.Number)),
  error_msg: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        voucher: Schema.optional(Schema.NullOr(Schema.Struct({ voucher_code: Schema.optional(Schema.String) })))
      })
    )
  )
})

export interface CollectedResponse {
  readonly url: string
  readonly postData: string
  readonly json: JsonValue
}
