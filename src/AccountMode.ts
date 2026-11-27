import { Context, Effect, Layer, Ref } from "effect"
import { AppConfig } from "./Config.js"

export interface AccountModeService {
  readonly isActive: Effect.Effect<boolean>
  readonly setLoggedIn: (loggedIn: boolean) => Effect.Effect<boolean>
  readonly refresh: (check: Effect.Effect<boolean, Error>) => Effect.Effect<boolean>
}

export class AccountMode extends Context.Service<AccountMode, AccountModeService>()(
  "shopee-mcp/AccountMode"
) {
  static readonly layer = Layer.effect(
    AccountMode,
    Effect.gen(function*() {
      const config = yield* AppConfig
      const activeRef = yield* Ref.make(false)

      const isActive = Ref.get(activeRef)

      const setLoggedIn = Effect.fn("AccountMode.setLoggedIn")(function*(loggedIn: boolean) {
        const next = loggedIn && config.accountTools === "auto"

        yield* Ref.set(activeRef, next)

        return next
      })

      const refresh = Effect.fn("AccountMode.refresh")(function*(
        check: Effect.Effect<boolean, Error>
      ) {
        const loggedIn = yield* check.pipe(Effect.orElseSucceed(() => false))

        return yield* setLoggedIn(loggedIn)
      })

      return AccountMode.of({
        isActive,
        setLoggedIn,
        refresh
      })
    })
  )
}
