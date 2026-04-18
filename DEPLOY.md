# Deploying Ludo

Two artefacts, two hosts:

| Piece | Host | Why |
|-------|------|-----|
| `backend/` (Express + Socket.io) | **Render** (Free Web Service) | Free tier includes WebSockets and HTTPS. |
| `frontend/` (Vite build → static `dist/`) | **Vercel** | Free, fast CDN, auto-deploys on push. |

This doc gives you the exact clicks and env vars.

---

## 1. Push the repo to GitHub

```bash
cd ludo-game
git init
git add .
git commit -m "initial commit"
# create the repo on github.com then:
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

## 2. Deploy the backend on Render

1. Go to https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect your GitHub repo. Render will detect [`backend/render.yaml`](backend/render.yaml)
   and propose one service: `ludo-backend`.
3. Approve it. Render gives you a URL like `https://ludo-backend-xyz.onrender.com`.
4. Open the service → **Environment** tab → set:
   - `CLIENT_ORIGIN` = `https://ludo.vercel.app`  *(or whatever frontend URL you're using)*
5. Confirm health check `GET /health` returns `{"ok":true,...}`.

Notes:
- Free plan sleeps after 15 min idle → first room creation after sleep = ~30s cold start.
- `NODE_VERSION` can be pinned via an env var if you see engine mismatches; Render defaults to the current LTS.

## 3. Deploy the frontend on Vercel

1. Go to https://vercel.com/new → import the same GitHub repo.
2. **Root Directory**: `frontend`.
3. Vercel auto-detects Vite and uses [`frontend/vercel.json`](frontend/vercel.json).
4. **Environment Variables** → add:
   - `VITE_SERVER_URL` = `https://ludo-backend-xyz.onrender.com` *(the Render URL from step 2)*
5. Click **Deploy**. Vercel gives you `https://ludo.vercel.app` (or whatever name you chose).
6. Go back to the Render backend and update `CLIENT_ORIGIN` to this exact URL.

## 4. Share a room

Open the site, enter a name, click **Create**. Copy the link (`https://.../?room=ABC123`)
and send to a friend. Anyone, anywhere.

---

## Required environment variables — at a glance

| Where | Key | Example | Required? |
|-------|-----|---------|-----------|
| Backend (Render) | `PORT` | `10000` | Render sets it — leave as hint |
| Backend (Render) | `CLIENT_ORIGIN` | `https://ludo.vercel.app` | **Yes in prod** (defaults to `*` which is sloppy) |
| Frontend (Vercel) | `VITE_SERVER_URL` | `https://ludo-backend-xyz.onrender.com` | **Yes** (without it the build bakes `http://localhost:3001`) |

---

## Gotchas you should know before shipping

- **HTTPS is mandatory for voice.** `getUserMedia` is blocked in non-secure contexts except on `localhost`. Both Render and Vercel give you HTTPS for free, so this "just works" — but if you bring-your-own hosting, you need a real cert.
- **Symmetric NAT** (some mobile carriers) will break voice without a TURN server. Out of scope for free-tier hosting; add Twilio/Xirsys/coturn if you see voice silently failing on mobile data.
- **In-memory rooms.** A backend redeploy or restart wipes all rooms. This is by design for the free demo; migrate to Redis when you have real users.
- **Single process.** One Node instance holds every room. Horizontal scaling needs the Socket.io Redis adapter. Fine for dozens of rooms, not hundreds.
- **Free Render sleeps.** Use UptimeRobot (free) to ping `/health` every 10 min to keep the dyno warm, or accept the cold-start.
- **Socket.io CORS != Express CORS.** Both are already configured to honour `CLIENT_ORIGIN`. If you see CORS errors, double-check the exact URL (trailing slashes and schemes matter).

---

## Sanity check after deploy

```bash
# Health
curl https://ludo-backend-xyz.onrender.com/health
# -> {"ok":true,"rooms":"in-memory"}

# Open frontend in two different browsers (or one normal + one incognito).
# Create a room in the first, copy the link, paste into the second.
# Verify:
#  - Both see "server online" green dot in the top chrome
#  - Host can Start, guest is allowed to roll on their turn
#  - Voice works on same WiFi (may fail over mobile carriers w/o TURN)
```

If `online` chip shows red / "reconnecting" but `/health` returns OK, it's almost always a `CLIENT_ORIGIN` mismatch — the URL in Render must match what the browser calls the frontend exactly.
