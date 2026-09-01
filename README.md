# NPC Stat Box

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension that gives your NPC and monster tokens full stat blocks — HP tracking, dice rolling, initiative, and combat resolution — right inside a docked sidebar panel.

## Features

- **Stat cards** — AC, HP, Speed, ability scores, attacks, traits, and notes, saved directly on each token
- **Clickable dice rolls** — click an ability score or attack to roll it, with results broadcast to the whole room
- **Live HP tracking** — GM (and players, for their own tokens) can adjust current HP with a tap, synced for everyone
- **Two-token combat resolver** — select an attacker + a target, click an attack, and it automatically rolls to-hit against AC and subtracts damage from HP
- **Limited-use abilities** — track charges and recharge-on-a-roll mechanics (e.g. "Recharge 5–6") for both attacks and traits
- **Initiative tracker** — roll initiative (auto-pulling a DEX modifier, or a manual bonus for player characters), track turn order and round count, synced live for the whole table
- **Persistent roll log** — a running log of recent rolls, always visible
- **Personal NPC library** — save, load, export, and import your favorite stat blocks between sessions and campaigns
- **Visibility control** — mark any NPC's stats as GM-only or visible to everyone

## Using it in Owlbear Rodeo

If a hosted version is available, just add the install link (see the extension's store listing) to your Owlbear Rodeo profile, then enable it for your room via the room menu → Extensions.

## Self-hosting

This extension is a static site — no backend or database required. You can host your own copy for free.

### Prerequisites
- [Node.js](https://nodejs.org) (v20+)
- A [Vercel](https://vercel.com) account (or any static host — Netlify, GitHub Pages, Cloudflare Pages all work too)

### Setup

```bash
git clone https://github.com/yourname/obr-npc-stats.git
cd obr-npc-stats
npm install
npm run start   # local dev server at http://localhost:5173
```

### Deploy

```bash
npm run build
vercel --prod
```

Then in Owlbear Rodeo, add your deployed URL + `/manifest.json` as a custom extension install link, e.g.:
```
https://your-deployment.vercel.app/manifest.json
```

## How data is stored

Everything is saved directly on each token's own metadata via the Owlbear Rodeo SDK — there's no external database. Initiative turn order and round tracking use OBR's shared scene metadata, so they stay in sync for everyone at the table in real time. Your personal NPC library (for quick reuse across tokens) is saved in your browser's local storage.

## Project structure

```
├── background.html      # Invisible background page — dice roll listener, always running
├── sidebar.html          # The main docked panel (view / edit / combat / initiative)
├── src/
│   ├── sidebar.js        # All sidebar UI logic
│   ├── dice.js            # Dice rolling + broadcast helpers
│   └── Main.js            # Background script entry
├── public/
│   ├── manifest.json      # Owlbear Rodeo extension manifest
│   └── statcard.css       # Read-only stat card styling
└── vite.config.js
```

## Contributing

Issues and pull requests are welcome. This was built iteratively for a home D&D group, so there are likely rough edges — bug reports and feature suggestions are appreciated.

## License

MIT — see [LICENSE](LICENSE).
