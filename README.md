# play-unite

A cricket web app (Cricbuzz-style). React (Vite) client + Express/MongoDB API.

## Run

```bash
npm run install:all   # once
npm run dev           # API on :5000, client on http://localhost:5173
```

Run the API through `npm run dev` (it uses `node --watch`). Starting it by hand
with `node index.js` keeps serving old code after updates, which shows up as
`No API route…` errors or blank pages.

MongoDB: set `MONGODB_URI` in `server/.env` (see `.env.example`). If unset, an
embedded MongoDB starts automatically with data persisted in `server/.data/`.

## Features so far

- **Sign in with a name + 4-digit PIN** — no email or phone. Names are the primary
  key of the `users` collection (`_id` = lower-cased name), so they are unique
  case-insensitively.
  - New name → choose a PIN (entered twice). Returning name → enter the PIN.
  - Works on any device and any time later: if the browser loses its cookie, the
    player signs in again with name + PIN and gets all their teams back.
  - The PIN is stored as a salted scrypt hash. 5 wrong PINs lock the name for 15 min.
  - Players created before PINs existed set their PIN the next time they sign in.
  - A sign-in creates a session (`sessions` collection, token stored as SHA-256)
    and an `httpOnly`, `SameSite=Lax` cookie valid for a year, renewed on use.
- **Teams** — from Home a player can:
  - **Create a Team**: enter a unique team name (case-insensitive, `_id` = lower-cased
    name), then on `/teams/new` pick 1–15 players from a searchable list of all users.
    The creator is the team's **captain** and is a member on top of those 15.
    Only the captain can add players later (on the team page).
  - **Join a Team**: search a dropdown of all teams, or use the **All Teams** list
    (filterable by status), and send a join request. The captain gets a
    notification (bell in the header, polled every 15 s) and can accept or
    reject; the player is notified of the decision.
  - A player can be in many teams ("My Teams" on Home).
- **Team status** (squad size includes the captain):
  - `in_match` — the captain started a match (needs 11+ players) and hasn't ended it.
  - `needs_players` — fewer than 11 players; shows how many are still needed.
  - `idle` — 11 or more players and not in a match.
- **Playing roles** — Batter, Bowler, All-rounder or Wicketkeeper, picked at sign-up
  (players from before roles existed are asked on Home) and changeable on the profile.
  Shown everywhere a player appears.
- **Playing XI & bench** — on the team page the captain drags players (touch or
  mouse, ⋮⋮ handle) between the default Playing XI (batting order) and the bench,
  or taps Bench / + XI. Dropping a bench player on a full XI swaps them. The XI
  shows its role mix and warns when there's no wicketkeeper. It pre-fills new matches.
- **Matches between two teams** (Home → Create a Match, or a team page):
  - Any member of a team can create a match for it against another team.
  - Both teams must be free: a team already in a match (toss or live) can't be
    picked, and creating a match locks both teams atomically.
  - Both playing XIs are set with the same drag-and-drop board. Each side plays
    2–11 players (box/gully cricket is often short-handed), so teams below 11 can
    still play; "won by N wkts" uses the chasing side's real size.
    A player in both squads can only play for one side, and nobody can be in two
    live matches at once.
  - **Toss**: the creator calls heads or tails; the server flips (fair, random) and
    a 3D coin animation lands on that face. The toss winner chooses bat or bowl,
    and the scorer sets the **overs per innings** (1–50).
  - **Ball-by-ball scoring** (like CricHeroes): the match creator is the scorer.
    They pick the openers and opening bowler, then tap each delivery on a keypad:
    0–6, wide, no ball, bye, leg bye, and OUT (bowled, caught, LBW, run out,
    stumped, hit wicket; only the dismissals the Laws allow on that delivery).
    The app rotates strike on odd runs and at the end of each over, asks for the
    new batter after a wicket and the next bowler after each over (no bowler bowls
    two in a row), and ends the innings when overs run out, the side is all out or
    the target is reached. Undo removes the last ball, and the bowler prompt shows
    the over just bowled so any ball in it can be changed; retire hurt, change
    strike, end innings and "no result" are in the ••• menu.
  - Each innings is stored as an event log; `shared/scoring.js` replays it to get
    the score, batters, bowlers, extras, maidens, partnerships, fall of wickets and
    commentary. The server validates every event with the same engine.
  - **Live**: followers on the match centre get a push after every ball (Server-
    Sent Events), with the live score, run rates, chase equation, batters, bowler,
    this over and commentary.
  - **When the second innings ends** the match completes by itself: it records the
    scorecard, result ("India won by 6 wkts" / "by 102 runs", tie) and the MVP
    across both XIs; stars update and both teams are free again. For 24 hours the
    creator can undo the final ball, which reopens the match and reverses its
    stats. The creator can also abandon a match (no stats).
  - The match centre shows a Cricbuzz-style scorecard (batting, extras, total,
    did not bat, bowling with economy) and every player's MVP points.
