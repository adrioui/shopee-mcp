import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AccountMode } from "../src/AccountMode.js"
import type { CollectedResponse, JsonValue } from "../src/api/Schemas.js"
import { ShopeeClient } from "../src/api/ShopeeClient.js"
import { BrowserSession, waitForCollected } from "../src/browser/BrowserSession.js"
import { AppConfig } from "../src/Config.js"
import { ShopeeApiError } from "../src/Errors.js"

const SimpleResponse = Schema.Struct({
  error: Schema.optional(Schema.Number),
  items: Schema.Array(Schema.String)
})

const makeBrowserStub = (opts: {
  readonly isLoggedIn: Effect.Effect<boolean, ShopeeApiError>
  readonly captureJson: (url: string, apiMatch: string) => Effect.Effect<JsonValue, ShopeeApiError>
}) =>
  Layer.succeed(
    BrowserSession,
    BrowserSession.of({
      getContext: () => Effect.fail(new ShopeeApiError({ message: "unused" })),
      isLoggedIn: opts.isLoggedIn,
      captureJson: (url, captureOpts) => opts.captureJson(url, captureOpts.apiMatch),
      captureWithSelections: () => Effect.fail(new ShopeeApiError({ message: "unused" })),
      captureAll: () => Effect.succeed([]),
      withPage: () => Effect.fail(new ShopeeApiError({ message: "unused" })),
      close: Effect.void
    })
  )

describe("waitForCollected (Effect Schedule + TestClock)", () => {
  it.effect("polls with Schedule.spaced and resolves once condition holds", () =>
    Effect.gen(function*() {
      const collected: Array<CollectedResponse> = []
      let ticks = 0

      const fiber = yield* Effect.forkChild(
        waitForCollected(
          collected,
          (c) => c.length >= 1,
          "5 seconds",
          Effect.sync(() => {
            ticks++

            if (ticks === 2) {
              collected.push({ url: "api/v4/test", postData: "", json: {} })
            }
          })
        )
      )

      yield* TestClock.adjust("2 seconds")

      const ok = yield* Fiber.join(fiber)

      assert.isTrue(ok)
      assert.strictEqual(ticks, 2)
    }))

  it.effect("returns false when timeout expires without satisfying condition", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(waitForCollected([], () => false, "1 second"))

      yield* TestClock.adjust("2 seconds")

      const ok = yield* Fiber.join(fiber)

      assert.isFalse(ok)
    }))
})

