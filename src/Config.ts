import { Config, Context, Duration, Effect, Layer } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface Region {
  readonly locale: string
  readonly timezone: string
  readonly currency: string
}

export type AccountToolsSetting = "auto" | "off"

const REGION_ENTRIES: ReadonlyArray<readonly [string, Region]> = [
  [".id", { locale: "id-ID", timezone: "Asia/Jakarta", currency: "IDR" }],
  [".my", { locale: "en-MY", timezone: "Asia/Kuala_Lumpur", currency: "MYR" }],
  [".sg", { locale: "en-SG", timezone: "Asia/Singapore", currency: "SGD" }],
  [".tw", { locale: "zh-TW", timezone: "Asia/Taipei", currency: "TWD" }]
]

const FALLBACK_REGION: Region = REGION_ENTRIES[0][1]

/** Region defaults for a Shopee domain, chosen by its TLD suffix. */
export const regionFor = (domain: string): Region => {
  const found = REGION_ENTRIES.find(([suffix]) => domain.endsWith(suffix))

  return found !== undefined ? found[1] : FALLBACK_REGION
}

/** Read-only by default; opt in with "auto", "on", "true", or "1". */
export const parseAccountToolsSetting = (raw?: string): AccountToolsSetting => {
  const v = (raw ?? "").trim().toLowerCase()

  return v === "auto" || v === "on" || v === "true" || v === "1" ? "auto" : "off"
}

const BROWSER_CANDIDATES: ReadonlyArray<string> = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "helium"
]

export const findSystemChromium = (pathEnv: string | undefined = process.env["PATH"]): string | undefined => {
  if (pathEnv === undefined || pathEnv === "") return undefined

  const dirs = pathEnv.split(path.delimiter).filter((d) => d !== "")

  for (const bin of BROWSER_CANDIDATES) {
    for (const dir of dirs) {
      const candidate = path.join(dir, bin)

      try {
        fs.accessSync(candidate, fs.constants.X_OK)

        return candidate
      } catch {
        // Not executable here; keep scanning
      }
    }
  }

  return undefined
}

const stringConfig = (name: string, fallback: string): Effect.Effect<string> =>
  Effect.gen(function*() {
    const value = yield* Config.String(name)

    return value.trim() !== "" ? value.trim() : fallback
  }).pipe(Effect.orElseSucceed(() => fallback))

const optionalStringConfig = (name: string): Effect.Effect<string | undefined> =>
  Effect.gen(function*() {
    const value = yield* Config.String(name)
    const trimmed = value.trim()

    return trimmed !== "" ? trimmed : undefined
  }).pipe(Effect.orElseSucceed(() => undefined))

const positiveIntConfig = (name: string, fallback: number): Effect.Effect<number> =>
  Effect.gen(function*() {
    const n = yield* Config.Int(name)

    return Number.isFinite(n) && n > 0 ? n : fallback
  }).pipe(Effect.orElseSucceed(() => fallback))

const booleanConfig = (name: string, fallback: boolean): Effect.Effect<boolean> =>
  Effect.gen(function*() {
    return yield* Config.Boolean(name)
  }).pipe(Effect.orElseSucceed(() => fallback))

export interface AppConfigValue {
  readonly domain: string
  readonly baseUrl: string
  readonly locale: string
  readonly timezone: string
  readonly currency: string
  readonly profileDir: string
  readonly executablePath: string | undefined
  readonly headless: boolean
  readonly accountTools: AccountToolsSetting
  readonly cacheTtl: Duration.Duration
  readonly debug: boolean
}

export const makeAppConfigValue = (overrides: Partial<AppConfigValue> = {}): AppConfigValue => {
  const domain = overrides.domain ?? "shopee.co.id"
  const region = regionFor(domain)

  return {
    domain,
    baseUrl: overrides.baseUrl ?? `https://${domain}`,
    locale: overrides.locale ?? region.locale,
    timezone: overrides.timezone ?? region.timezone,
    currency: overrides.currency ?? region.currency,
    profileDir:
      overrides.profileDir ?? path.join(os.homedir(), ".shopee-mcp", "chrome-profile"),
    executablePath: overrides.executablePath,
    headless: overrides.headless ?? false,
    accountTools: overrides.accountTools ?? "off",
    cacheTtl: overrides.cacheTtl ?? Duration.millis(30_000),
    debug: overrides.debug ?? false
  }
}

export class AppConfig extends Context.Service<AppConfig, AppConfigValue>()("shopee-mcp/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function*() {
      const domain = yield* stringConfig("SHOPEE_DOMAIN", "shopee.co.id")
      const region = regionFor(domain)
      const locale = yield* stringConfig("SHOPEE_LOCALE", region.locale)
      const timezone = yield* stringConfig("SHOPEE_TIMEZONE", region.timezone)
      const defaultProfile = path.join(os.homedir(), ".shopee-mcp", "chrome-profile")
      const profileDir = yield* stringConfig("SHOPEE_PROFILE_DIR", defaultProfile)
      const explicitExecutable = yield* optionalStringConfig("SHOPEE_EXECUTABLE_PATH")
      const executablePath = explicitExecutable ?? findSystemChromium()
      const headless = yield* booleanConfig("SHOPEE_HEADLESS", false)
      const rawAccountTools = yield* stringConfig("SHOPEE_ACCOUNT_TOOLS", "off")
      const cacheTtlMs = yield* positiveIntConfig("CACHE_TTL_MS", 30_000)
      const debug = yield* booleanConfig("DEBUG", false)

      return AppConfig.of({
        domain,
        baseUrl: `https://${domain}`,
        locale,
        timezone,
        currency: region.currency,
        profileDir,
        executablePath,
        headless,
        accountTools: parseAccountToolsSetting(rawAccountTools),
        cacheTtl: Duration.millis(cacheTtlMs),
        debug
      })
    })
  )

  static readonly layerTest = (overrides: Partial<AppConfigValue> = {}) =>
    Layer.succeed(AppConfig, AppConfig.of(makeAppConfigValue(overrides)))
}
