/**
 * Live smoke test / health check using Effect's McpClient over stdio.
 *
 * Run with: pnpm run test:smoke
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Layer, Predicate, Result } from "effect"
import { McpClient, McpProtocol } from "effect/ai"
import { ChildProcess } from "effect/process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { JsonObject } from "../src/api/Schemas.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const tsxBin = resolve(__dirname, "../node_modules/.bin/tsx")
const serverEntry = resolve(__dirname, "../src/index.ts")

const HARD_FAILURES = [
  "❌ Error:",
  "Shopee API Error",
  "Unknown error occurred",
  "Invalid JSON",
  "Browser error"
] as const

interface Check {
  readonly tool: string
  readonly account?: boolean
  readonly args: JsonObject | (() => JsonObject)
  readonly expect: ReadonlyArray<string>
  readonly capture?: (text: string) => void
}

let discovered: { readonly shopId: string; readonly itemId: string } | null = null

const PLACEHOLDER: JsonObject = { shopId: "1", itemId: "1" }

const CHECKS: ReadonlyArray<Check> = [
  {
    tool: "search_products",
    args: { query: "laptop", limit: 3 },
    expect: ["Search Results", "No products found", "Not signed in to Shopee"],
    capture: (text) => {
      const m = text.match(/\/product\/(\d+)\/(\d+)/)

      if (m !== null) discovered = { shopId: m[1], itemId: m[2] }
    }
  },
  {
    tool: "get_product_detail",
    args: () => discovered ?? PLACEHOLDER,
    expect: ["Price:", "Could not read product", "Not signed in to Shopee"]
  },
  {
    tool: "get_product_variants",
    args: () => discovered ?? PLACEHOLDER,
    expect: ["variant", "Could not read product", "Not signed in to Shopee"]
  },
  {
    tool: "get_product_reviews",
    args: () => discovered ?? PLACEHOLDER,
    expect: ["Reviews", "Not signed in to Shopee"]
  },
  {
    tool: "get_shop_info",
    args: () =>
      discovered !== null
        ? { shopId: discovered.shopId }
        : { username: "royalkludge_official" },
    expect: ["Shop ID", "Could not read shop", "Not signed in to Shopee"]
  },
  {
    tool: "get_shop_products",
    args: () => ({ shopId: (discovered ?? { shopId: "1166009254" }).shopId, limit: 3 }),
    expect: ["Products from shop", "No products found", "Not signed in to Shopee"]
  },
  {
    tool: "get_flash_sale",
    args: { limit: 3 },
    expect: ["Flash Sale", "Not signed in to Shopee"]
  },
  {
    tool: "check_login_status",
    args: {},
    expect: ["Logged in to", "Not logged in to"]
  },
  { tool: "get_orders", account: true, args: { limit: 2 }, expect: ["Your orders", "No orders"] },
  { tool: "get_cart", account: true, args: {}, expect: ["Shopee Cart", "cart is empty"] },
  {
    tool: "get_my_vouchers",
    account: true,
    args: { limit: 2 },
    expect: ["Your vouchers", "wallet is empty"]
  },
  { tool: "get_coins", account: true, args: {}, expect: ["Shopee Coins"] },
  {
    tool: "get_notifications",
    account: true,
    args: { limit: 2 },
    expect: ["notifications"]
  }
]

const ClientLayer = McpClient.layerStdio({
  name: "smoke-test",
  version: "1.0.0",
  protocol: McpProtocol.v2025_11_25,
  command: ChildProcess.make(tsxBin, [serverEntry])
}).pipe(Layer.provide(NodeServices.layer))

const program = Effect.gen(function*() {
  const client = yield* McpClient.McpClient
  const tools = yield* client.listTools()
  const offered = new Set(tools.map((t) => t.name))

  yield* Console.log(
    `\n🔌 Connected. Server exposes ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}\n`
  )

  let failures = 0

  for (const check of CHECKS) {
    if (check.account && !offered.has(check.tool)) {
      yield* Console.log(`⏭  ${check.tool.padEnd(20)} skipped (account mode off — signed out)`)
      continue
    }

    const tool = tools.find((t) => t.name === check.tool)

    if (tool === undefined) {
      failures++

      yield* Console.log(`❌ ${check.tool.padEnd(20)} tool not registered`)
      continue
    }

    const args = Predicate.isFunction(check.args) ? check.args() : check.args
    const res = yield* client.callTool({ tool, arguments: args }).pipe(Effect.result)

    let status: "PASS" | "FAIL" = "FAIL"
    let note: string

    if (Result.isFailure(res)) {
      note = `error: ${res.failure.message}`
    } else {
      const text = res.success.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n")

      check.capture?.(text)

      const hardFail = HARD_FAILURES.find((m) => text.includes(m))

      if (hardFail !== undefined) {
        note = `hard failure: "${hardFail}" — ${text.slice(0, 100).replace(/\n/g, " ")}`
      } else if (check.expect.some((m) => text.toLowerCase().includes(m.toLowerCase()))) {
        status = "PASS"
        note = text.includes("Not signed in")
          ? "login prompt (pipeline OK, no session)"
          : "returned data"
      } else {
        note = `unexpected — got: ${text.slice(0, 100).replace(/\n/g, " ")}`
      }
    }

    if (status === "FAIL") failures++

    yield* Console.log(`${status === "PASS" ? "✅" : "❌"} ${check.tool.padEnd(20)} ${note}`)
  }

  yield* Console.log(
    `\n${failures === 0 ? "✅ All checks passed" : `❌ ${failures} check(s) failed`}\n`
  )

  if (failures > 0) {
    return yield* Effect.fail(new Error(`${failures} smoke check(s) failed`))
  }
}).pipe(Effect.provide(ClientLayer))

NodeRuntime.runMain(program)
