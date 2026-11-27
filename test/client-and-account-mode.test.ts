import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect, Exit, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AccountMode } from "../src/AccountMode.js"
import type { JsonValue } from "../src/api/Schemas.js"
import { ShopeeClient } from "../src/api/ShopeeClient.js"
import { BrowserSession } from "../src/browser/BrowserSession.js"
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

describe("ShopeeClient capture retry, auth fast-fail, and TTL cache", () => {
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

  it.effect("caches text with TTL expiration and does not pin failures", () =>
    Effect.gen(function*() {
      let calls = 0

      const browserLayer = makeBrowserStub({
        isLoggedIn: Effect.succeed(true),
        captureJson: () => Effect.succeed({})
      })

      yield* Effect.gen(function*() {
        const client = yield* ShopeeClient

        const first = yield* client.cachedText(
          "k1",
          Effect.sync(() => `v${++calls}`)
        )

        const second = yield* client.cachedText(
          "k1",
          Effect.sync(() => `v${++calls}`)
        )

        assert.strictEqual(first, "v1")
        assert.strictEqual(second, "v1")
        assert.strictEqual(calls, 1)

        yield* TestClock.adjust("2 seconds")

        const third = yield* client.cachedText(
          "k1",
          Effect.sync(() => `v${++calls}`)
        )

        assert.strictEqual(third, "v2")

        const failed = yield* Effect.exit(
          client.cachedText("k2", Effect.fail(new ShopeeApiError({ message: "boom" })))
        )

        assert.isTrue(Exit.isFailure(failed))

        const recovered = yield* client.cachedText("k2", Effect.succeed("ok"))

        assert.strictEqual(recovered, "ok")
      }).pipe(
        Effect.provide(ShopeeClient.layer),
        Effect.provide(browserLayer),
        Effect.provide(AppConfig.layerTest({ cacheTtl: Duration.seconds(1) }))
      )
    }))
})

describe("AccountMode", () => {
  it.effect("starts inactive, activates on login, and falls back on check failure", () =>
    Effect.gen(function*() {
      const mode = yield* AccountMode

      assert.strictEqual(yield* mode.isActive, false)

      yield* mode.refresh(Effect.succeed(true))

      assert.strictEqual(yield* mode.isActive, true)

      yield* mode.refresh(Effect.fail(new Error("browser died")))

      assert.strictEqual(yield* mode.isActive, false)
    }).pipe(Effect.provide(AccountMode.layer), Effect.provide(AppConfig.layerTest())))

  it.effect("stays inactive when accountTools is off", () =>
    Effect.gen(function*() {
      const mode = yield* AccountMode

      yield* mode.setLoggedIn(true)

      assert.strictEqual(yield* mode.isActive, false)
    }).pipe(
      Effect.provide(AccountMode.layer),
      Effect.provide(AppConfig.layerTest({ accountTools: "off" }))
    ))
})
