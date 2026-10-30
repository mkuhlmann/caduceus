<h1><img src="public/logo.svg" alt="Caduceus" height="64"></h1>

A lightweight web and desktop frontend for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It runs anywhere: on your laptop, on a server, in a container, or as a desktop app. It talks to Hermes only through its public HTTP APIs, so nothing has to be installed on the agent's machine.

![A chat with Hermes mid-run: finished tool steps, a running command and the reply streaming in](docs/screenshot-chat.png)

![The schedules page listing active and paused cron jobs with their next and last runs](docs/screenshot-schedules.png)

## Why it exists

The existing ways to put a UI on Hermes assume you are on the agent's machine:

- **hermes-webui** reads Hermes' files directly, so it needs the Hermes directory mounted into it. That is cumbersome when the agent runs on another server, in another container, or behind a firewall.
- **The official Hermes desktop app** ships with the whole agent. To use it you install Hermes itself, even if your agent already runs somewhere else.

Caduceus is only the frontend. Point it at the URLs of a running Hermes gateway and dashboard and it works, from a container next to the agent or from a laptop on the other side of the world. The Docker image holds just the Bun runtime, one bundled server file and the built UI, and the desktop app is a thin window around the same relay.

## Features

- **Chat:** streamed replies. Each tool call shows as a step on the agent's route, and you can expand it for arguments and output. Risky commands get inline approval. You can stop a run, send a message mid-run to redirect it, and attach images.
- **History:** every conversation from every channel (Telegram, Matrix, terminal, schedules and more), with full-text search.
- **Projects:** group chats and give them standing instructions. Hermes' own working folders on the host are also listed.
- **Schedules:** create, edit, pause, run now, and view the runs of Hermes' cron jobs.
- **Webhooks:** manage incoming webhook subscriptions.
- **Board:** the Hermes kanban board, with drag and drop, task details and comments.
- **Skills:** turn installed skills on or off, edit and create them, and install from the hub.
- **Settings:** the model picker, every config section from Hermes' schema, and API keys.

## How it connects

```
browser ──▶ Caduceus relay (Bun + Elysia) ──▶ Hermes gateway API server  (chat, sessions, schedules, approvals)
                                         └──▶ Hermes dashboard            (config, skills, board, webhooks, search)
```

The relay serves the UI, keeps your keys server-side, and passes streams through. It also removes the cross-origin limits both Hermes APIs have when called from a browser.

## Quick start with Docker

Images for `linux/amd64` and `linux/arm64` are published to the GitHub Container Registry on every push to `main` and every `v*` tag.

```sh
docker run -d --name caduceus \
  -p 7811:7811 \
  -v caduceus-data:/data \
  -e CADUCEUS_PASSWORD=change-me \
  -e CADUCEUS_SECRET="$(openssl rand -hex 32)" \
  -e HERMES_GATEWAY_URL=https://hermes-api.example.com \
  -e HERMES_API_KEY=... \
  -e HERMES_DASHBOARD_URL=https://hermes.example.com \
  -e HERMES_DASHBOARD_USERNAME=... \
  -e HERMES_DASHBOARD_PASSWORD=... \
  ghcr.io/mkuhlmann/caduceus:latest
```

Then open http://localhost:7811. The `HERMES_*` variables are optional: leave them out and enter the connection on the app's connection page instead. It is saved in `/data`.

Or with Compose:

```yaml
services:
  caduceus:
    image: ghcr.io/mkuhlmann/caduceus:latest
    restart: unless-stopped
    ports:
      - '7811:7811'
    volumes:
      - caduceus-data:/data
    env_file: .env

volumes:
  caduceus-data:
```

The image contains only the Bun runtime, one minified `server.js` and the built UI. There is no `node_modules`. It runs as the unprivileged `bun` user and has a health check on `/ui-api/auth`.

Inside the container the relay listens on `0.0.0.0`, so it refuses to start without `CADUCEUS_PASSWORD`. If a reverse proxy in front of it already handles sign-in, set `CADUCEUS_ALLOW_NO_PASSWORD=1` instead.

### Image tags

| Tag            | Built from                  |
| -------------- | --------------------------- |
| `latest`       | the newest commit on `main` |
| `1.2.3`, `1.2` | the git tag `v1.2.3`        |
| `main`         | the newest commit on `main` |
| `sha-<commit>` | a specific commit           |

Pull requests build the image to check it but don't publish it.

To build it yourself:

```sh
docker build -t caduceus .
```

## Preparing the Hermes host

