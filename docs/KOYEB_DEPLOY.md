# Deploy the standalone Socket.IO server to Koyeb

This guide deploys `server/socket-server.js` as a persistent service on Koyeb and points the Next.js app to it.

## Prerequisites
- A Koyeb account and the GitHub repo connected (or ability to deploy from a public repo).
- Repo: this project (`elevow/table`) contains the standalone server at `server/socket-server.js`.

## Option A: Deploy using Koyeb Buildpacks (no Dockerfile)
1. In Koyeb, create a new App → Add Service.
2. Source: GitHub → select this repository and the `main` branch.
3. Build mode: Buildpacks (auto-detected Node.js).
4. Run command: `node server/socket-server.js`
   - Koyeb will set `PORT`; the server reads it automatically.
5. Expose / Health:
   - Health check path: `/health` (expects 200 JSON `{ ok: true }`).
6. Environment variables (optional):
   - `SOCKET_IO_PATH=/socket.io` (default is `/socket.io` if unset).
   - `NODE_ENV=production`.
7. Resources: 1 instance, autoscale off (enable later if needed).
8. Deploy. Wait for the service URL like `https://<service-name>-<random>.koyeb.app`.

If Koyeb shows a Buildpacks error mentioning `heroku-postbuild` or `node socket-server.js` at repo root, ensure:
- Your repository contains a `Procfile` with: `web: node server/socket-server.js` (already added).
- Your `package.json` has no breaking `heroku-postbuild` step; this repo ships a no-op one to avoid this.

## Option B: Deploy with Dockerfile (optional)
If you prefer Docker:
1. Create a new Service → Dockerfile build.
2. Use this repo as source and point to the root Dockerfile (if you add one) or specify path.
3. Ensure the image runs `node server/socket-server.js` and listens on `$PORT`.

> Note: Buildpacks (Option A) are simpler and work well here; a Dockerfile is not required.

## Verify the service
- Open `https://<your-service>.koyeb.app/health` → should return `{ ok: true }`.
- The Socket.IO endpoint will be at `https://<your-service>.koyeb.app/socket.io/`.

## Wire the frontend (Next.js) to the external server
Set these environment variables in your Next.js hosting platform (e.g., Vercel) and redeploy:
- `NEXT_PUBLIC_SOCKET_IO_URL=https://<your-service>.koyeb.app`
- `NEXT_PUBLIC_SOCKET_IO_PATH=/socket.io` (optional; default is `/socket.io`)
- `NEXT_PUBLIC_SOCKET_IO_FORCE_POLLING=1` (optional; use `0` to allow websockets; Koyeb supports websockets)
- Ensure `NEXT_PUBLIC_DISABLE_SOCKETS=0` (or remove it) to enable realtime features.

After deploy, open the game page and check the browser console: you should see a connected transport (`websocket` or `polling`) and seat events syncing across browsers.

## Troubleshooting
- 502/timeout during deploy: Verify the Run command is `node server/socket-server.js` and logs show `listening on :<PORT>`.
- Path mismatch: If the client path and server `SOCKET_IO_PATH` differ, connections will fail. Keep `/socket.io` on both sides.
- CORS: The server allows all origins by default (`cors: { origin: '*' }`). If you need to restrict, set `origin` to your domain.
- Forced polling vs websockets: If corporate proxies block websockets, set `NEXT_PUBLIC_SOCKET_IO_FORCE_POLLING=1`.

## Optional: Custom domain
- In Koyeb, add a custom domain to the service for a cleaner URL.
- Update `NEXT_PUBLIC_SOCKET_IO_URL` to the custom domain.

---

That’s it — the standalone Socket.IO server will run continuously on Koyeb, and your Next.js app will use it for realtime seating and game events.
