# Players Championship Fantasy Draft

A lightweight browser app for a fantasy golf pool with shared draft state, CSV leaderboard import, and Data Golf live sync.

## What it does
- Supports a flexible number of managers
- Runs a 4-round snake draft with 4 golfers per manager
- Tracks each team's roster in a shared SQLite-backed game state
- Projects the current winner throughout the tournament
- Lets you manually enter golfer position, score to par, cut status, and money won
- Lets you import leaderboard data from CSV
- Can import live leaderboard data and the full field from Data Golf through a local or hosted Node server
- Saves locally in the browser and shares everything through the server

## Scoring rules in the app
- Each manager drafts 4 golfers.
- Team score to par uses the best 3 of the 4 golfers.
- The worst score to par on each roster is automatically dropped.
- Total money won uses all 4 golfers.
- Projected winner is sorted by lowest counting score to par first, then highest total money as the tiebreaker.
- If a golfer misses the cut, the app automatically assigns that golfer the current highest score among golfers marked as having made the cut.

## Shared hosted version
The app now uses a server-backed SQLite database through `/api/state`.

That means:
- everyone who opens the same deployed app URL sees the same draft board
- picks, scores, CSV imports, and resets sync across browsers
- the browser still keeps a local backup in `localStorage`, but the server is the shared source of truth

## CSV fallback
If the API is flaky, use the `Live Sync` tab:
- `Download CSV Template` gives you a starter file
- `Import CSV Leaderboard` uploads a `.csv`
- `Import Pasted CSV` lets you paste leaderboard CSV directly
- the optional checkbox can auto-fill the golfer pool from the CSV before the draft starts

Accepted CSV headers include:
- player: `player`, `player name`, `name`, `golfer`
- position: `position`, `pos`, `rank`, `place`
- total score: `score`, `total`, `total score`, `score to par`, `to par`
- today: `today`, `today score`, `round`, `round score`
- money: `money`, `earnings`, `winnings`, `purse`
- cut: `made cut`, `cut`, `status`

## Live Data Golf setup
1. Copy `.env.example` to `.env`.
2. Set `STATE_DB_PATH` to a writable file path.
3. Put your Data Golf key in `DATAGOLF_API_KEY`.
4. Set `DATAGOLF_BASE_URL` and `DATAGOLF_TOUR` if you want something other than the defaults.
5. Start the server with `node server.js` or `npm start`.
6. Open `http://localhost:3000` in your browser.
7. Use the `Live Sync` tab to fetch live data, load the field into the draft pool, or import CSVs.

## Render hosting
This repo includes [render.yaml](C:\Users\RileyFlanagan\OneDrive - WisdomTree, Inc\rflanagan\Frequently Used\Codex\players-championship-fantasy\render.yaml), which sets up:
- a Node web service
- Node 24
- a persistent disk mounted at `/var/data`
- `STATE_DB_PATH=/var/data/game-state.db`

### Is Render free?
- Render does offer free web services.
- For this app, the shared hosted version should use a paid service with a persistent disk.
- Free instances can spin down and do not support the kind of durable file storage this shared app needs.

### What URL do you get?
After deploy, Render gives you a public URL like:
- `https://players-championship-fantasy.onrender.com`

Your group can all open that same URL.

### Render setup steps
1. Push this folder to a GitHub repo.
2. Log in to Render.
3. Click `New` -> `Blueprint` if you want Render to use `render.yaml` automatically.
4. Connect your GitHub repo.
5. Confirm the service settings from `render.yaml`.
6. Add your Data Golf key in the Render dashboard if you want live sync.
7. Deploy.

### Exact Render environment checklist
Required for shared state:
- `NODE_VERSION=24`
- `STATE_DB_PATH=/var/data/game-state.db`

Optional for live Data Golf sync:
- `DATAGOLF_API_KEY=your_real_key`
- `DATAGOLF_BASE_URL=https://feeds.datagolf.com`
- `DATAGOLF_TOUR=pga`

### If you do not use Blueprint
Create a `Web Service` manually with:
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Plan: `Starter` or higher
- Persistent Disk:
  - Mount path: `/var/data`
  - Size: `1 GB`

## Notes on the integration layer
- The API key stays on the server and is never exposed to the browser.
- The frontend calls `/api/state` for shared game sync.
- The frontend also calls `/api/live/status`, `/api/live/import`, and `/api/live/field` for optional live data.
- The server uses Data Golf live tournament stats for score and field data, plus Data Golf in-play probabilities for leaderboard context.
- Drafted golfers are matched to live feed players by normalized name.
- If a golfer does not match exactly, that golfer stays unchanged and will be listed as unmatched after sync/import.

## How to use the app
1. Open the app through the server.
2. Enter the manager names.
3. Paste the golfer pool, one golfer per line, or auto-load it from Data Golf or CSV.
4. Click `Randomize Draft Order`.
5. Click `Start Draft`.
6. Draft by clicking golfers from the available pool until all picks are made.
7. Either update golfers manually, import a CSV leaderboard, or use live sync during the event.

## Files
- `index.html`: app layout
- `styles.css`: app styling
- `app.js`: draft logic, scoring rules, shared sync, and live sync client
- `server.js`: web server, shared state API, Data Golf proxy, and SQLite storage
- `render.yaml`: Render deployment config
- `game-state.db`: SQLite database created by the server at runtime
- `game-state.json`: legacy JSON state file used only for migration
- `.env.example`: sample server configuration
