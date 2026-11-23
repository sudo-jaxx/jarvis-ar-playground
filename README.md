# JARVIS AR Playground — Cloudflare prototype

Cloudflare Workers + static assets + SQLite-backed Durable Object WebSocket room. No Linux server required. The camera runs MediaPipe in iPhone Safari. A Chromebook runs the display and Star Catch game. Up to four detected poses (not guaranteed stable player identities). Choose skeleton avatars or a low-resolution live camera AR background.

## Deploy

1. Install Node.js on any development machine (or use GitHub Codespaces). In this directory run `npm install`.
2. Authenticate with `npx wrangler login`.
3. Run `npm run deploy`. Wrangler prints a workers.dev URL. You can also use `npm run dev` for development on the same computer.
4. In Cloudflare Dashboard, Workers & Pages > your Worker > Settings > Domains & Routes, add your domain/subdomain as a **Custom Domain**. Cloudflare must manage DNS for the domain.
5. Open your HTTPS site on the Chromebook. Click **Create game room**. Open the private camera link on iPhone Safari, tap **Start rear camera**, and grant camera permission.
6. Choose Animated avatars or Camera AR on the display. Reach your hand toward stars to score.

## Architecture and constraints

- The Worker serves static files and handles `/api/create`. Each session gets one Durable Object for WebSocket relaying.
- Separate random credentials for the display and camera. The private camera URL is stored only in the creating browser's `sessionStorage` and is not shown in public routes.
- Camera uses MediaPipe Tasks Vision (loaded from jsDelivr) and Google's pose model (loaded from Google storage) on first use. An internet connection is needed for these dependencies unless self-hosted. MediaPipe CDN version is pinned, but deployment should vendor dependencies for production.
- Pose data is sent around 10 fps. In AR mode, low-resolution JPEG preview frames are also relayed. This is **not** high-quality video or true 3D AR; it is a 2D camera-background overlay prototype.
- Players are numbered by pose detection order. They can swap IDs when crossing paths or disappearing. A future tracker should associate people over time.
- Cloudflare is used for transport even if both devices are on the same Wi-Fi. Direct LAN/IP/WebRTC is **not implemented** in this version.
- One camera and one display per room. The game runs in the display browser, not on Cloudflare.
- Room credentials are capabilities: anyone with the URL can access that role. No login, session expiration, content moderation, or rate limits are included. **Do not share camera links publicly**. For production, add Cloudflare Access or another authentication layer, session expiration, quotas, and origin checks.
- WebSocket connection lifecycle in this minimal DO uses in-memory client references, so idle hibernation and instance restarts may interrupt sessions. Clients reconnect; a restarted room may need a new session.
- iOS Safari camera requires HTTPS and an active foreground tab. Keep the phone awake and plugged in for long sessions.

## Next improvements

Persistent player ID assignment; calibration; faster camera/video transport with WebRTC; browser-independent host reconnect tokens; game selection and multiple minigames; offline-hosted pose models; auth and rate limiting; direct LAN fallback.
