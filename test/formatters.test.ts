import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import type { ItemBasic, PdpItem, PdpModel, Rating, SearchItem } from "../src/api/Schemas.js"
import { parseAccountToolsSetting, regionFor } from "../src/Config.js"
import { formatPrice } from "../src/Price.js"
import {
  buildSearchPath,
  buildVariantRows,
  collectFlashItems,
  collectOrders,
  decodeNotificationText,
  findCartItem,
  flashStockText,
  flattenSearchItems,
  formatCart,
  formatDuration,
  formatNotification,
  formatOrder,
  formatOrderDetail,
  formatReview,
  formatShop,
  formatShopVouchers,
  formatTime,
  humanizeLabel,
  modelOptionLabels,
  parseProductUrl,
  priceText,
  resolveProductIds,
  sellerLines,
  shippingLines,
  shopVouchersFrom,
  specLines,
  starBreakdown,
  voucherBenefit
} from "../src/tools/Formatters.js"

const fakeItemBasic = (overrides: Partial<ItemBasic> = {}): ItemBasic => ({
  itemid: 1,
  shopid: 1,
  name: "Test Product",
  price: 1000000,
  price_min: 1000000,
  price_max: 1000000,
  price_before_discount: 0,
  currency: "IDR",
  stock: 10,
  sold: 5,
  historical_sold: 5,
  liked_count: 0,
  item_rating: { rating_star: 4.5, rating_count: [] },
  shop_location: "Jakarta",
  is_official_shop: false,
  shopee_verified: false,
  image: "",
  ...overrides
})

const fakeCard = (overrides: Partial<SearchItem> = {}): SearchItem => ({
  itemid: 43174409162,
  shopid: 1432004273,
  item_basic: null,
  item_data: {
    item_card_display_price: {
      price: 22555000,
      strikethrough_price: 47806000,
      original_price: 47806000,
      discount: 53
    },
    item_card_display_sold_count: {
      historical_sold_count: 23758,
      monthly_sold_count: 19370,
      historical_sold_count_text: "20k+ sold"
    },
    item_rating: { rating_star: 4.97, rating_count: [] },
    shop_data: { shop_name: "Ugreen Official Shop" },
    shopee_verified: false
  },
  item_card_displayed_asset: {
    name: "Ugreen Nexode Power Bank 20000mAh 130W",
    image: "cn-11134207",
    shop_location: "Selangor"
  },
  ...overrides
})

const fakeModels = (): ReadonlyArray<PdpModel> => [
  {
    model_id: 139145426356,
    name: "200w 25 000mAh",
    price: 26900000,
    price_before_discount: 74750000,
    stock: null,
    has_stock: true,
    extinfo: { tier_index: [0], is_pre_order: false }
  },
  {
    model_id: 139145426358,
    name: "100w 12 000mAh",
    price: 18209000,
    price_before_discount: 42250000,
    stock: null,
    has_stock: false,
    extinfo: { tier_index: [2], is_pre_order: true }
  }
]

const fakeRating = (overrides: Partial<Rating> = {}): Rating => ({
  cmtid: 1,
  rating_star: 4,
  comment: "Bagus\nsekali",
  author_username: "buyer1",
  anonymous: false,
  ctime: 1771988322,
  like_count: 3,
  images: ["a", "b"],
  videos: [{}],
  product_items: [{ model_name: "Red,M" }],
  ...overrides
})

const fakeOrder = (id: number) => ({
  status: { list_view_status_label: { text: "label_completed" } },
  info_card: {
    order_id: id,
    final_total: 58900000000,
    order_list_cards: [
      {
        shop_info: { shop_id: 1, shop_name: "iconcomp" },
        product_info: {
          item_groups: [
            {
              items: [
                {
                  item_id: 5,
                  shop_id: 1,
                  name: "NVME 256GB",
                  model_name: "Hitam",
                  amount: 1,
                  order_price: 65000000000
                }
              ]
            }
          ]
        }
      }
    ]
  }
})

