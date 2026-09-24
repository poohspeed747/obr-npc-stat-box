# NPC Stat Box

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension that gives your NPC and monster tokens full stat blocks — HP tracking, dice rolling, initiative, and combat resolution — right inside a docked sidebar panel.

![Stat card view](https://obr-npc-stats.vercel.app/Stat_Card_View.png)

**Contents:** [Features](#features) · [Installing](#installing) · [How to use it](#how-to-use-it) · [Self-hosting](#self-hosting) · [How data is stored](#how-data-is-stored) · [Project structure](#project-structure) · [Contributing](#contributing) · [License](#license)

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

## Installing

1. Add the install link to your Owlbear Rodeo profile (see the extension's store listing). If you are adding it as a custom extension, use:
   ```
   https://obr-npc-stats.vercel.app/manifest.json
   ```
2. Enable it for your room via the room menu → **Extensions**.
3. Click the toolbar action to open the sidebar panel.
4. Select a token to view its stats or, as GM, edit them.

## How to use it

### Viewing a stat card

Select any token that has a stat block and the sidebar shows its card: AC, HP, Speed, ability scores, attacks, and traits. Stats are saved on the token itself, so they travel with it. The GM can mark a token's stats as GM-only or visible to everyone.

![Stat card view](https://obr-npc-stats.vercel.app/Stat_Card_View.png)

### Rolling dice

Click an ability score to roll a check, or click an attack to roll to-hit and damage. Every roll is broadcast to the room and added to the roll log at the bottom of the panel, so nobody misses what just happened.

### Adjusting HP

Use the quick +/- controls on the card to change current HP. The GM can adjust any token, and players can adjust their own. Changes sync live for everyone.

### Resolving combat

1. Select the **attacker** and the **target** tokens.
2. Click one of the attacker's attacks.
3. The extension rolls to-hit against the target's AC, and on a hit rolls damage and subtracts it from the target's HP.

![Combat resolution](https://obr-npc-stats.vercel.app/Combat_resolution.png)

Attacks and traits with limited uses show a charge count, and "Recharge 5–6" style abilities can be rolled to see if they come back.

### Running initiative

Roll initiative for the whole party from the initiative tracker. NPCs automatically use their DEX modifier, and player characters can use a manual bonus. The tracker keeps turn order and the round count, and it is synced live for everyone at the table.

![Initiative tracker](https://obr-npc-stats.vercel.app/Inish_Tracker.png)

### Reusing your favorite monsters

Save any stat block to your personal NPC library, then load it onto a new token in any scene or campaign. You can also export your library to a file and import it elsewhere.

## Self-hosting

This extension is a static site — no backend or database required. You can host your own copy for free.

### Prerequisites
- [Node.js](https://nodejs.org) (v20+)
- A [Vercel](https://vercel.com) account (or any static host — Netlify, GitHub Pages, Cloudflare Pages all work too)

### Setup

```bash
git clone https://github.com/poohspeed747/obr-npc-stat-box.git
cd obr-npc-stat-box
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
├── sidebar.html         # The main docked panel (view / edit / combat / initiative)
├── src/
│   ├── sidebar.js       # All sidebar UI logic
│   ├── dice.js          # Dice rolling + broadcast helpers
│   └── Main.js          # Background script entry
├── public/
│   ├── manifest.json    # Owlbear Rodeo extension manifest
│   ├── statcard.css     # Read-only stat card styling
│   └── *.png            # Screenshots used in this README
└── vite.config.js
```

## Contributing

Issues and pull requests are welcome. This was built iteratively for a home D&D group, so there are likely rough edges — bug reports and feature suggestions are appreciated.

## License

MIT — see [LICENSE](LICENSE).
