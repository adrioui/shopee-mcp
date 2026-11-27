import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { McpProtocol, McpTest } from "effect/ai"
import { AccountMode } from "../src/AccountMode.js"
import { ShopeeClient } from "../src/api/ShopeeClient.js"
import { BrowserSession } from "../src/browser/BrowserSession.js"
import { AppConfig } from "../src/Config.js"
import { ShopeeApiError } from "../src/Errors.js"
import { ShopeeRegistrations } from "../src/tools/Handlers.js"

const StubBrowserLayer = Layer.succeed(
  BrowserSession,
  BrowserSession.of({
    getContext: () => Effect.fail(new ShopeeApiError({ message: "unused" })),
    isLoggedIn: Effect.succeed(true),
    captureJson: () =>
      Effect.succeed({
        error: 0,
        total_count: 1,
        nomore: true,
        items: [
          {
            itemid: 42,
            shopid: 7,
            item_basic: {
              itemid: 42,
              shopid: 7,
              name: "KMC S1 Chain",
              price: 12000000000,
              price_min: 12000000000,
              price_max: 12000000000,
              price_before_discount: 0,
              currency: "IDR",
              stock: 5,
              sold: 10,
              historical_sold: 10,
              liked_count: 1,
              item_rating: { rating_star: 4.9, rating_count: [] },
              shop_location: "Jakarta",
              is_official_shop: true,
              shopee_verified: true,
              image: ""
            }
          }
        ]
      }),
    captureWithSelections: () => Effect.fail(new ShopeeApiError({ message: "unused" })),
    captureAll: () => Effect.succeed([]),
    withPage: () => Effect.fail(new ShopeeApiError({ message: "unused" })),
    close: Effect.void
  })
)

const makeTestServices = (accountTools: "auto" | "off") =>
  Layer.mergeAll(AccountMode.layer, ShopeeClient.layer).pipe(
    Layer.provideMerge(StubBrowserLayer),
    Layer.provideMerge(AppConfig.layerTest({ accountTools }))
  )

describe("Shopee MCP Server integration (McpTest + visibility)", () => {
  it.effect("stays read-only (8 tools) by default even after check_login_status succeeds", () =>
    Effect.gen(function*() {
      const client = yield* McpTest.makeClient(
        ShopeeRegistrations.pipe(Layer.provide(makeTestServices("off"))),
        {
          protocols: [McpProtocol.v2025_11_25]
        }
      )

      yield* client.callTool({ name: "check_login_status", arguments: {} })

      const listed = yield* client.listTools()

      assert.strictEqual(listed.tools.length, 8)
      assert.isFalse(listed.tools.some((t) => t.name === "get_cart"))
    }).pipe(Effect.scoped))

  it.effect("exposes all 20 tools once check_login_status succeeds when accountTools is auto", () =>
    Effect.gen(function*() {
      const client = yield* McpTest.makeClient(
        ShopeeRegistrations.pipe(Layer.provide(makeTestServices("auto"))),
        {
          protocols: [McpProtocol.v2025_11_25]
        }
      )

      const initial = yield* client.listTools()

      assert.strictEqual(initial.tools.length, 8)
      assert.isFalse(initial.tools.some((t) => t.name === "get_cart"))

      const statusRes = yield* client.callTool({
        name: "check_login_status",
        arguments: {}
      })

      const statusText = statusRes.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n")

      assert.isTrue(statusText.includes("Logged in to shopee.co.id"))

      const afterLogin = yield* client.listTools()

      assert.strictEqual(afterLogin.tools.length, 20)
      assert.isTrue(afterLogin.tools.some((t) => t.name === "get_cart"))

      const searchRes = yield* client.callTool({
        name: "search_products",
        arguments: { query: "kmc", limit: 3 }
      })

      const searchText = searchRes.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n")

      assert.isTrue(searchText.includes("KMC S1 Chain"))
      assert.isTrue(searchText.includes("Rp120.000"))
    }).pipe(Effect.scoped))
})
