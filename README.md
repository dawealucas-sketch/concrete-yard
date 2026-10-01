# Concrete Yard — a browser multiplayer FPS

A small first-person shooter for 5–20 players. The server runs on Node.js;
players join by opening a web page.

## Files

- `server.js` — the game server. Tracks players, decides whether shots hit, sends updates.
- `public/index.html` — the page players see (start screen and on-screen display).
- `public/game.js` — the 3D game in the browser (drawing, controls, talking to the server).
- `public/map.js` — the arena layout, shared by server and browser.
- `package.json` — lists the libraries the project needs.

## Run it on your computer

1. Install Node.js (version 18 or newer) from https://nodejs.org
2. Open a terminal in this folder.
3. Run `npm install` (downloads express, socket.io and three.js).
4. Run `npm start`.
5. Open http://localhost:3000 in your browser.

To test multiplayer alone, open a second browser window to the same address.

## Play with others on the same Wi-Fi

Find your computer's local IP address (for example 192.168.1.20) and have
others open `http://192.168.1.20:3000`. Your firewall may ask to allow Node.js.

## Put it online

Any host that runs Node.js and supports WebSockets works, for example a small
VPS (DigitalOcean, Linode, Hetzner) or a platform like Render, Railway or Fly.io.
The server reads the port from the `PORT` environment variable.

On a VPS, a typical setup is:
1. Copy the folder to the server, run `npm install`.
2. Run it with a process manager so it stays up: `npx pm2 start server.js`.
3. Pick a server region close to your players; distance adds delay.

## Things to change first

- Game settings: top of `server.js` (damage, fire rate, respawn time, max players).
- Movement feel: top of `public/game.js` (speed, jump, mouse sensitivity).
- The arena: add or move boxes in `public/map.js`. Both sides pick up the change.

## Known limits of this starter

- Each browser reports its own position. The server rejects impossible speeds,
  but a determined cheater could still fly or walk through walls. Fixing this
  means moving all movement logic to the server.
- No lag compensation: on high-ping connections you need to lead your shots a little.
- One match for everyone; there are no separate rooms or lobbies yet.