describe("flattenSearchItems", () => {
  it("normalises legacy item_basic, ads real_items, and newer card shapes", () => {
    const legacy: SearchItem = {
      itemid: 1,
      shopid: 1,
      item_basic: fakeItemBasic({ itemid: 1, name: "Legacy", shop_location: "Jakarta" })
    }

    const [r] = flattenSearchItems([legacy])

    assert.strictEqual(r.name, "Legacy")
    assert.strictEqual(r.price, 1000000)
    assert.strictEqual(r.currency, "IDR")
    assert.strictEqual(r.shopLocation, "Jakarta")
    assert.strictEqual(r.ratingStar, 4.5)

    const adsCard: SearchItem = {
      itemid: 0,
      shopid: 0,
      item_basic: null,
      real_items: [
        { item_basic: fakeItemBasic({ itemid: 1 }) },
        { item_basic: null },
        { item_basic: fakeItemBasic({ itemid: 2 }) }
      ]
    }

    assert.deepStrictEqual(
      flattenSearchItems([adsCard]).map((x) => x.itemid),
      [1, 2]
    )

    assert.deepStrictEqual(flattenSearchItems(null), [])
    assert.deepStrictEqual(flattenSearchItems(undefined), [])

    const [card] = flattenSearchItems([fakeCard()])

    assert.strictEqual(card.name, "Ugreen Nexode Power Bank 20000mAh 130W")
    assert.strictEqual(card.itemid, 43174409162)
    assert.strictEqual(card.soldText, "20k+ sold")
    assert.strictEqual(card.currency, undefined)

    const virtualCard = fakeCard({
      real_items: [{ item_id: 24782704787, shop_id: 64923440 }]
    })

    const [resolved] = flattenSearchItems([virtualCard])

    assert.strictEqual(resolved.itemid, 24782704787)
    assert.strictEqual(resolved.shopid, 64923440)

    const noName = fakeCard({ item_card_displayed_asset: { name: "", shop_location: "Selangor" } })

    assert.deepStrictEqual(flattenSearchItems([noName]), [])
  })
})

describe("formatPrice & regionFor & parseAccountToolsSetting", () => {
  it("formats regional currencies and falls back for unknown currencies", () => {
    assert.strictEqual(formatPrice(15000000000), "Rp150.000")
    assert.strictEqual(formatPrice(15000050000), "Rp150.001")
    assert.strictEqual(formatPrice(22555000, "MYR"), "RM225.55")
    assert.strictEqual(formatPrice(1999000, "SGD"), "S$19.99")
    assert.strictEqual(formatPrice(50000000, "TWD"), "NT$500")
    assert.strictEqual(formatPrice(500000000, "USD"), "USD 5.000")
  })

  it("maps domain suffixes to region defaults", () => {
    assert.deepStrictEqual(regionFor("shopee.co.id"), {
      locale: "id-ID",
      timezone: "Asia/Jakarta",
      currency: "IDR"
    })
    assert.deepStrictEqual(regionFor("shopee.com.my"), {
      locale: "en-MY",
      timezone: "Asia/Kuala_Lumpur",
      currency: "MYR"
    })
    assert.strictEqual(regionFor("shopee.my-mirror.tw").currency, "TWD")
    assert.strictEqual(regionFor("shopee.vn").currency, "IDR")
  })

  it("parses account tools setting (read-only by default)", () => {
    assert.strictEqual(parseAccountToolsSetting(undefined), "off")
    assert.strictEqual(parseAccountToolsSetting("off"), "off")
    assert.strictEqual(parseAccountToolsSetting("false"), "off")
    assert.strictEqual(parseAccountToolsSetting("0"), "off")
    assert.strictEqual(parseAccountToolsSetting("auto"), "auto")
    assert.strictEqual(parseAccountToolsSetting("TRUE"), "auto")
    assert.strictEqual(parseAccountToolsSetting("1"), "auto")
  })
})