- **Following matches** — every signed-in player can follow any match:
  - Home shows **Live now** (live scores, who's batting, the chase equation;
    refreshes every 10 s) and **Recent results**; `/matches` lists all live and
    completed matches.
  - The match centre shows the live scoreboard, commentary and full batting and
    bowling cards for each innings while the match is on, and the final scorecard,
    result and MVP afterwards.
  - Only the match creator can score: the scorer screen and the scoring API
    (`events`, `correct`, `undo`, `complete`, `reopen`) refuse everyone else.
- **Stars** — each MVP raises the player's level: 1 MVP = ★, 5 = ★★, 10 = ★★★,
  20 = ★★★★, 40 = ★★★★★ (`STAR_LEVELS` in `shared/cricket.js`).

### MVP points (`shared/cricket.js`, used by client and server)

Base is the IPL Most Valuable Player formula; because it ignores runs, strike
rate and economy, those are added the way fantasy T20 scoring does (a wicket is
worth roughly 25 runs).

| Batting | Points | Bowling | Points | Fielding | Points |
| --- | --- | --- | --- | --- | --- |
| Run | 1 | Wicket | 28.5 | Catch | 10.5 |
| Four (bonus) | 2.5 | Dot ball | 1 | 3+ catches | +4 |
| Six (bonus) | 3.5 | Maiden | 12 | Stumping | 14.5 |
| 30 / 50 / 100 | +4 / +8 / +16 | 3 / 4 / 5 wickets | +4 / +8 / +16 | Run-out | 14.5 |
| Strike rate (10+ balls) | −6 … +6 | Economy (2+ overs) | −6 … +6 | | |
| Duck (not bowlers) | −2 | | | | |

## API

Everything except `/api/auth/lookup|register|login|logout` needs the session
cookie (401 without one).

| Method | Path                  | Description                                                   |
| ------ | --------------------- | ------------------------------------------------------------- |
| GET    | `/api/auth/lookup?name=` | `{ name, exists, hasPin }` — new or returning player      |
| POST   | `/api/auth/register`  | `{ name, pin, role }` → 201 + session cookie, 409 name taken  |
| POST   | `/api/auth/login`     | `{ name, pin }` → 200 + cookie, 401 wrong PIN, 429 locked     |
| GET    | `/api/auth/me`        | The signed-in player                                          |
| POST   | `/api/auth/logout`    | Ends this device's session                                    |
| PATCH  | `/api/auth/me`        | `{ role }` — change your playing role                         |
| GET    | `/api/players`        | All players                                                   |
| GET    | `/api/players/:name`  | Profile: role, level (stars), teams, recent match points      |

| Method | Path                            | Description                                         |
| ------ | ------------------------------- | --------------------------------------------------- |
| GET    | `/api/teams?q=&status=`         | All teams with status; filter by name and/or `in_match`, `needs_players`, `idle` |
| GET    | `/api/teams/mine`               | Teams the player captains or plays in               |
| GET    | `/api/teams/availability?name=` | `{ available, error }` for a team name              |
| POST   | `/api/teams`                    | `{ name, players: [names] }` → 201, 400, 409 taken  |
| GET    | `/api/teams/:name`              | Team details + status (+ pending requests for the captain) |
| POST   | `/api/teams/:name/players`      | Captain adds `{ players }` (max 15), 403 otherwise  |
| PUT    | `/api/teams/:name/lineup`       | Captain saves the default `{ playingXI: [names] }` (≤ 11) |