describe("ShopeeClient capture retry, auth fast-fail, and typed Cache.makeWith", () => {
  it.effect("recovers from a single timeout via retry when logged in", () =>
    Effect.gen(function*() {
      let calls = 0

      const browserLayer = makeBrowserStub({
        isLoggedIn: Effect.succeed(true),
        captureJson: () =>
          Effect.suspend(() => {
            calls++

            if (calls === 1) {
              return Effect.fail(new ShopeeApiError({ message: "Timeout 30000ms exceeded" }))
            }

            return Effect.succeed({ error: 0, items: ["ok"] })
          })
      })

      const res = yield* Effect.gen(function*() {
        const client = yield* ShopeeClient

        return yield* client.capture("https://x", "search/search_items", SimpleResponse)
      }).pipe(
        Effect.provide(ShopeeClient.layer),
        Effect.provide(browserLayer),
        Effect.provide(AppConfig.layerTest())
      )

      assert.strictEqual(calls, 2)
      assert.deepStrictEqual(res, { error: 0, items: ["ok"] })
    }))

  it.effect("fails fast with ShopeeAuthRequiredError when signed out without calling capture", () =>
    Effect.gen(function*() {
      let calls = 0

      const browserLayer = makeBrowserStub({
        isLoggedIn: Effect.succeed(false),
        captureJson: () =>
          Effect.sync(() => {
            calls++

            return { error: 0, items: [] }
          })
      })

      const exit = yield* Effect.gen(function*() {
        const client = yield* ShopeeClient

        return yield* Effect.exit(client.capture("https://x", "search/search_items", SimpleResponse))
      }).pipe(
        Effect.provide(ShopeeClient.layer),
        Effect.provide(browserLayer),
        Effect.provide(AppConfig.layerTest())
      )

      assert.isTrue(Exit.isFailure(exit))
      assert.strictEqual(calls, 0)
    }))

  it.effect("skips retry when session lapses mid-request", () =>
    Effect.gen(function*() {
      let calls = 0
      let checks = 0

      const browserLayer = makeBrowserStub({
        isLoggedIn: Effect.sync(() => ++checks === 1),
        captureJson: () =>
          Effect.suspend(() => {
            calls++

            return Effect.fail(new ShopeeApiError({ message: "Timeout 60000ms exceeded" }))
          })
      })

      const exit = yield* Effect.gen(function*() {
        const client = yield* ShopeeClient

        return yield* Effect.exit(client.capture("https://x", "search/search_items", SimpleResponse))
      }).pipe(
        Effect.provide(ShopeeClient.layer),
        Effect.provide(browserLayer),
        Effect.provide(AppConfig.layerTest())
      )

      assert.isTrue(Exit.isFailure(exit))
      assert.strictEqual(calls, 1)
    }))

  it.effect("caches searchItems via Cache.makeWith with TTL expiration and does not pin failures", () =>
    Effect.gen(function*() {
      let calls = 0

      const browserLayer = makeBrowserStub({
        isLoggedIn: Effect.succeed(true),
        captureJson: (url) =>
          Effect.suspend(() => {
            calls++

            if (url.includes("fail-once") && calls === 3) {
              return Effect.fail(new ShopeeApiError({ message: "boom" }))
            }

            return Effect.succeed({ error: 0, total_count: calls, nomore: true, items: [] })
          })
      })

      yield* Effect.gen(function*() {
        const client = yield* ShopeeClient

        const first = yield* client.searchItems("/search?keyword=bike")
        const second = yield* client.searchItems("/search?keyword=bike")

        assert.strictEqual(first.total_count, 1)
        assert.strictEqual(second.total_count, 1)
        assert.strictEqual(calls, 1)

        yield* TestClock.adjust("2 seconds")

        const third = yield* client.searchItems("/search?keyword=bike")

        assert.strictEqual(third.total_count, 2)

        const failed = yield* Effect.exit(client.searchItems("/search?keyword=fail-once"))

        assert.isTrue(Exit.isFailure(failed))

        const recovered = yield* client.searchItems("/search?keyword=fail-once")

        assert.strictEqual(recovered.total_count, 4)
      }).pipe(
        Effect.provide(ShopeeClient.layer),
        Effect.provide(browserLayer),
        Effect.provide(AppConfig.layerTest({ cacheTtl: Duration.seconds(1) }))
      )
    }))
})

describe("AccountMode", () => {
  it.effect("starts inactive and stays inactive by default (read-only)", () =>
    Effect.gen(function*() {
      const mode = yield* AccountMode

      yield* mode.setLoggedIn(true)

      assert.strictEqual(yield* mode.isActive, false)
    }).pipe(Effect.provide(AccountMode.layer), Effect.provide(AppConfig.layerTest())))

  it.effect("activates on login when accountTools is auto and falls back on check failure", () =>
    Effect.gen(function*() {
      const mode = yield* AccountMode

      assert.strictEqual(yield* mode.isActive, false)

      yield* mode.refresh(Effect.succeed(true))

      assert.strictEqual(yield* mode.isActive, true)

      yield* mode.refresh(Effect.fail(new Error("browser died")))

      assert.strictEqual(yield* mode.isActive, false)
    }).pipe(
      Effect.provide(AccountMode.layer),
      Effect.provide(AppConfig.layerTest({ accountTools: "auto" }))
    ))
})
