import { launchPersistentContext } from "cloakbrowser"
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import type { BrowserContext, Page, Response } from "playwright"
import type { CollectedResponse, JsonValue } from "../api/Schemas.js"
import { AppConfig } from "../Config.js"
import { ShopeeApiError } from "../Errors.js"

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const decodeJsonValue = Schema.decodeUnknownOption(Schema.Json)

export interface CaptureOptions {
  readonly apiMatch: string
  readonly timeoutMs?: number | undefined
}

export interface SelectionOptions {
  readonly apiMatch: string
  readonly selectionApiMatch: string
  readonly labelsFrom: (primary: JsonValue) => ReadonlyArray<string>
  readonly maxSelections?: number | undefined
  readonly deadlineMs?: number | undefined
  readonly timeoutMs?: number | undefined
}

export interface CollectOptions {
  readonly apiMatches: ReadonlyArray<string>
  readonly interact?:
    | ((page: Page, collected: Array<CollectedResponse>) => Promise<void>)
    | undefined
  readonly timeoutMs?: number | undefined
}

export interface BrowserSessionService {
  readonly getContext: (headlessOverride?: boolean) => Effect.Effect<BrowserContext, ShopeeApiError>
  readonly isLoggedIn: Effect.Effect<boolean, ShopeeApiError>
  readonly captureJson: (
    pageUrl: string,
    opts: CaptureOptions
  ) => Effect.Effect<JsonValue, ShopeeApiError>
  readonly captureWithSelections: (
    pageUrl: string,
    opts: SelectionOptions
  ) => Effect.Effect<
    { readonly primary: JsonValue; readonly selections: ReadonlyMap<string, JsonValue> },
    ShopeeApiError
  >
  readonly captureAll: (
    pageUrl: string,
    opts: CollectOptions
  ) => Effect.Effect<ReadonlyArray<CollectedResponse>, ShopeeApiError>
  readonly withPage: <A>(
    label: string,
    fn: (page: Page) => Promise<A>
  ) => Effect.Effect<A, ShopeeApiError>
  readonly close: Effect.Effect<void>
}

const errorMessage = (cause: Error | string): string =>
  cause instanceof Error ? cause.message : cause

/**
 * Poll until `collected` satisfies `done`, or the timeout passes.
 */
export const waitForCollected = async (
  collected: ReadonlyArray<CollectedResponse>,
  done: (c: ReadonlyArray<CollectedResponse>) => boolean,
  timeoutMs: number,
  tick?: () => Promise<void>
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (done(collected)) return true

    if (tick !== undefined) await tick()

    await new Promise((r) => setTimeout(r, 500))
  }

  return done(collected)
}