describe("Product, variant, search path, review, shop, and flash sale formatters", () => {
  it("builds variant rows and folds exact stock counts including zero", () => {
    const [a, b] = buildVariantRows(
      fakeModels(),
      new Map([
        ["200w 25 000mAh", 0],
        ["100w 12 000mAh", 244]
      ])
    )

    assert.strictEqual(a.stock, 0)
    assert.strictEqual(b.stock, 244)
    assert.strictEqual(b.isPreOrder, true)
    assert.deepStrictEqual(buildVariantRows(null), [])
  })

  it("formats PDP prices, parses URLs, resolves IDs, specs, shipping, and seller", () => {
    assert.strictEqual(
      priceText({ single_value: 16303000, range_min: -1, range_max: -1 }, "MYR"),
      "RM163.03"
    )
    assert.strictEqual(
      priceText({ single_value: 0, range_min: 1000000, range_max: 2500000 }, "MYR"),
      "RM10.00 – RM25.00"
    )

    assert.deepStrictEqual(
      Option.getOrThrow(parseProductUrl("https://shopee.co.id/product/78730497/47060432055")),
      { shopId: "78730497", itemId: "47060432055" }
    )
    assert.deepStrictEqual(
      Option.getOrThrow(
        parseProductUrl("https://shopee.co.id/Some-Product-Name-i.78730497.47060432055")
      ),
      { shopId: "78730497", itemId: "47060432055" }
    )
    assert.isTrue(Option.isNone(resolveProductIds()))

    assert.deepStrictEqual(
      specLines([
        { name: "Discount stock", value: "IN STOCK", id: null },
        { name: "Brand", value: "-", id: 1 },
        { name: "Material", value: "Synthetic", id: 100134 }
      ]),
      ["  • Material: Synthetic"]
    )

    const ship = shippingLines(
      {
        free_shipping: {
          has_fss: true,
          min_spend: { single_value: 15000000000, range_min: -1, range_max: -1 }
        },
        shipping_fee_info: {
          ship_from_location: "KAB. BANDUNG",
          price: { single_value: -1, range_min: 0, range_max: 1500000000 }
        },
        ungrouped_channel_infos: [
          { name: "Reguler", channel_delivery_info: { edt_text: "Guaranteed to get by 1 Oct" } }
        ]
      },
      "IDR"
    )

    assert.deepStrictEqual(ship, [
      "  📍 Ships from: KAB. BANDUNG",
      "  💸 Shipping fee: Rp0 – Rp15.000",
      "  🚚 Free shipping on orders over Rp150.000",
      "  🕒 Reguler: Guaranteed to get by 1 Oct"
    ])

    const seller = sellerLines({
      shopid: 9,
      name: "Doclo.id",
      rating_star: 4.71,
      response_rate: 79,
      follower_count: 2634,
      is_shopee_verified: true,
      vacation: true
    })

    assert.strictEqual(seller[0], "  🏪 Doclo.id [Verified] — Shop ID `9`")
    assert.isTrue(seller[2].includes("vacation"))
  })

  it("builds search paths with filters", () => {
    const path = buildSearchPath("keyboard", 2, "price_low", {
      minPrice: 200000,
      maxPrice: 500000,
      minRating: 4,
      location: "DKI Jakarta",
      officialMallOnly: true
    })

    const qs = new URLSearchParams(path.split("?")[1])

    assert.strictEqual(qs.get("keyword"), "keyboard")
    assert.strictEqual(qs.get("page"), "1")
    assert.strictEqual(qs.get("sortBy"), "price")
    assert.strictEqual(qs.get("order"), "asc")
    assert.strictEqual(qs.get("minPrice"), "200000")
    assert.strictEqual(qs.get("officialMall"), "true")
  })

  it("formats reviews, shops, and flash sale items", () => {
    assert.strictEqual(
      starBreakdown({ rating_total: 10, rating_count: [1, 2, 3, 4, 1000] }),
      "5★ 1.000 · 4★ 4 · 3★ 3 · 2★ 2 · 1★ 1"
    )

    const [head, body] = formatReview(fakeRating(), 7).split("\n")

    assert.strictEqual(head, "7. ★★★★☆ | buyer1 | 2026-02-25 | variant: Red,M | 📷 3 | 👍 3")
    assert.strictEqual(body, "   Bagus sekali")
    assert.isTrue(formatReview(fakeRating({ anonymous: true }), 1).includes("| Anonymous |"))

    assert.strictEqual(formatDuration(20), "1 min")
    assert.strictEqual(formatDuration(3570), "1 h")
    assert.strictEqual(formatDuration(3 * 86400), "3 days")

    const shopText = formatShop(
      {
        shopid: 1166009254,
        name: "Royal Kludge Official Shop",
        account: { username: "royalkludge_official" },
        is_official_shop: true,
        rating_star: 4.927,
        item_count: 128,
        follower_count: 9830,
        response_rate: 93,
        response_time: 3570,
        ctime: 1705363200,
        last_active_time: 1790684086
      },
      "https://shopee.co.id",
      1790684086 * 1000 + 240 * 1000
    )

    assert.isTrue(shopText.startsWith("🏪 **Royal Kludge Official Shop** [Shopee Mall]"))
    assert.isTrue(shopText.includes("🕒 Last active: 4 min ago"))

    const flash = collectFlashItems([
      {
        url: "https://shopee.co.id/api/v4/flash_sale/flash_sale_batch_get_items",
        postData: "",
        json: { data: { items: [{ itemid: 1, shopid: 1, name: "#1", price: 1 }] } }
      },
      {
        url: "https://shopee.co.id/api/v4/flash_sale/flash_sale_batch_get_items",
        postData: "",
        json: {
          data: {
            items: [
              { itemid: 1, shopid: 1, name: "#1", price: 1 },
              { itemid: 2, shopid: 1, name: "#2", price: 1 }
            ]
          }
        }
      }
    ])

    assert.deepStrictEqual(
      flash.map((x) => x.itemid),
      [1, 2]
    )
    assert.strictEqual(
      flashStockText({ itemid: 1, shopid: 1, name: "x", price: 1, stock: 0, flash_sale_stock: 600 }),
      "🔥 Sold out"
    )
    assert.isTrue(formatTime(1790679600, "Asia/Jakarta").includes("18:00"))
  })
})

