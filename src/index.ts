#!/usr/bin/env node
import { NodeRuntime, NodeStdio } from "@effect/platform-node"
import { Effect, Layer, Logger, Option, Schema } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { AccountMode } from "./AccountMode.js"
import { ShopeeClient } from "./api/ShopeeClient.js"
import { BrowserSession } from "./browser/BrowserSession.js"
import { AppConfig } from "./Config.js"
import { ShopeeRegistrations } from "./tools/Handlers.js"

const PackageVersionSchema = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.optional(Schema.String)
  })
)

const readServerVersion = (): string => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../package.json")
    const parsed = Schema.decodeUnknownOption(PackageVersionSchema)(readFileSync(pkgPath, "utf8"))

    return Option.isSome(parsed) ? (parsed.value.version ?? "0.0.0") : "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const StartupLayer = Layer.effectDiscard(
  Effect.gen(function*() {
    const config = yield* AppConfig
    const mode = yield* AccountMode
    const client = yield* ShopeeClient

    if (config.debug) {
      yield* Effect.logInfo(
        "[shopee-mcp] Server started via stdio (browser-backed discovery)"
      )
    }

    if (config.accountTools === "auto") {
      yield* Effect.forkScoped(mode.refresh(client.isLoggedIn))
    }
  })
)

const ServicesLayer = Layer.mergeAll(AccountMode.layer, ShopeeClient.layer).pipe(
  Layer.provideMerge(BrowserSession.layer),
  Layer.provideMerge(AppConfig.layer)
)

const ServerLayer = Layer.mergeAll(
  StartupLayer,
  McpServer.layerStdio({
    name: "shopee-mcp",
    version: readServerVersion(),
    protocols: [
      McpProtocol.v2025_11_25,
      McpProtocol.v2025_06_18,
      McpProtocol.v2025_03_26,
      McpProtocol.v2024_11_05
    ],
    registrations: ShopeeRegistrations
  })
).pipe(
  Layer.provide(ServicesLayer),
  Layer.provide(NodeStdio.layer),
  Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true))
)

Layer.launch(ServerLayer).pipe(NodeRuntime.runMain)
