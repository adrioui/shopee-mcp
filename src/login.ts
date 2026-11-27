#!/usr/bin/env node
/**
 * One-time Shopee login.
 *
 * Opens a visible Chromium window bound to the persistent profile, lets you sign
 * in by hand (password, OTP, whatever Shopee asks), then saves the session so the
 * MCP server can reuse it. Run once; re-run only if the session expires.
 *
 *   pnpm run login        (dev)   or   shopee-mcp-login   (installed)
 */
import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import readline from "node:readline"
import { BrowserSession } from "./browser/BrowserSession.js"
import { AppConfig } from "./Config.js"

const promptLine = (question: string): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

    rl.question(question, () => {
      rl.close()
      resume(Effect.void)
    })

    return Effect.sync(() => {
      rl.close()
    })
  })

const program = Effect.gen(function*() {
  const config = yield* AppConfig
  const browser = yield* BrowserSession
  const verifyMode = process.argv.includes("--verify")

  yield* Console.log("\n🛒 Shopee MCP — login\n")
  yield* Console.log(`Profile directory: ${config.profileDir}`)
  yield* Console.log("Opening a Chromium window…\n")

  const ctx = yield* browser.getContext(false)
  const existing = ctx.pages().find((p) => !p.isClosed())

  const page =
    existing ??
    (yield* Effect.tryPromise({
      try: () => ctx.newPage(),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err))
    }))

  const targetUrl = verifyMode ? `${config.baseUrl}/search?keyword=sepeda` : `${config.baseUrl}/buyer/login`

  yield* Effect.tryPromise({
    try: () =>
      page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000
      }),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err))
  })

  if (!verifyMode && (yield* browser.isLoggedIn)) {
    yield* Console.log(
      "✅ This profile is already logged in. Pass --verify to keep the window open for CAPTCHA verification.\n"
    )

    return
  }

  yield* Console.log(
    verifyMode
      ? "👉 In the Chromium window: complete any Shopee CAPTCHA / verification."
      : "👉 In the Chromium window: log into your Shopee account."
  )
  yield* Console.log("   Complete any OTP / captcha Shopee shows.")
  yield* promptLine("\nWhen you see normal search results / logged-in state, press Enter here to save… ")

  if (yield* browser.isLoggedIn) {
    yield* Console.log(
      "\n✅ Login detected and saved. You can close this and start the MCP server.\n"
    )
  } else {
    yield* Console.log(
      "\n⚠️  Could not detect a logged-in session (no SPC_U/SPC_EC cookie).\n" +
        "   If you did log in, the session is still saved to the profile — try the server anyway.\n" +
        "   Otherwise re-run `pnpm run login`.\n"
    )
  }
}).pipe(
  Effect.scoped,
  Effect.provide(BrowserSession.layer.pipe(Layer.provideMerge(AppConfig.layer)))
)

NodeRuntime.runMain(program)
