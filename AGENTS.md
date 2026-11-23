# Caduceus

Remote web UI for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It runs anywhere and talks to Hermes only through its public HTTP APIs. It never reads the agent host's filesystem.

## Stack

- Bun, Vue 3 (`<script setup lang="ts">`), Pinia, vue-router (hash history), Tailwind v4, Vite.
- `server/` is an Elysia relay: it serves `dist/` and proxies to Hermes. It injects auth server-side and removes CORS problems.
  - `/ui-api/gw/*` goes to the gateway API server (`gateway/platforms/api_server.py`): chat, sessions, cron jobs, approvals.
  - `/ui-api/dash/*` goes to the dashboard (`hermes_cli/web_routers/*`, `plugins/kanban/dashboard/plugin_api.py`): config, skills, kanban, webhooks, search.
  - What the relay remembers lives in two files in the data folder, `server/store.ts`: `config.json` (what the user sets: connection, preferences, notification settings) and `state.json` (what the app keeps: read marks, projects, bot keys, push devices and key). Each has one TypeBox schema, checked at start; a file that does not fit stops the relay. Modules change `config` or `state` in place, then call `saveConfig()` (writes at once) or `saveState()` (at most once a second, and on exit). Request bodies are checked with TypeBox schemas too (`body:` on the route); a schema for a change must not carry defaults (`withoutDefaults` in `src/lib/schema.ts`), or Elysia fills in and resets the fields the change leaves out. Schemas shared with the browser live in `src/lib/`.
  - Viewing a chat on the Hermes socket goes through `views.view(profile, id)` and `release()` (`server/session-views.ts`), never a direct `session.resume`/`session.detach`: Hermes gives the socket one subscription per chat, and a detach would end every other view of it, after which Hermes skips the bot's clarify questions because nobody can answer them.
  - `/ui-api/projects` is Caduceus's own project store (`server/projects.ts`).
  - `/ui-api/preferences` holds preferences that follow the user to every device (`server/preferences.ts`, read through `usePreferences()` in `src/stores/preferences.ts`). A new one goes into `PreferencesSchema` in `src/lib/preferences.ts`, with its default. Settings that belong to one screen, like the theme, stay in localStorage.
  - `/ui-api/notify` is notifications: `server/notify.ts` delivers notices (Web Push through `server/webpush.ts`, ntfy, webhooks) and keeps its settings (`config.json`) and the devices and VAPID key (`state.json`); `server/notify-watch.ts` watches Hermes for them (`session.active_list`, chat streams via `onChatStream` in `server/runs.ts`, `groups.changed`, cron jobs). The rules (what is news, tags, routes, who is told) are pure, in `src/lib/notifications.ts`, shared with the browser; `src/lib/push.ts` subscribes and reports presence; `src/sw.js` shows them. Never send real pushes while testing: the tests decrypt locally.
  - `/ui-api/chat-models` holds the model chosen for each chat (`server/chat-models.ts`, `src/stores/chat-models.ts`, rules in `src/lib/chat-models.ts`). The browser locks the chat to the model in Hermes (`gateway.setSessionModel`), then records it here, because Hermes tells clients only a chat's model name, never its provider or reasoning level. A deleted chat's record goes when the delete passes through the relay. Hermes keeps a chat on the model it started with, so a bot's model change also locks its Bot Chat (`setBotModel`).
  - `/ui-api/read-marks` holds how far each Bot Chat and Room has been read, shared by all devices (`server/read-marks.ts`, `src/stores/read-marks.ts`). Marks only move forward; the bots and groups stores read them through `unread` and set them with `markSeen`.
- API clients:
  - `src/lib/gateway.ts` and `src/lib/dashboard.ts`.
  - Fetch helpers are in `src/lib/http.ts` (`get`/`post`/`put`/`patch`/`del`/`qs`). Errors are thrown as `ApiError`, with `.status` and `.code`.
- A chat's running turn:
  - Callers read `runOf(id)`, `faceOf(id)` and `isRunning(id)` from the sessions store, never its internal maps.
  - `src/lib/live-tail.ts` decides where the saved transcript stops and the running turn starts.
  - `TurnWriter` (`src/lib/turn-writer.ts`) is the only place events become steps, from the chat stream and from the Hermes socket. Approvals and clarify questions carry `via`: where their answer goes.
  - `src/lib/bot-watch.ts` watches a Bot Chat and tells its turns apart by generation. A turn sent from here takes its events with `claim`.
  - A read that repeats goes through `poller` (`src/lib/poller.ts`), not a hand-rolled timer.