1. Enable the gateway API server in `~/.hermes/.env`, then restart the gateway:
   ```
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<16+ random characters>
   API_SERVER_HOST=0.0.0.0   # or keep 127.0.0.1 and use a tunnel or reverse proxy
   ```
2. Run the dashboard: `hermes dashboard --host 0.0.0.0 --no-open`. A non-loopback dashboard needs a login, so set `HERMES_DASHBOARD_BASIC_AUTH_USERNAME`, `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` and `HERMES_DASHBOARD_BASIC_AUTH_SECRET`. Behind a reverse proxy, also set `dashboard.public_url`.

## Configuration

Connection settings come from the environment or from the app's connection page. When they are set in the environment, the connection page is read-only.

| Variable                    | Purpose                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `HERMES_GATEWAY_URL`        | Base URL of the Hermes gateway API server.                                                  |
| `HERMES_API_KEY`            | The gateway's `API_SERVER_KEY`.                                                             |
| `HERMES_DASHBOARD_URL`      | Base URL of the Hermes dashboard.                                                           |
| `HERMES_DASHBOARD_USERNAME` | Dashboard basic-auth username.                                                              |
| `HERMES_DASHBOARD_PASSWORD` | Dashboard basic-auth password.                                                              |
| `HERMES_DASHBOARD_TOKEN`    | Alternative to username and password. Leave all three empty for a dashboard on `localhost`. |

Relay settings:

| Variable                     | Default                           | Purpose                                                                                           |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `PORT`                       | `7811`                            | Port the relay listens on.                                                                        |
| `HOST`                       | `127.0.0.1` (`0.0.0.0` in Docker) | Address the relay binds to.                                                                       |
| `CADUCEUS_PASSWORD`          | unset                             | Password that protects Caduceus itself. Required when `HOST` is not a loopback address.           |
| `CADUCEUS_ALLOW_NO_PASSWORD` | unset                             | Set to `1` to run on a network address without a password, when a proxy in front handles sign-in. |
| `CADUCEUS_SECRET`            | random on each start              | Key that signs session cookies. Set it to stay signed in across restarts.                         |
| `CADUCEUS_DATA_DIR`          | `./.data` (`/data` in Docker)     | Where the connection settings and projects are stored.                                            |
| `CADUCEUS_DIST`              | `../dist` next to the server      | Folder with the built UI.                                                                         |

## Running from source

Requires [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun run build   # typecheck and build the UI into dist/
bun run start   # http://127.0.0.1:7811
bun run dev     # Vite on :5173 with hot reload, relay on :7811
```

Other commands:

```sh
bun run typecheck      # frontend and server
bun fmt                # format everything (config in bunfig.toml)
bun run build:server   # compile the relay into one binary, dist-bin/caduceus-server
```

Run the compiled binary with `CADUCEUS_DIST` pointing at `dist/`.

## Desktop

`desktop/webview` builds the desktop app as one executable: the relay, the built UI and a native window from [webview-bun](https://github.com/tr1ckydev/webview-bun). It does not bundle a browser; the window is the system webview (WebView2 on Windows, WebKitGTK on Linux). The relay runs in a worker on a localhost port that stays the same between launches.

- `bun run desktop` runs it from source.
- `bun run desktop:win` builds `desktop/webview/out/Caduceus-<version>-x64-portable.zip` (about 55 MB). Unzip it anywhere, including a USB stick, and run `Caduceus.exe`. While the file named `portable` sits next to the exe, the connection and projects go into a `data` folder beside it. Delete that file to use `%APPDATA%\Caduceus` instead. Windows 10 needs the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/); Windows 11 ships it.
- `bun run desktop:linux` builds `desktop/webview/out/caduceus-<version>-linux-x64.tar.gz` (about 52 MB). It needs GTK 4 and WebKitGTK 6.0 on the system: `sudo apt install libgtk-4-1 libwebkitgtk-6.0-4`.

Both targets build from Linux. Set `CADUCEUS_DEVTOOLS=1` to get the webview's developer tools.

`desktop/electron` is the earlier Electron shell, kept for comparison (`bun run electron`, `bun run electron:win`). It ships Chromium and a separate relay binary, about 180 MB zipped.

The UI uses hash routing and relative URLs, and has no shell-specific code. Any other webview wrapper can host it the same way: start `caduceus-server` on `127.0.0.1`, then point the webview at it.

## Project layout

```
src/        Vue 3 frontend (Pinia, vue-router, Tailwind v4)
server/     Elysia relay: static files, auth, proxy to Hermes, project store
desktop/    Desktop app (webview), earlier Electron shell
```
