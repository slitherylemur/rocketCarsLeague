# Migration Conventions (Luau → roblox-ts)

Rules used for every translated file in this migration. Read this before
translating or reviewing any module.

## Layout & naming

| Original location | TypeScript location | Runtime location (rojo) |
|---|---|---|
| ServerScriptService/`X` (Script) | `src/server/X.server.ts` | ServerScriptService/TS/X |
| ServerScriptService/GeneralUtils (+child) | `src/server/GeneralUtils/init.ts` (+`ConnectClientFunction.server.ts`) | ServerScriptService/TS/GeneralUtils |
| ServerStorage/Logger | `src/server/Logger.ts` | ServerScriptService/TS/Logger |
| ServerStorage/Modules/`X` | `src/server/Modules/X.ts` | ServerScriptService/TS/Modules/X |
| ServerStorage/Classes/`X` | `src/server/Classes/X.ts` | ServerScriptService/TS/Classes/X |
| ServerStorage/MapLightings/`X` | `src/server/MapLightings/X.ts` | ServerScriptService/TS/MapLightings/X |
| scripts embedded in ServerStorage models | `src/server/EmbeddedScripts/*.ts` | see EmbeddedScripts/README note in MIGRATION.md |
| StarterPlayerScripts/`X` (LocalScript) | `src/client/X.client.ts` | StarterPlayerScripts/TS/X |
| StarterPlayerScripts/PlayerModule/** | *(not shipped)* | Engine injects the default PlayerModule at runtime |
| ReplicatedStorage/`X` (ModuleScript) | `src/shared/X.ts` | ReplicatedStorage/TS/X |
| StarterGui UI + its embedded LocalScripts | `src/server/ui/**` React components + `src/client/uiClientBehaviors.client.ts` | rendered per-player into PlayerGui |

Module instance *location* moves (e.g. ServerStorage/Modules → ServerScriptService/TS/Modules).
This is safe because every `require(game.ServerStorage...)` becomes a static import.
Non-script instances referenced by path (VehicleModels, Colors, Sounds, Events, ...)
stay exactly where they are in the place file.

## Language mapping rules

- `require(game.X.Y)` → `import` from the translated module. Dynamic requires
  (`require(folder:FindFirstChild(name))`) → static registry map keyed by the same
  names (documented per file in MIGRATION.md).
- `_G.foo` → `Globals.foo` from `src/server/Globals.ts` (a single shared mutable
  object). `_G` is only used server-side in this game. Assignment sites and timing
  are preserved (fields assigned at the same point in module execution).
- Lua multiple returns → `LuaTuple<[...]>` (`$tuple(...)` from compiler types).
- `pcall(f)` stays `pcall`; keep wrapped regions identical — never widen or narrow
  a pcall's scope.
- Legacy `wait`/`delay`/`spawn` KEEP legacy semantics: use `LegacyTiming.ts`
  (`legacyWait`, `legacyDelay`, `legacySpawn` implemented on Heartbeat + ~1/30s
  minimum) — do NOT silently upgrade to `task.*`. `task.wait`/`task.delay`/
  `task.spawn`/`task.defer` translate directly.
- `Instance.new("X", parent)` → `New Instance.new("X")` + explicit `.Parent =`
  assignment placed WHERE THE ORIGINAL SET IT (constructor-parent means parent is
  set before other properties — preserve that order when it matters, e.g. events).
- `for i, v in pairs(t)` over arrays → keep iteration-order semantics: arrays use
  `for..of` with index when index used; dictionaries use `pairs(t)` from
  compiler-types. Generalized iteration `for i, v in t` → `pairs`.
- `table.find`, `table.insert`, `table.remove`, `table.sort`, `string.*`, `math.*`,
  `os.time`, `os.clock`, `tostring`, `tonumber`, `typeof`, `tick`, `time` → same
  globals in roblox-ts. String-method sugar (`("x"):gsub(...)`) → `string.gsub(...)`.
  CAUTION: gsub patterns are Lua patterns; keep them byte-identical.
- Lua `a and b or c` → keep as `a ? b : c` ONLY when `b` can never be false/nil;
  otherwise translate literally with `&&`/`||` (roblox-ts compiles these to Lua
  `and`/`or` with truthiness helpers where types require).
- `..` string concat → template literals or `..`-equivalent `+`? NO: use
  `tostring()`+`` `${}` `` templates; Lua `..` on numbers formats like tostring —
  template literals match.
- `nil` checks: `if x then` where x may be `false` vs `undefined` — translate
  truthiness EXACTLY (`if (x)` in TS compiles to truthiness check; fine).
- Luau OOP (`setmetatable` classes) → TS `class` when the class is used as a
  plain data+methods object (server VehicleClass etc.). Objects sent through
  RemoteEvents serialize the same way (fields on the object, methods on the
  metatable are stripped) — verified equivalent.
- Numeric for `for i = a, b, c` → `for (let i = a; i <= b; i += c)` (mind reverse loops).
- `#t` → `t.size()` for arrays / `.size()` on Maps only when the original used `#`.
- Mixed-key tables (e.g. `Content[-1]`, arrays with [-1]) → `Map<number, T>` or
  object with explicit keys — match ACCESS patterns, not aesthetics.
- Types: use real Instance types (`Frame`, `TextButton`, ...) with explicit casts
  at instance-path boundaries. Do not add runtime checks that the original lacked.
- Comments: keep original comments (including commented-out code blocks — they
  document the old implementation). Translate comment text as-is.

## Remote/Bindable events

All RemoteEvents/RemoteFunctions/BindableEvents are pre-existing INSTANCES in the
place (ReplicatedStorage/FunctionsAndEvents, ServerStorage/Events). Access them via
typed path lookups, e.g.
`ReplicatedStorage.WaitForChild("FunctionsAndEvents")` with an interface type.
Do not create new remotes unless the original code created them at runtime
(`createInputEvent` in VehicleClass does — preserve).

## Instance path access

- `game.X.Y.Z` (dot access) errors immediately in Luau when missing; translate to
  indexing without WaitForChild: `(X as any).Y` typed via generated interfaces —
  we use `FindFirstChild`-free direct index casts to preserve error behavior.
- `:WaitForChild("N")` stays `WaitForChild` (same timeout args).
- `:FindFirstChild("N")` stays `FindFirstChild`.

## UI (React) rules

- Server-side React (@rbxts/react + createRoot from @rbxts/react-roblox) renders
  each ScreenGui per player into PlayerGui — this mirrors the original server-side
  StarterGui→PlayerGui cloning and keeps ALL server UI logic server-side, where it
  was. `PlayerGuiManager` reproduces the join/reset/respawn (ResetOnSpawn) clone
  lifecycle.
- Static properties come from the extracted place data (props/*.json) — match the
  original values exactly; omit properties equal to class defaults.
- Non-GuiObject descendants of UI (Sound, NumberValue, RemoteEvent, BindableEvent,
  UIGradient, ...) are created inside the React tree.
- Client-side behaviors that were LocalScripts inside StarterGui (EnableWithConsole,
  hover sound, coinFrame animation, DetectInput) are reattached by
  `uiClientBehaviors.client.ts` watching PlayerGui (they re-attach on every
  remount, matching per-clone LocalScript execution).
- Imperative server mutations of live UI (Text/Visible/etc. from initializePlayer,
  roundHandler, setTab, ...) remain imperative on the rendered instances. React owns
  structure; game code owns these mutations (original architecture preserved).

## Things that are intentionally NOT changed

- Timing (`task.wait(x)` values, debounces, tween durations).
- Random number usage/order (`math.random` call sites).
- pcall-swallowed errors (e.g. missing garage → same silent failure).
- The DataStore2 fork's local modifications (save-even-if-not-updated fall-through
  + logging) — see src/server/Modules/DataStore2/.
