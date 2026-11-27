import { Cache, Context, Duration, Effect, Exit, Layer, Option, Schema } from "effect"
import type { Page } from "playwright"
import {
  BrowserSession,
  type CollectOptions,
  type SelectionOptions
} from "../browser/BrowserSession.js"
import { AppConfig } from "../Config.js"
import {
  SHOPEE_ANTIBOT_ERROR,
  ShopeeApiError,
  ShopeeAuthRequiredError,
  type ShopeeError
} from "../Errors.js"
import { ApiErrorEnvelope, type CollectedResponse, type JsonValue } from "./Schemas.js"

const decodeErrorEnvelope = Schema.decodeUnknownOption(ApiErrorEnvelope)

export interface ShopeeCaptureOptions {
  readonly timeoutMs?: number | undefined
  readonly allowAnonymous?: boolean | undefined
}

export interface ShopeeClientService {
  readonly shopeeUrl: (pathAndQuery: string) => string
  readonly isLoggedIn: Effect.Effect<boolean, ShopeeApiError>
  readonly requireLogin: Effect.Effect<void, ShopeeError>
  readonly capture: <A, I>(
    pageUrl: string,
    apiMatch: string,
    schema: Schema.Codec<A, I>,
    options?: ShopeeCaptureOptions
  ) => Effect.Effect<A, ShopeeError>
  readonly captureWithSelections: (
    pageUrl: string,
    opts: SelectionOptions
  ) => Effect.Effect<
    { readonly primary: JsonValue; readonly selections: ReadonlyMap<string, JsonValue> },
    ShopeeError
  >
  readonly captureAll: (
    pageUrl: string,
    opts: CollectOptions
  ) => Effect.Effect<ReadonlyArray<CollectedResponse>, ShopeeError>
  readonly withPage: <A>(
    label: string,
    fn: (page: Page) => Promise<A>
  ) => Effect.Effect<A, ShopeeApiError>
  readonly cachedText: (
    key: string,
    compute: Effect.Effect<string, ShopeeError>
  ) => Effect.Effect<string, ShopeeError>
  readonly clearCache: Effect.Effect<void>
}

export class ShopeeClient extends Context.Service<ShopeeClient, ShopeeClientService>()(
  "shopee-mcp/ShopeeClient"
) {
  static readonly layer = Layer.effect(
    ShopeeClient,
    Effect.gen(function*() {
      const config = yield* AppConfig
      const browser = yield* BrowserSession

      const shopeeUrl = (pathAndQuery: string): string =>
        `${config.baseUrl}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`

      const requireLogin: Effect.Effect<void, ShopeeError> = Effect.gen(function*() {
        const loggedIn = yield* browser.isLoggedIn

        if (!loggedIn) {
          return yield* new ShopeeAuthRequiredError({})
        }
      })

      const captureOnce = (
        pageUrl: string,
        apiMatch: string,
        timeoutMs: number | undefined,
        allowAnonymous: boolean,
        isRetry: boolean
      ): Effect.Effect<JsonValue, ShopeeError> =>
        Effect.gen(function*() {
          if (!allowAnonymous && !isRetry) {
            const loggedIn = yield* browser.isLoggedIn

            if (!loggedIn) {
              return yield* new ShopeeAuthRequiredError({ endpoint: apiMatch })
            }
          }

          const json = yield* browser.captureJson(pageUrl, { apiMatch, timeoutMs }).pipe(
            Effect.catchTag("ShopeeApiError", (err) => {
              if (!/timeout/i.test(err.message)) {
                return Effect.fail(err)
              }

              if (!isRetry) {
                if (allowAnonymous) {
                  return captureOnce(pageUrl, apiMatch, timeoutMs, true, true)
                }

                return browser.isLoggedIn.pipe(
                  Effect.flatMap((stillLoggedIn) =>
                    stillLoggedIn
                      ? captureOnce(pageUrl, apiMatch, timeoutMs, false, true)
                      : Effect.fail(new ShopeeAuthRequiredError({ endpoint: apiMatch }))
                  )
                )
              }

              return Effect.fail(new ShopeeAuthRequiredError({ endpoint: apiMatch }))
            })
          )

          const envelope = decodeErrorEnvelope(json)

          if (Option.isSome(envelope)) {
            const code = envelope.value.error

            if (code === SHOPEE_ANTIBOT_ERROR) {
              return yield* new ShopeeAuthRequiredError({ endpoint: apiMatch })
            }

            if (code !== undefined && code !== null && code !== 0) {
              const msg = envelope.value.error_msg

              return yield* new ShopeeApiError({
                message: `Shopee API error ${code}${msg ? `: ${msg}` : ""} for ${apiMatch}`,
                statusCode: 200,
                endpoint: apiMatch,
                shopeeError: code
              })
            }
          }

          return json
        })

      const capture = <A, I>(
        pageUrl: string,
        apiMatch: string,
        schema: Schema.Codec<A, I>,
        options: ShopeeCaptureOptions = {}
      ): Effect.Effect<A, ShopeeError> =>
        Effect.gen(function*() {
          const json = yield* captureOnce(
            pageUrl,
            apiMatch,
            options.timeoutMs,
            options.allowAnonymous ?? false,
            false
          )

          return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
            Effect.mapError(
              (err) =>
                new ShopeeApiError({
                  message: `Unexpected Shopee response for ${apiMatch}: ${err.message}`,
                  endpoint: apiMatch
                })
            )
          )
        }).pipe(Effect.withSpan(`ShopeeClient.capture.${apiMatch}`))

      const captureWithSelections = Effect.fn("ShopeeClient.captureWithSelections")(function*(
        pageUrl: string,
        opts: SelectionOptions
      ) {
        yield* requireLogin

        return yield* browser.captureWithSelections(pageUrl, opts)
      })

      const captureAll = Effect.fn("ShopeeClient.captureAll")(function*(
        pageUrl: string,
        opts: CollectOptions
      ) {
        yield* requireLogin

        return yield* browser.captureAll(pageUrl, opts)
      })

      const pendingComputes = new Map<string, Effect.Effect<string, ShopeeError>>()

      const textCache = yield* Cache.makeWith(
        (key: string): Effect.Effect<string, ShopeeError> => {
          const compute = pendingComputes.get(key)

          if (compute === undefined) {
            return Effect.fail(new ShopeeApiError({ message: `Cache miss without compute for ${key}` }))
          }

          return compute.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                pendingComputes.delete(key)
              })
            )
          )
        },
        {
          capacity: 200,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? config.cacheTtl : Duration.zero)
        }
      )

      const cachedText = (
        key: string,
        compute: Effect.Effect<string, ShopeeError>
      ): Effect.Effect<string, ShopeeError> =>
        Effect.suspend(() => {
          if (!pendingComputes.has(key)) {
            pendingComputes.set(key, compute)
          }

          return Cache.get(textCache, key)
        })

      const clearCache = Cache.invalidateAll(textCache)

      return ShopeeClient.of({
        shopeeUrl,
        isLoggedIn: browser.isLoggedIn,
        requireLogin,
        capture,
        captureWithSelections,
        captureAll,
        withPage: browser.withPage,
        cachedText,
        clearCache
      })
    })
  )
}
