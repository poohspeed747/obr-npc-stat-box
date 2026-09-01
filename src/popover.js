import OBR from "@owlbear-rodeo/sdk";
import { rollAbilityCheck, rollAttack, rollDiceExpression, announceRoll } from "./dice.js";

const PLUGIN_ID = "com.yourname.npcstatbox";

// ── URL helpers ───────────────────────────────────────────────────────────
function getNPCData() {
  const raw = new URLSearchParams(window.location.search).get("npc");
  try { return raw ? JSON.parse(decodeURIComponent(raw)) : null; }
  catch { return null; }
}

function getTokenId() {
  return new URLSearchParams(window.location.search).get("token");
}

// ── Render ────────────────────────────────────────────────────────────────
function render(npc) {
  document.getElementById("npc-name").textContent    = npc.name     ?? "Unknown Creature";
  document.getElementById("npc-subtitle").textContent = npc.subtitle ?? "";

  document.getElementById("npc-ac").textContent    = npc.ac  ?? "—";
  document.getElementById("npc-hp").textContent    = npc.hp  ?? "—";
  document.getElementById("npc-speed").textContent = npc.speed != null ? `${npc.speed} ft.` : "—";

  renderAbility("str", npc.str, npc.name);
  renderAbility("dex", npc.dex, npc.name);
  renderAbility("con", npc.con, npc.name);
  renderAbility("int", npc.int, npc.name);
  renderAbility("wis", npc.wis, npc.name);
  renderAbility("cha", npc.cha, npc.name);

  const attackSection = document.getElementById("attacks");
  if (npc.attacks?.length) {
    attackSection.innerHTML = "<h2>Actions</h2>";
    npc.attacks.forEach((a, i) => {
      const rowId = `atk-${i}`;
      attackSection.innerHTML += `
        <div class="entry attack-entry">
          <button class="roll-trigger atk-name-btn" data-idx="${i}">
            <strong>${esc(a.name)}.</strong> +${a.bonus} to hit, ${esc(a.damage)}
          </button>
        </div>`;
    });

    // Wire up click handlers after the HTML is in the DOM
    attackSection.querySelectorAll(".atk-name-btn").forEach((btn, i) => {
      btn.addEventListener("click", () => handleAttackClick(npc, npc.attacks[i]));
    });
  }

  const abilitySection = document.getElementById("abilities");
  if (npc.abilities?.length) {
    abilitySection.innerHTML = "<h2>Abilities</h2>";
    npc.abilities.forEach(ab => {
      abilitySection.innerHTML += `
        <div class="entry">
          <strong>${esc(ab.name)}.</strong> ${esc(ab.text)}
        </div>`;
    });
  }

  if (npc.notes) {
    document.getElementById("notes").innerHTML =
      `<h2>Notes</h2><div class="entry">${esc(npc.notes)}</div>`;
  }
}

/** Render one ability score as a clickable button showing "10 (+0)" */
function renderAbility(stat, score, npcName) {
  const el = document.getElementById(stat);
  if (score == null) {
    el.textContent = "—";
    return;
  }
  const mod = Math.floor((score - 10) / 2);
  el.innerHTML = `<button class="roll-trigger ability-btn">${score} (${mod >= 0 ? "+" : ""}${mod})</button>`;
  el.querySelector(".ability-btn").addEventListener("click", () => handleAbilityClick(stat, score, npcName));
}

// ── Roll handlers ─────────────────────────────────────────────────────────
async function handleAbilityClick(stat, score, npcName) {
  const { die, mod, total } = rollAbilityCheck(score);
  const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
  const label = stat.toUpperCase();
  const message = `🎲 ${npcName || "NPC"} — ${label} Check: ${die} ${modStr} = ${total}`;
  await announceRoll(message);
}

async function handleAttackClick(npc, attack) {
  const { die, bonus, total } = rollAttack(attack.bonus);
  const toHitMsg = `⚔ ${npc.name || "NPC"} — ${attack.name}: ${die} +${bonus} = ${total} to hit`;
  await announceRoll(toHitMsg);

  // Small delay so the two messages land as separate, readable notifications
  setTimeout(async () => {
    const dmg = rollDiceExpression(attack.damage);
    if (dmg.total != null) {
      const dmgMsg = `💥 ${npc.name || "NPC"} — ${attack.name} damage: ${dmg.rolls.join("+")}${dmg.modifier ? (dmg.modifier >= 0 ? "+" : "") + dmg.modifier : ""} = ${dmg.total}`;
      await announceRoll(dmgMsg);
    }
  }, 600);
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Visibility toggle (GM only) ───────────────────────────────────────────
async function setupVisibilityToggle(npc) {
  const role = await OBR.player.getRole();
  if (role !== "GM") return;

  const toggleContainer = document.getElementById("visibility-toggle");
  const checkbox        = document.getElementById("toggle-visibility");
  const label           = document.getElementById("toggle-label");

  toggleContainer.style.display = "flex";
  checkbox.checked  = npc.visibility === "all";
  label.textContent = checkbox.checked ? "Visible to All" : "GM Only";

  checkbox.addEventListener("change", async () => {
    const newValue = checkbox.checked ? "all" : "gm";
    label.textContent = checkbox.checked ? "Visible to All" : "GM Only";

    const tokenId = getTokenId();
    if (!tokenId) return;

    await OBR.scene.items.updateItems([tokenId], (items) => {
      for (const item of items) {
        if (!item.metadata) item.metadata = {};
        item.metadata[`${PLUGIN_ID}/npc`] = { ...npc, visibility: newValue };
      }
    });
  });
}

// ── Entry point ───────────────────────────────────────────────────────────
OBR.onReady(async () => {
  const npc = getNPCData();

  if (!npc) {
    document.getElementById("npc-name").textContent = "No stat data found.";
    return;
  }

  const role = await OBR.player.getRole();
  if (role !== "GM" && npc.visibility !== "all") {
    document.getElementById("npc-name").textContent = "Only the GM can see this card.";
    document.getElementById("npc-subtitle").textContent = "";
    return;
  }

  render(npc);
  await setupVisibilityToggle(npc);
});