export class BrowserSession extends Context.Service<BrowserSession, BrowserSessionService>()(
  "shopee-mcp/BrowserSession"
) {
  static readonly layer = Layer.effect(
    BrowserSession,
    Effect.gen(function*() {
      const config = yield* AppConfig
      const semaphore = yield* Semaphore.make(1)
      const contextRef = yield* Ref.make<Option.Option<BrowserContext>>(Option.none())

      const logDebug = (msg: string): Effect.Effect<void> =>
        config.debug ? Effect.logDebug(`[shopee-mcp] ${msg}`) : Effect.void

      const close = Effect.gen(function*() {
        const current = yield* Ref.getAndSet(contextRef, Option.none())

        if (Option.isSome(current)) {
          yield* Effect.tryPromise({
            try: () => current.value.close(),
            catch: () => undefined
          }).pipe(Effect.ignore)
        }
      })

      yield* Effect.addFinalizer(() => close)

      const ensureContext = (
        headlessOverride?: boolean
      ): Effect.Effect<BrowserContext, ShopeeApiError> =>
        Effect.gen(function*() {
          const existing = yield* Ref.get(contextRef)

          if (Option.isSome(existing)) return existing.value

          const headless = headlessOverride ?? config.headless

          yield* logDebug(
            `Launching CloakBrowser (headless=${headless}, locale=${config.locale}, tz=${config.timezone}) with profile: ${config.profileDir}`
          )

          const ctx = yield* Effect.tryPromise({
            try: () =>
              launchPersistentContext({
                userDataDir: config.profileDir,
                headless,
                userAgent: USER_AGENT,
                locale: config.locale,
                timezone: config.timezone,
                viewport: { width: 1366, height: 768 },
                humanize: true,
                args: ["--no-sandbox", "--disable-dev-shm-usage"]
              }),
            catch: (err) =>
              new ShopeeApiError({
                message: `Failed to launch browser: ${errorMessage(err instanceof Error ? err : String(err))}`,
                endpoint: "browser.launch"
              })
          })

          // SAFETY: CloakBrowser wraps Playwright's launchPersistentContext and returns a compatible BrowserContext.
          const typedCtx = ctx as BrowserContext

          yield* Ref.set(contextRef, Option.some(typedCtx))

          return typedCtx
        })

      const getContext = Effect.fn("BrowserSession.getContext")(function*(
        headlessOverride?: boolean
      ) {
        return yield* semaphore.withPermits(1)(ensureContext(headlessOverride))
      })

      const getPageUnsafe = (
        headlessOverride?: boolean
      ): Effect.Effect<Page, ShopeeApiError> =>
        Effect.gen(function*() {
          const ctx = yield* ensureContext(headlessOverride)
          const existing = ctx.pages().find((p) => !p.isClosed())

          if (existing !== undefined) return existing

          return yield* Effect.tryPromise({
            try: () => ctx.newPage(),
            catch: (err) =>
              new ShopeeApiError({
                message: `Failed to open browser page: ${errorMessage(err instanceof Error ? err : String(err))}`,
                endpoint: "browser.newPage"
              })
          })
        })

      const isLoggedIn = semaphore.withPermits(1)(
        Effect.gen(function*() {
          const ctx = yield* ensureContext()

          const cookies = yield* Effect.tryPromise({
            try: () => ctx.cookies(config.baseUrl),
            catch: (err) =>
              new ShopeeApiError({
                message: `Failed to read cookies: ${errorMessage(err instanceof Error ? err : String(err))}`,
                endpoint: "browser.cookies"
              })
          })

          return cookies.some(
            (c) => (c.name === "SPC_U" || c.name === "SPC_EC") && c.value.length > 4
          )
        })
      ).pipe(Effect.withSpan("BrowserSession.isLoggedIn"))

      const captureJson = Effect.fn("BrowserSession.captureJson")(function*(
        pageUrl: string,
        opts: CaptureOptions
      ) {
        const timeoutMs = opts.timeoutMs ?? 60_000

        return yield* semaphore.withPermits(1)(
          Effect.gen(function*() {
            const page = yield* getPageUnsafe()

            return yield* Effect.tryPromise({
              try: async () => {
                let captured: JsonValue | undefined

                const matched = page.waitForResponse(
                  async (r: Response) => {
                    if (!/\/api\/v\d+\//.test(r.url()) || !r.url().includes(opts.apiMatch)) {
                      return false
                    }

                    try {
                      const raw = decodeJsonValue(await r.json())

                      if (Option.isSome(raw)) {
                        captured = raw.value

                        return true
                      }

                      return false
                    } catch {
                      return false
                    }
                  },
                  { timeout: timeoutMs }
                )

                await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs })
                await matched

                return captured ?? null
              },
              catch: (err) =>
                new ShopeeApiError({
                  message: `Browser error loading ${opts.apiMatch}: ${errorMessage(err instanceof Error ? err : String(err))}`,
                  endpoint: opts.apiMatch
                })
            })
          })
        )
      })

      const captureWithSelections = Effect.fn("BrowserSession.captureWithSelections")(function*(
        pageUrl: string,
        opts: SelectionOptions
      ) {
        const timeoutMs = opts.timeoutMs ?? 60_000
        const deadline = Date.now() + (opts.deadlineMs ?? 50_000)

        return yield* semaphore.withPermits(1)(
          Effect.gen(function*() {
            const page = yield* getPageUnsafe()

            return yield* Effect.tryPromise({
              try: async () => {
                const matched = page.waitForResponse(
                  (r: Response) =>
                    r.url().includes("/api/v4/") && r.url().includes(opts.apiMatch),
                  { timeout: timeoutMs }
                )

                await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs })

                const primaryRaw = decodeJsonValue(await (await matched).json())
                const primary: JsonValue = Option.isSome(primaryRaw) ? primaryRaw.value : null
                const selections = new Map<string, JsonValue>()
                const labels = opts.labelsFrom(primary).slice(0, opts.maxSelections ?? 12)

                if (labels.length === 0) return { primary, selections }

                await page
                  .waitForFunction(
                    (ls: ReadonlyArray<string>) =>
                      ls.some((l) =>
                        Array.from(document.querySelectorAll("button")).some(
                          (b) => (b.textContent || "").trim() === l
                        )
                      ),
                    labels,
                    { timeout: 30_000 }
                  )
                  .catch(() => undefined)

                for (const label of labels) {
                  const remaining = deadline - Date.now()

                  if (remaining < 6_000) break

                  const fired = page
                    .waitForResponse(
                      (r: Response) => r.url().includes(opts.selectionApiMatch),
                      { timeout: Math.min(12_000, remaining) }
                    )
                    .catch(() => null)

                  const clicked = await page.evaluate((l: string) => {
                    const b = Array.from(document.querySelectorAll("button")).find(
                      (x) => (x.textContent || "").trim() === l
                    )

                    if (!b) return false

                    b.click()

                    return true
                  }, label)

                  if (!clicked) continue

                  const resp = await fired

                  if (resp === null) continue

                  try {
                    const parsed = decodeJsonValue(await resp.json())

                    if (Option.isSome(parsed)) {
                      selections.set(label, parsed.value)
                    }
                  } catch {
                    // Skip unparsable selection response
                  }
                }

                return { primary, selections }
              },
              catch: (err) =>
                new ShopeeApiError({
                  message: `Browser error loading ${opts.apiMatch}: ${errorMessage(err instanceof Error ? err : String(err))}`,
                  endpoint: opts.apiMatch
                })
            })
          })
        )
      })

      const captureAll = Effect.fn("BrowserSession.captureAll")(function*(
        pageUrl: string,
        opts: CollectOptions
      ) {
        const timeoutMs = opts.timeoutMs ?? 60_000

        return yield* semaphore.withPermits(1)(
          Effect.gen(function*() {
            const page = yield* getPageUnsafe()

            return yield* Effect.tryPromise({
              try: async () => {
                const collected: Array<CollectedResponse> = []
                const pending: Array<Promise<void>> = []

                const onResponse = (r: Response): void => {
                  const url = r.url()

                  if (
                    !/\/api\/v\d+\//.test(url) ||
                    !opts.apiMatches.some((m) => url.includes(m))
                  ) {
                    return
                  }

                  const postData = r.request().postData() ?? ""

                  pending.push(
                    r
                      .json()
                      .then((raw) => {
                        const decoded = decodeJsonValue(raw)

                        if (Option.isSome(decoded)) {
                          collected.push({ url, postData, json: decoded.value })
                        }
                      })
                      .catch(() => undefined)
                  )
                }

                page.on("response", onResponse)

                try {
                  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs })

                  if (opts.interact !== undefined) {
                    await opts.interact(page, collected)
                  }

                  await Promise.all(pending)
                } finally {
                  page.off("response", onResponse)
                }

                return collected
              },
              catch: (err) =>
                new ShopeeApiError({
                  message: `Browser error loading ${opts.apiMatches[0] ?? pageUrl}: ${errorMessage(err instanceof Error ? err : String(err))}`,
                  endpoint: opts.apiMatches[0] ?? pageUrl
                })
            })
          })
        )
      })

      const withPage = <A>(
        label: string,
        fn: (page: Page) => Promise<A>
      ): Effect.Effect<A, ShopeeApiError> =>
        semaphore.withPermits(1)(
          Effect.gen(function*() {
            const page = yield* getPageUnsafe()

            return yield* Effect.tryPromise({
              try: () => fn(page),
              catch: (err) =>
                new ShopeeApiError({
                  message: errorMessage(err instanceof Error ? err : String(err)),
                  endpoint: label
                })
            })
          })
        )

      return BrowserSession.of({
        getContext,
        isLoggedIn,
        captureJson,
        captureWithSelections,
        captureAll,
        withPage,
        close
      })
    })
  )
}