| Method | Path                        | Description                                                        |
| ------ | --------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/matches?status=live\|completed&limit=` | Match list for anyone: teams, live/final scores, status line |
| POST   | `/api/matches`              | `{ team: { name, playingXI }, opponent: { name, playingXI } }` (2–11 each) → 201 (status `toss`); 409 if a team or player is busy |
| GET    | `/api/matches/:id`          | Match centre: sides, toss, innings, result, MVP, points            |
| POST   | `/api/matches/:id/toss`     | Creator calls `{ call: heads \| tails }`; server flips             |
| POST   | `/api/matches/:id/decision` | Toss winner `{ decision: bat \| bowl, overs }` → status `live`     |
| POST   | `/api/matches/:id/events`   | Scorer adds `{ event, at }` (ball, openers, batter, bowler, swap, retire, endInnings); `at` = events already seen, 409 if stale |
| POST   | `/api/matches/:id/correct`  | Scorer re-records a ball of the current innings `{ index, event, at }`; 400 if it clashes with later events |
| POST   | `/api/matches/:id/undo`     | Scorer removes the last event `{ at }`                             |
| POST   | `/api/matches/:id/complete` | `{ at, noResult? }` ends a match as a no result, or records the result if it didn't close by itself |
| POST   | `/api/matches/:id/reopen`   | Creator undoes the final ball of a completed match within 24 hours; 409 if a team or player is busy |
| GET    | `/api/matches/:id/live`     | Server-Sent Events: a message after every change                   |
| POST   | `/api/matches/:id/abandon`  | Creator cancels a toss/live match (no stats)                       |
| POST   | `/api/teams/:name/requests`     | Ask to join → 201, 409 already requested            |
| POST   | `/api/requests/:id/accept`      | Captain accepts; player joins the team              |
| POST   | `/api/requests/:id/reject`      | Captain rejects                                     |
| GET    | `/api/notifications`            | `{ incoming, updates }` for the current player      |
| POST   | `/api/notifications/seen`       | Dismiss accept/reject updates                       |

## Database

- **Development:** with no `MONGODB_URI`, the server starts an *embedded* MongoDB
  (`mongodb-memory-server`, an optional dev dependency). It downloads a `mongod`
  binary into `server/.mongodb-binaries/`, stores data in `server/.data/`, listens
  only on `127.0.0.1:27018`, and has no authentication. That's why no credentials
  were needed locally. It's for development only.
- **Production:** `MONGODB_URI` is required (the server refuses to start without
  it) and must point at a real MongoDB with authentication: the `mongo` container
  in `docker-compose.yml`, or a managed service such as MongoDB Atlas.

## Deploy (Docker on EC2)

The stack in `docker-compose.yml`:

| Service | What it does | Exposed |
| ------- | ------------ | ------- |
| `caddy` | Reverse proxy; automatic HTTPS (Let's Encrypt) when `DOMAIN` is set | 80, 443 |
| `app`   | Node API + the built React client (`Dockerfile`), runs as non-root | internal only |
| `mongo` | MongoDB 7 with auth; data in the `mongo-data` volume; the app uses a read/write-only user (`deploy/mongo-init.js`) | internal only |

1. **EC2 security group:** allow inbound 22 (your IP only), 80 and 443. Don't open 27017.
2. **Install Docker** on the instance (Amazon Linux 2023: `sudo dnf install -y docker && sudo systemctl enable --now docker`,
   plus the Compose plugin; Ubuntu: Docker's apt repository with `docker-compose-plugin`).
3. **Copy the project** to the instance (git clone, or `rsync`/`scp`, without `node_modules`, `server/.data`, `server/.mongodb-binaries`).
4. **Configure:** `cp .env.production.example .env`, then set strong passwords
   (`openssl rand -hex 24`) and, for HTTPS, `DOMAIN` (an A record pointing at the instance's Elastic IP).
5. **Start:** `docker compose up -d --build`, then check with `docker compose ps` and `curl http://localhost/api/health`.

Updating: copy the new code, then `docker compose up -d --build app`.
Backups: `docker compose exec mongo sh -c 'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db play-unite --archive' > backup-$(date +%F).archive`.
Logs: `docker compose logs -f app`.