- Domain words are in `GLOSSARY.md`; decisions not to revisit are in `docs/adr/`.
- Hermes source for reference: `/tmp/hermes-src/hermes-agent` (may be missing; it's a shallow clone).

## Running

- `bun server/index.ts` starts the relay on :7811. It serves `dist/`.
- `bunx vite build` builds the frontend.
- `bun run dev` starts the Vite dev server on :5173, which proxies `/ui-api` to the relay.
- `bunx vue-tsc --noEmit` typechecks the frontend.
- `bun test` runs the tests in `test/`; `bunx tsc -p test --noEmit` typechecks them. They cover the pure modules below through their own interfaces, with fakes in place of the relay.
- `bun fmt` formats everything (config in `bunfig.toml`: tabs, single quotes, no semicolons, width 120). Run it after editing; `bun fmt --check` must pass. Don't add a `fmt` script to package.json, because `bun fmt` would run it instead of the formatter.
- The connection is configured in `.env` (`HERMES_GATEWAY_URL`, `HERMES_API_KEY`, `HERMES_DASHBOARD_URL`, `HERMES_DASHBOARD_USERNAME`/`PASSWORD` or `HERMES_DASHBOARD_TOKEN`).
- Screenshots and demos use `scripts/mock-relay.ts`, a relay with made-up data on its own port, never the live instance; its header explains running it and capturing 2x screenshots.
- Against the live instance, read-only probing is fine, e.g. `curl -s localhost:7811/ui-api/dash/api/skills`. Never mutate real user data (jobs, skills, config, tasks, webhooks) while testing. Create clearly named test objects and delete them afterwards.

## Design system ("lapis & gold")

Tokens are in `src/style.css`; use them via Tailwind.

- **Colours:** `bg-bg`, `bg-surface`, `bg-surface-2`, `bg-surface-3`, `border-line`, `text-ink`, `text-ink-2`, `text-ink-3`, `text-gold`, `bg-gold-soft`, `text-verdigris` (success), `text-rose`, `bg-rose-soft` (danger), `focus`.
- **Gold is reserved for the agent's own activity:** live runs, things running right now, the streaming cursor. Do not use it for decoration or generic accents.
- **Utilities:** `btn-primary`, `btn-outline`, `btn-ghost`, `btn-danger`, `icon-btn`, `field` (input, select, textarea), `label`, `panel`, `chip`.
- **Typography:** Geologica throughout. `display` is for page titles (`PageHeader` already applies it). Monospace (`font-mono`) is only for code, commands, cron expressions, file paths and raw output. Never use it for labels or metadata.
- **Copy:** sentence case and plain verbs, written from the user's side ("Pause schedule", "Delete webhook"). The toast after an action uses the same verb ("Schedule paused").
  - No ALL CAPS labels, no eyebrow labels above headings, no "A · B · C" metadata strings, no "→" in buttons, no emoji.
  - Errors say what happened and how to fix it. Empty states invite an action.
- **Layout:** left-aligned. Each page is `<div class="h-full overflow-y-auto">`, then `<PageHeader title subtitle>` with actions in its default slot, then content in `px-6 md:px-10 pb-16`.
  - Reading text is at most ~72ch.
  - Avoid identical card grids. Prefer lists and rows with dividers (`divide-y divide-line`) and real hierarchy.
  - `panel` is for grouped content that genuinely needs a container.
- **Components:** `Modal.vue` (props `title`, `wide`; slots default and `footer`; emits `close`), `PageHeader.vue`, `EmptyState.vue` (`title`, `body`, slot for actions).
  - Toasts: `useToasts().push(text)` and `.error(text)`.
  - Confirm and prompt: `await useDialogs().confirm({ title, body, action, danger })` resolves to a boolean; `await useDialogs().prompt({ title, label, value, hint, action })` resolves to the trimmed text or `null`. Never use the browser's `confirm()` or `prompt()`. From a popover menu, close the menu before asking.
  - Icons: `lucide-vue-next`, size 16–18.
  - Time helpers: `src/lib/time.ts` (`relative`, `dateTime`, `toDate`).
  - Markdown: `renderMarkdown` from `src/lib/markdown.ts`, rendered into an element with class `prose-h`.
  - Data loading: `useResource(key, fetcher)` from `src/lib/resource.ts` (stale-while-revalidate, cached per key for the session). Revisits must paint from cache; after a mutation use `mutate` for an optimistic update, then `reload`.
  - Loading: `Skeleton.vue` (`variant` rows, lines or cards) in the spot the content will take, never "Loading…" text. `.refresh-bar` for background refreshes over data already shown.
- **Motion:** only in answer to a user action, only on `transform` and `opacity` (it must hold 120Hz). Use the tokens (`--ease-out`, `--dur-fast`, `--dur`, `--dur-slow`) and the `<Transition>` names in `src/style.css` (`page`, `fade`, `rise`, `drawer`); `pressable` gives tap feedback (already in `btn*` and `icon-btn`). No idle or looping motion except skeletons and live-run indicators.
- **Quality floor:**
  - Responsive down to 375px wide.
  - Keyboard reachable, with visible focus (already global).
  - Inputs have labels.
  - Destructive actions ask for confirmation with `useDialogs().confirm` and `danger: true`.
  - Loading and error states are visible.
  - No motion beyond what a user action triggers.
