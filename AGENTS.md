# Caduceus

Remote web UI for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It runs anywhere and talks to Hermes only through its public HTTP APIs. It never reads the agent host's filesystem.

## Stack

- Bun, Vue 3 (`<script setup lang="ts">`), Pinia, vue-router (hash history), Tailwind v4, Vite.
- `server/` is an Elysia relay: it serves `dist/` and proxies to Hermes. It injects auth server-side and removes CORS problems.
  - `/ui-api/gw/*` goes to the gateway API server (`gateway/platforms/api_server.py`): chat, sessions, cron jobs, approvals.
  - `/ui-api/dash/*` goes to the dashboard (`hermes_cli/web_routers/*`, `plugins/kanban/dashboard/plugin_api.py`): config, skills, kanban, webhooks, search.
  - `/ui-api/projects` is Caduceus's own project store (`server/projects.ts`).
- API clients:
  - `src/lib/gateway.ts` and `src/lib/dashboard.ts`.
  - Fetch helpers are in `src/lib/http.ts` (`get`/`post`/`put`/`patch`/`del`/`qs`). Errors are thrown as `ApiError`, with `.status` and `.code`.
- Hermes source for reference: `/tmp/hermes-src/hermes-agent` (may be missing; it's a shallow clone).

## Running

- `bun server/index.ts` starts the relay on :7811. It serves `dist/`.
- `bunx vite build` builds the frontend.
- `bun run dev` starts the Vite dev server on :5173, which proxies `/ui-api` to the relay.
- `bunx vue-tsc --noEmit` typechecks the frontend.
- `bun fmt` formats everything (config in `bunfig.toml`: tabs, single quotes, no semicolons, width 120). Run it after editing; `bun fmt --check` must pass. Don't add a `fmt` script to package.json, because `bun fmt` would run it instead of the formatter.
- The connection is configured in `.env` (`HERMES_GATEWAY_URL`, `HERMES_API_KEY`, `HERMES_DASHBOARD_URL`, `HERMES_DASHBOARD_USERNAME`/`PASSWORD` or `HERMES_DASHBOARD_TOKEN`).
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
  - Icons: `lucide-vue-next`, size 16–18.
  - Time helpers: `src/lib/time.ts` (`relative`, `dateTime`, `toDate`).
  - Markdown: `renderMarkdown` from `src/lib/markdown.ts`, rendered into an element with class `prose-h`.
- **Quality floor:**
  - Responsive down to 375px wide.
  - Keyboard reachable, with visible focus (already global).
  - Inputs have labels.
  - Destructive actions ask for confirmation (`confirm()` is acceptable).
  - Loading and error states are visible.
  - No motion beyond what a user action triggers.