describe("Cart, account, voucher, and notification formatters", () => {
  it("formats cart, resolves model option labels, and finds cart items", () => {
    const cartText = formatCart(
      [
        {
          shops: [{ shopid: 1, shopname: "Toko A" }],
          items: [
            {
              itemid: 10,
              shopid: 1,
              modelid: 5,
              name: "Kaos",
              model_name: "Hitam",
              price: 5000000,
              quantity: 2
            }
          ]
        },
        { shops: [{ shopid: 2, shopname: "Empty" }], items: [] }
      ],
      "IDR",
      "https://shopee.co.id"
    )

    assert.isTrue(
      cartText.startsWith("🛒 **Shopee Cart** — 2 items, Rp100 before vouchers & shipping")
    )
    assert.strictEqual(formatCart([], "IDR", "https://shopee.co.id"), "🛒 Your Shopee cart is empty.")

    const item: PdpItem = {
      item_id: 1,
      shop_id: 1,
      title: "t",
      tier_variations: [
        { name: "Warna", options: ["Merah", "Biru"] },
        { name: "Ukuran", options: ["M", "L"] }
      ]
    }

    const model: PdpModel = {
      model_id: 9,
      name: "Biru,L",
      price: 1,
      extinfo: { tier_index: [1, 1] }
    }

    assert.deepStrictEqual(Option.getOrThrow(modelOptionLabels(item, model)), ["Biru", "L"])

    const found = findCartItem(
      [
        {
          items: [
            { itemid: 1, shopid: 9, modelid: 10, name: "A", price: 1, quantity: 1 },
            { itemid: 1, shopid: 9, modelid: 11, name: "A", price: 1, quantity: 2 }
          ]
        }
      ],
      "1"
    )

    assert.isTrue(Option.isNone(found.item))
    assert.strictEqual(found.matches.length, 2)
  })

  it("formats orders, order detail (without PII), vouchers, notifications, and shop vouchers", () => {
    assert.strictEqual(humanizeLabel("label_order_completed"), "Order completed")
    assert.strictEqual(humanizeLabel(undefined), "Unknown")

    const orders = collectOrders([
      {
        url: "x/get_all_order_and_checkout_list",
        postData: "",
        json: { new_data: { order_or_checkout_data: [{ order_list_detail: fakeOrder(1) }] } }
      },
      {
        url: "x/get_order_list",
        postData: "",
        json: { data: { details_list: [fakeOrder(1), fakeOrder(2)] } }
      }
    ])

    assert.deepStrictEqual(
      orders.map((o) => o.info_card?.order_id),
      [1, 2]
    )
    assert.isTrue(formatOrder(fakeOrder(7), 1, "IDR").startsWith("1. **Order `7`** — Completed"))

    const detailOut = formatOrderDetail(
      "9",
      {
        status: { status_label: { text: "label_order_completed" } },
        pc_shipping: {
          fulfilment_carrier: { text: "Anteraja Sameday" },
          forder_shipping_info_list: [
            {
              tracking_number: "TRK1",
              tracking_info_list: [{ ctime: 1788430222, description: "Delivered." }]
            }
          ]
        },
        info_card: { final_total: 58900000000, currency: "IDR", parcel_cards: [] },
        payment_method: { payment_channel_name: { text: "QRIS" } },
        pc_processing_info: {
          order_sn: "SN1",
          create_time: 1788399955,
          complete_time: 1788630439,
          is_rated: false
        }
      },
      "https://shopee.co.id",
      "IDR",
      "Asia/Jakarta"
    )

    assert.isTrue(detailOut.includes("Courier: Anteraja Sameday"))
    assert.isTrue(detailOut.includes("Tracking no.: TRK1"))

    assert.strictEqual(voucherBenefit({ discount_value: 1000000000 }, "IDR"), "Rp10.000 off")
    assert.strictEqual(
      voucherBenefit({ reward_percentage: 10, reward_cap: 2500000 }, "IDR"),
      "10% coins cashback (max 25 coins)"
    )

    const hex = Buffer.from("Toko <b>Blue</b> 👉", "utf8").toString("hex")

    assert.strictEqual(decodeNotificationText(hex), "Toko Blue 👉")

    const notif = formatNotification(
      {
        title: Buffer.from("Confirm Receipt").toString("hex"),
        content: Buffer.from("Rate your items").toString("hex"),
        createtime: 1790679600,
        id_info: { orderid: 243739605230995 }
      },
      2,
      "Asia/Jakarta"
    )

    assert.isTrue(notif.includes("order `243739605230995`"))

    const vouchers = shopVouchersFrom({
      data: {
        decoration: [
          {
            shop_voucher: {
              voucher_list: [
                {
                  promotionid: 1,
                  voucher_code: "A",
                  discount_value: 5390000000,
                  is_claimed_before: true
                }
              ]
            }
          }
        ]
      }
    })

    const svText = formatShopVouchers("9", vouchers, "IDR", "Asia/Jakarta")

    assert.isTrue(svText.includes("**Rp53.900 off** | code `A`"))
    assert.isTrue(svText.includes("✅ claimed"))
  })
})
