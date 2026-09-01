import OBR from "@owlbear-rodeo/sdk";
import { rollAbilityCheck, rollAttack, rollDiceExpression, rollRecharge, announceRoll, ROLL_CHANNEL } from "./dice.js";

const PLUGIN_ID = "com.yourname.npcstatbox";
const LIBRARY_KEY = `${PLUGIN_ID}/library`;
const INIT_KEY = `${PLUGIN_ID}/initiative`;
const INIT_BONUS_KEY = `${PLUGIN_ID}/initBonus`;
const TURN_KEY = `${PLUGIN_ID}/turn`;

let currentTokenId = null;
let currentTokenOwnerId = null;
let currentNpc = null;
let currentVisibility = "gm";
let isGM = false;
let mode = "view"; // "view" | "edit"

let sceneTurnMeta = { currentId: null, round: 1 };
let lastItemsSnapshot = [];
let currentTokenName = "";
let currentInitBonus = 0;
let currentInitValue = null;

const ROLL_LOG_MAX = 15;
let rollLog = [];

// ── Expose globals for inline onclick handlers ─────────────────────────────
window.updateMod         = updateMod;
window.addAttack         = addAttack;
window.addAbility        = addAbility;
window.clearForm         = clearForm;
window.saveStats         = saveStats;
window.saveToLibrary     = saveToLibrary;
window.loadFromLibrary   = loadFromLibrary;
window.deleteFromLibrary = deleteFromLibrary;
window.exportLibrary     = exportLibrary;
window.importLibrary     = importLibrary;
window.setVisibilityAndSave = setVisibilityAndSave;

// ── Init ────────────────────────────────────────────────────────────────
OBR.onReady(async () => {
  isGM = (await OBR.player.getRole()) === "GM";

  if (isGM) {
    document.getElementById("mode-toggle").style.display = "flex";
    document.getElementById("mode-view").addEventListener("click", () => switchMode("view"));
    document.getElementById("mode-edit").addEventListener("click", () => switchMode("edit"));
    refreshLibraryDropdown();
  }

  document.getElementById("roll-log-toggle").addEventListener("click", () => {
    document.getElementById("roll-log").classList.toggle("collapsed");
  });

  document.getElementById("init-toggle").addEventListener("click", () => {
    document.getElementById("init-panel").classList.toggle("collapsed");
  });

  if (isGM) {
    document.getElementById("init-controls").style.display = "flex";
    document.getElementById("init-roll-selected").addEventListener("click", rollInitiativeForSelected);
    document.getElementById("init-next-turn").addEventListener("click", nextTurn);
    document.getElementById("init-clear-all").addEventListener("click", clearInitiative);
  }

  OBR.broadcast.onMessage(ROLL_CHANNEL, (event) => {
    const { message } = event.data ?? {};
    if (message) addRollLogEntry(message);
  });

  // Initiative: shared state synced for everyone via scene metadata + item metadata
  const savedTurnMeta = await OBR.scene.getMetadata();
  if (savedTurnMeta[TURN_KEY]) sceneTurnMeta = savedTurnMeta[TURN_KEY];

  OBR.scene.onMetadataChange((metadata) => {
    sceneTurnMeta = metadata[TURN_KEY] ?? { currentId: null, round: 1 };
    renderInitiative();
  });

  OBR.scene.items.onChange((items) => {
    lastItemsSnapshot = items;
    renderInitiative();
  });

  const initialItems = await OBR.scene.items.getItems();
  lastItemsSnapshot = initialItems;
  renderInitiative();

  OBR.player.onChange(async (player) => {
    const sel = player.selection ?? [];
    if (sel.length === 2) {
      await loadCombat(sel[0], sel[1]);
    } else if (sel.length === 1) {
      await loadToken(sel[0]);
    } else {
      showNoToken(sel.length === 0 ? "No token selected" : "Select one or two tokens");
    }
  });

  const sel = (await OBR.player.getSelection()) ?? [];
  if (sel.length === 2) {
    await loadCombat(sel[0], sel[1]);
  } else if (sel.length === 1) {
    await loadToken(sel[0]);
  } else {
    showNoToken("No token selected");
  }
});

// ── Load token ──────────────────────────────────────────────────────────
async function loadToken(tokenId) {
  const items = await OBR.scene.items.getItems([tokenId]);
  const token = items[0];
  if (!token) return;

  currentTokenId = tokenId;
  currentTokenOwnerId = token.createdUserId ?? null;
  const npc = token.metadata?.[`${PLUGIN_ID}/npc`] ?? null;

  // Default currentHp to max HP if it's never been set on this token
  if (npc && npc.currentHp == null && npc.hp != null) {
    npc.currentHp = npc.hp;
  }
  currentNpc = npc;

  const tokenName = token.name || token.text?.plainText || "Unnamed Token";
  currentTokenName = tokenName;
  currentInitBonus = token.metadata?.[INIT_BONUS_KEY] ?? 0;
  currentInitValue = token.metadata?.[INIT_KEY] ?? null;

  document.getElementById("token-label").textContent = tokenName;
  document.getElementById("no-token-msg").style.display = "none";

  const isOwnToken = currentTokenOwnerId != null && currentTokenOwnerId === OBR.player.id;

  if (!isGM) {
    // Players can always see their own token, even if the GM hasn't built
    // out a full stat block for it yet — they still get name/HP/initiative.
    if (!npc && !isOwnToken) { showNoToken("This token has no stats."); return; }
    if (npc && npc.visibility !== "all" && !isOwnToken) { showNoToken("Only the GM can see this token's stats."); return; }
    showViewCard(npc ?? {}, tokenName);
    return;
  }

  if (mode === "edit") {
    showEditForm(npc ?? {});
  } else if (npc) {
    showViewCard(npc, tokenName);
  } else {
    switchMode("edit");
    showEditForm({});
  }
}

// ── COMBAT (two tokens selected: attacker vs target) ───────────────────────
let combatAttackerId = null;
let combatTargetId = null;
let combatAttackerNpc = null;
let combatTargetNpc = null;
let combatAttackerTokenName = "";
let combatTargetTokenName = "";

async function loadCombat(idA, idB) {
  const items = await OBR.scene.items.getItems([idA, idB]);
  const tokenA = items.find(i => i.id === idA);
  const tokenB = items.find(i => i.id === idB);
  if (!tokenA || !tokenB) { showNoToken("Couldn't load both tokens"); return; }

  const npcA = tokenA.metadata?.[`${PLUGIN_ID}/npc`] ?? null;
  const npcB = tokenB.metadata?.[`${PLUGIN_ID}/npc`] ?? null;

  if (!npcA && !npcB) {
    showNoToken("Neither token has stats saved yet.");
    return;
  }

  // Pick whichever token has attacks as the default attacker; the other is the target.
  const aHasAttacks = npcA?.attacks?.length > 0;
  const bHasAttacks = npcB?.attacks?.length > 0;

  let attackerId, targetId, attackerNpc, targetNpc, attackerToken, targetToken;
  if (bHasAttacks && !aHasAttacks) {
    attackerId = idB; targetId = idA; attackerNpc = npcB; targetNpc = npcA;
    attackerToken = tokenB; targetToken = tokenA;
  } else {
    attackerId = idA; targetId = idB; attackerNpc = npcA; targetNpc = npcB;
    attackerToken = tokenA; targetToken = tokenB;
  }

  // Non-GM players can only use their own token as the attacker.
  if (!isGM && attackerToken.createdUserId !== OBR.player.id) {
    // Try the other token as attacker instead, if it's theirs
    if (targetToken.createdUserId === OBR.player.id) {
      [attackerId, targetId] = [targetId, attackerId];
      [attackerNpc, targetNpc] = [targetNpc, attackerNpc];
      [attackerToken, targetToken] = [targetToken, attackerToken];
    } else {
      showNoToken("Select one of your own tokens to attack with.");
      return;
    }
  }

  combatAttackerId = attackerId;
  combatTargetId = targetId;
  combatAttackerNpc = attackerNpc;
  combatTargetNpc = targetNpc;
  combatAttackerTokenName = attackerToken.name || attackerToken.text?.plainText || "Attacker";
  combatTargetTokenName = targetToken.name || targetToken.text?.plainText || "Target";

  if (targetNpc && targetNpc.currentHp == null && targetNpc.hp != null) {
    targetNpc.currentHp = targetNpc.hp;
  }

  document.getElementById("view-card-wrapper").style.display = "none";
  document.getElementById("editor").style.display = "none";
  document.getElementById("no-token-msg").style.display = "none";
  document.getElementById("token-label").textContent = "";
  document.getElementById("combat-panel").style.display = "block";

  document.getElementById("combat-swap").onclick = () => {
    loadCombat(combatTargetId, combatAttackerId);
  };

  renderCombat();
}

function renderCombat() {
  document.getElementById("combat-attacker-name").textContent = combatAttackerNpc?.name || combatAttackerTokenName;
  document.getElementById("combat-target-name").textContent = combatTargetNpc?.name || combatTargetTokenName;

  // GM always sees full target info. Players only see AC/HP if the target's
  // visibility is set to "all" — same rule as the single-token stat card.
  const canSeeTargetStats = isGM || combatTargetNpc?.visibility === "all";

  const acEl = document.getElementById("combat-target-ac");
  const hpEl = document.getElementById("combat-target-hp");

  if (!canSeeTargetStats) {
    acEl.textContent = "AC hidden";
    hpEl.textContent = "HP hidden";
  } else if (combatTargetNpc?.ac != null) {
    acEl.textContent = `AC ${combatTargetNpc.ac}`;
    const cur = combatTargetNpc.currentHp ?? combatTargetNpc.hp;
    hpEl.textContent = combatTargetNpc?.hp != null ? `HP ${cur} / ${combatTargetNpc.hp}` : "";
  } else {
    acEl.textContent = "No AC set";
    hpEl.textContent = "";
  }

  const attacksEl = document.getElementById("combat-attacks");
  const noteEl = document.getElementById("combat-note");
  attacksEl.innerHTML = "";
  noteEl.textContent = "";

  if (!combatAttackerNpc?.attacks?.length) {
    noteEl.textContent = "The attacker has no attacks saved.";
    return;
  }
  if (combatTargetNpc?.ac == null) {
    noteEl.textContent = "The target has no AC set, so hit/miss can't be resolved.";
  }

  combatAttackerNpc.attacks.forEach((atk, i) => {
    const state = chargeState(atk);
    const chargeLabel = state ? ` (${state.cur}/${state.max})` : "";

    const btn = document.createElement("button");
    btn.className = "combat-attack-btn";
    btn.textContent = `${atk.name} — +${atk.bonus} to hit, ${atk.damage}${chargeLabel}`;
    if (state?.depleted) {
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => resolveCombatAttack(atk));
    }
    attacksEl.appendChild(btn);

    if (state?.depleted && atk.rechargeMin != null) {
      const rBtn = document.createElement("button");
      rBtn.className = "combat-attack-btn recharge-btn";
      rBtn.textContent = `🔁 Recharge ${atk.name} (d6 ≥ ${atk.rechargeMin})`;
      rBtn.addEventListener("click", () => resolveCombatRecharge(atk));
      attacksEl.appendChild(rBtn);
    }
  });
}

async function resolveCombatRecharge(attack) {
  const result = rollRecharge(6, attack.rechargeMin);
  const attackerName = combatAttackerNpc.name || combatAttackerTokenName;

  if (result.success) {
    await announceRoll(`🔁 ${attackerName} — ${attack.name} recharges! (rolled ${result.die})`);
    const updatedAttacks = combatAttackerNpc.attacks.map(a =>
      a === attack ? { ...a, currentCharges: a.charges } : a
    );
    combatAttackerNpc = { ...combatAttackerNpc, attacks: updatedAttacks };
    await writeNPCToTokenId(combatAttackerId, combatAttackerNpc);
    renderCombat();
  } else {
    await announceRoll(`🔁 ${attackerName} — ${attack.name} fails to recharge (rolled ${result.die})`);
  }
}

async function resolveCombatAttack(attack) {
  const { die, bonus, total } = rollAttack(attack.bonus);
  const attackerName = combatAttackerNpc.name || combatAttackerTokenName;
  const targetName = combatTargetNpc?.name || combatTargetTokenName;
  const targetAc = combatTargetNpc?.ac;
  const canSeeTargetStats = isGM || combatTargetNpc?.visibility === "all";
  const hasCharges = chargeState(attack) != null;

  if (targetAc == null) {
    await announceRoll(`⚔ ${attackerName} — ${attack.name}: ${die} +${bonus} = ${total} to hit (no target AC set)`);
    if (hasCharges) await consumeCombatCharge(attack);
    return;
  }

  const hit = total >= targetAc;

  // Hit/miss messages never reveal HP, so they're always safe to broadcast fully.
  // AC itself is only shown in the broadcast if the target's stats are visible.
  const vsText = canSeeTargetStats ? ` vs AC ${targetAc}` : "";

  if (!hit) {
    await announceRoll(`⚔ ${attackerName} — ${attack.name}: ${die} +${bonus} = ${total}${vsText} — MISS`);
    if (hasCharges) await consumeCombatCharge(attack);
    return;
  }

  await announceRoll(`⚔ ${attackerName} — ${attack.name}: ${die} +${bonus} = ${total}${vsText} — HIT!`);
  if (hasCharges) await consumeCombatCharge(attack);

  const dmg = rollDiceExpression(attack.damage);
  if (dmg.total == null) return;

  setTimeout(async () => {
    const modStr = dmg.modifier ? (dmg.modifier >= 0 ? "+" : "") + dmg.modifier : "";
    const max = combatTargetNpc.hp ?? null;
    const curBefore = combatTargetNpc.currentHp ?? max ?? 0;
    const curAfter = max != null ? Math.max(0, curBefore - dmg.total) : curBefore;

    // Damage dealt this hit is fine to show everyone (players usually see damage
    // rolls in TTRPGs). What we hide is the target's exact current/max HP total
    // when that NPC's visibility is set to GM Only.
    let msg = `💥 ${targetName} takes ${dmg.rolls.join("+")}${modStr} = ${dmg.total} damage from ${attack.name}`;
    if (max != null && canSeeTargetStats) {
      msg += ` (${curAfter} / ${max} HP)`;
    }
    if (max != null && curAfter === 0) {
      msg += ` — ${targetName} is down!`;
    }
    await announceRoll(msg);

    if (max != null) {
      combatTargetNpc = { ...combatTargetNpc, currentHp: curAfter };
      await writeNPCToTokenId(combatTargetId, combatTargetNpc);
      renderCombat();
    }
  }, 600);
}

function showNoToken(msg) {
  currentTokenId = null;
  currentNpc = null;
  document.getElementById("token-label").textContent = msg;
  document.getElementById("view-card-wrapper").style.display = "none";
  document.getElementById("editor").style.display = "none";
  document.getElementById("combat-panel").style.display = "none";
  document.getElementById("no-token-msg").style.display = "flex";
}

function switchMode(newMode) {
  mode = newMode;
  document.getElementById("mode-view").classList.toggle("active", mode === "view");
  document.getElementById("mode-edit").classList.toggle("active", mode === "edit");

  if (!currentTokenId) return;
  if (mode === "edit") {
    showEditForm(currentNpc ?? {});
  } else if (currentNpc) {
    showViewCard(currentNpc, document.getElementById("token-label").textContent);
  } else {
    showNoToken("No stats saved for this token yet.");
  }
}

// ── READ-ONLY VIEW ──────────────────────────────────────────────────────
function showViewCard(npc, tokenName) {
  document.getElementById("editor").style.display = "none";
  document.getElementById("combat-panel").style.display = "none";
  document.getElementById("no-token-msg").style.display = "none";
  document.getElementById("view-card-wrapper").style.display = "block";
  document.getElementById("token-label").textContent = tokenName;
  renderCard(npc);
}

function renderCard(npc) {
  document.getElementById("npc-name").textContent = npc.name || currentTokenName || "Unknown Creature";
  document.getElementById("npc-subtitle").textContent = npc.subtitle ?? "";
  document.getElementById("npc-ac").textContent = npc.ac ?? "—";
  document.getElementById("npc-speed").textContent = npc.speed != null ? `${npc.speed} ft.` : "—";

  const canManage = isGM || (currentTokenOwnerId != null && currentTokenOwnerId === OBR.player.id);
  renderHp(npc, canManage);
  renderInitiativeControls(canManage);

  renderAbility("str", npc.str, npc.name);
  renderAbility("dex", npc.dex, npc.name);
  renderAbility("con", npc.con, npc.name);
  renderAbility("int", npc.int, npc.name);
  renderAbility("wis", npc.wis, npc.name);
  renderAbility("cha", npc.cha, npc.name);

  const attackSection = document.getElementById("attacks");
  attackSection.innerHTML = "";
  if (npc.attacks?.length) {
    attackSection.innerHTML = "<h2>Actions</h2>";
    npc.attacks.forEach((a, i) => {
      const state = chargeState(a);
      const chargeLabel = state ? ` <span class="charge-badge">(${state.cur}/${state.max})</span>` : "";
      const disabledAttr = state?.depleted ? "disabled" : "";
      const rechargeBtn = state?.depleted && a.rechargeMin != null
        ? `<button class="recharge-btn" data-idx="${i}">🔁 Recharge (d6 ≥ ${a.rechargeMin})</button>`
        : "";
      attackSection.innerHTML += `
        <div class="entry attack-entry">
          <button class="roll-trigger atk-name-btn" data-idx="${i}" ${disabledAttr}>
            <strong>${esc(a.name)}.</strong> +${a.bonus} to hit, ${esc(a.damage)}${chargeLabel}
          </button>
          ${rechargeBtn}
        </div>`;
    });
    attackSection.querySelectorAll(".atk-name-btn").forEach((btn, i) => {
      btn.addEventListener("click", () => handleAttackClick(npc, npc.attacks[i]));
    });
    attackSection.querySelectorAll(".recharge-btn").forEach((btn) => {
      const i = parseInt(btn.dataset.idx);
      btn.addEventListener("click", () => handleRechargeClick(npc, npc.attacks[i]));
    });
  }

  const abilitySection = document.getElementById("abilities");
  abilitySection.innerHTML = "";
  if (npc.abilities?.length) {
    abilitySection.innerHTML = "<h2>Abilities</h2>";
    npc.abilities.forEach((ab, i) => {
      const state = chargeState(ab);
      if (!state) {
        // No charges tracked — plain text entry, same as before.
        abilitySection.innerHTML += `<div class="entry"><strong>${esc(ab.name)}.</strong> ${esc(ab.text)}</div>`;
        return;
      }
      const chargeLabel = ` <span class="charge-badge">(${state.cur}/${state.max})</span>`;
      const disabledAttr = state.depleted ? "disabled" : "";
      const rechargeBtn = state.depleted && ab.rechargeMin != null
        ? `<button class="recharge-btn" data-idx="${i}">🔁 Recharge (d6 ≥ ${ab.rechargeMin})</button>`
        : "";
      abilitySection.innerHTML += `
        <div class="entry attack-entry">
          <button class="roll-trigger atk-name-btn abl-use-btn" data-idx="${i}" ${disabledAttr}>
            <strong>${esc(ab.name)}.</strong>${chargeLabel}<br>${esc(ab.text)}
          </button>
          ${rechargeBtn}
        </div>`;
    });
    abilitySection.querySelectorAll(".abl-use-btn").forEach((btn) => {
      const i = parseInt(btn.dataset.idx);
      btn.addEventListener("click", () => handleAbilityUseClick(npc, npc.abilities[i]));
    });
    abilitySection.querySelectorAll(".recharge-btn").forEach((btn) => {
      const i = parseInt(btn.dataset.idx);
      btn.addEventListener("click", () => handleAbilityRechargeClick(npc, npc.abilities[i]));
    });
  }

  const notesSection = document.getElementById("notes");
  notesSection.innerHTML = "";
  if (npc.notes) {
    notesSection.innerHTML = `<h2>Notes</h2><div class="entry">${esc(npc.notes)}</div>`;
  }
}

// ── HP tracker (current / max, with +/- buttons) ───────────────────────────
function renderHp(npc, canEdit) {
  const el = document.getElementById("npc-hp");
  const max = npc.hp ?? null;
  const cur = npc.currentHp ?? max;

  if (max == null) {
    el.textContent = "—";
    return;
  }

  const pct = max > 0 ? cur / max : 0;
  const color = pct <= 0 ? "#7a5c5c" : pct <= 0.25 ? "#b23a3a" : pct <= 0.5 ? "#a06a1a" : "#2f7a3a";

  if (canEdit) {
    el.innerHTML = `
      <span class="hp-controls">
        <button class="hp-btn" id="hp-minus">−</button>
        <span class="hp-value" style="color:${color}">${cur} / ${max}</span>
        <button class="hp-btn" id="hp-plus">+</button>
      </span>`;
    document.getElementById("hp-minus").addEventListener("click", () => adjustHp(npc, -1, canEdit));
    document.getElementById("hp-plus").addEventListener("click", () => adjustHp(npc, +1, canEdit));
  } else {
    el.innerHTML = `<span class="hp-value" style="color:${color}">${cur} / ${max}</span>`;
  }
}

async function adjustHp(npc, delta, canEdit) {
  const max = npc.hp ?? 0;
  const cur = npc.currentHp ?? max;
  const next = Math.max(0, Math.min(max, cur + delta));
  if (next === cur) return;

  const updated = { ...npc, currentHp: next };
  currentNpc = updated;
  await writeNPCToToken(updated);
  renderHp(updated, canEdit);
}

// ── Initiative controls on the stat card (own token or GM) ────────────────
function renderInitiativeControls(canManage) {
  const el = document.getElementById("card-init");
  if (!el) return;

  if (!canManage) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";

  const rolledText = currentInitValue != null ? `Rolled: ${currentInitValue}` : "Not rolled yet";
  el.innerHTML = `
    <div class="card-init-row">
      <label>Init Bonus</label>
      <input id="card-init-bonus" type="number" value="${currentInitBonus}" />
      <button class="roll-trigger card-init-roll" id="card-init-roll">🎲 Roll</button>
    </div>
    <div class="card-init-rolled">${rolledText}</div>`;

  const bonusInput = document.getElementById("card-init-bonus");
  bonusInput.addEventListener("change", async () => {
    const val = parseInt(bonusInput.value) || 0;
    currentInitBonus = val;
    await OBR.scene.items.updateItems([currentTokenId], (items) => {
      for (const item of items) {
        if (!item.metadata) item.metadata = {};
        item.metadata[INIT_BONUS_KEY] = val;
      }
    });
  });

  document.getElementById("card-init-roll").addEventListener("click", rollMyInitiative);
}

async function rollMyInitiative() {
  const { die, total } = rollAttack(currentInitBonus);
  currentInitValue = total;

  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      if (!item.metadata) item.metadata = {};
      item.metadata[INIT_KEY] = total;
    }
  });

  const bonusStr = currentInitBonus >= 0 ? `+${currentInitBonus}` : `${currentInitBonus}`;
  await announceRoll(`⚡ ${currentTokenName} — Initiative: ${die} ${bonusStr} = ${total}`);
  renderInitiativeControls(true);
}

function renderAbility(stat, score, npcName) {
  const el = document.getElementById(stat);
  if (score == null) { el.textContent = "—"; return; }
  const mod = Math.floor((score - 10) / 2);
  el.innerHTML = `<button class="roll-trigger ability-btn">${score} (${mod >= 0 ? "+" : ""}${mod})</button>`;
  el.querySelector(".ability-btn").addEventListener("click", () => handleAbilityClick(stat, score, npcName));
}

async function handleAbilityClick(stat, score, npcName) {
  const { die, mod, total } = rollAbilityCheck(score);
  const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
  await announceRoll(`🎲 ${npcName || "NPC"} — ${stat.toUpperCase()} Check: ${die} ${modStr} = ${total}`);
}

/** Returns { cur, max, depleted } for a limited-use attack, or null if unlimited. */
function chargeState(attack) {
  if (attack.charges == null) return null;
  const cur = attack.currentCharges ?? attack.charges;
  return { cur, max: attack.charges, depleted: cur <= 0 };
}

async function handleAttackClick(npc, attack) {
  const state = chargeState(attack);
  if (state?.depleted) return; // shouldn't happen since button is disabled, but just in case

  const { die, bonus, total } = rollAttack(attack.bonus);
  await announceRoll(`⚔ ${npc.name || "NPC"} — ${attack.name}: ${die} +${bonus} = ${total} to hit`);
  setTimeout(async () => {
    const dmg = rollDiceExpression(attack.damage);
    if (dmg.total != null) {
      const modStr = dmg.modifier ? (dmg.modifier >= 0 ? "+" : "") + dmg.modifier : "";
      await announceRoll(`💥 ${npc.name || "NPC"} — ${attack.name} damage: ${dmg.rolls.join("+")}${modStr} = ${dmg.total}`);
    }
  }, 600);

  if (state) {
    await consumeCharge(npc, attack);
  }
}

async function consumeCharge(npc, attack) {
  const updatedAttacks = npc.attacks.map(a =>
    a === attack ? { ...a, currentCharges: Math.max(0, (a.currentCharges ?? a.charges) - 1) } : a
  );
  const updated = { ...npc, attacks: updatedAttacks };
  currentNpc = updated;
  await writeNPCToToken(updated);
  renderCard(updated);
}

async function handleRechargeClick(npc, attack) {
  const result = rollRecharge(6, attack.rechargeMin);
  const npcName = npc.name || "NPC";

  if (result.success) {
    await announceRoll(`🔁 ${npcName} — ${attack.name} recharges! (rolled ${result.die})`);
    const updatedAttacks = npc.attacks.map(a =>
      a === attack ? { ...a, currentCharges: a.charges } : a
    );
    const updated = { ...npc, attacks: updatedAttacks };
    currentNpc = updated;
    await writeNPCToToken(updated);
    renderCard(updated);
  } else {
    await announceRoll(`🔁 ${npcName} — ${attack.name} fails to recharge (rolled ${result.die})`);
  }
}

async function handleAbilityRechargeClick(npc, attack) {
  const result = rollRecharge(6, attack.rechargeMin);
  const npcName = npc.name || "NPC";

  if (result.success) {
    await announceRoll(`🔁 ${npcName} — ${attack.name} recharges! (rolled ${result.die})`);
    const updatedAbilities = npc.abilities.map(a =>
      a === attack ? { ...a, currentCharges: a.charges } : a
    );
    const updated = { ...npc, abilities: updatedAbilities };
    currentNpc = updated;
    await writeNPCToToken(updated);
    renderCard(updated);
  } else {
    await announceRoll(`🔁 ${npcName} — ${attack.name} fails to recharge (rolled ${result.die})`);
  }
}

async function handleAbilityUseClick(npc, ability) {
  const state = chargeState(ability);
  if (state?.depleted) return;

  const npcName = npc.name || "NPC";
  await announceRoll(`✨ ${npcName} uses ${ability.name}!`);

  if (ability.damage) {
    setTimeout(async () => {
      const dmg = rollDiceExpression(ability.damage);
      if (dmg.total != null) {
        const modStr = dmg.modifier ? (dmg.modifier >= 0 ? "+" : "") + dmg.modifier : "";
        await announceRoll(`💥 ${npcName} — ${ability.name} damage: ${dmg.rolls.join("+")}${modStr} = ${dmg.total}`);
      }
    }, 600);
  }

  if (state) {
    const updatedAbilities = npc.abilities.map(a =>
      a === ability ? { ...a, currentCharges: Math.max(0, (a.currentCharges ?? a.charges) - 1) } : a
    );
    const updated = { ...npc, abilities: updatedAbilities };
    currentNpc = updated;
    await writeNPCToToken(updated);
    renderCard(updated);
  }
}

async function consumeCombatCharge(attack) {
  const updatedAttacks = combatAttackerNpc.attacks.map(a =>
    a === attack ? { ...a, currentCharges: Math.max(0, (a.currentCharges ?? a.charges) - 1) } : a
  );
  combatAttackerNpc = { ...combatAttackerNpc, attacks: updatedAttacks };
  await writeNPCToTokenId(combatAttackerId, combatAttackerNpc);
  renderCombat();
}

// ── Initiative tracker (shared, synced for everyone) ───────────────────────

/** Returns the sorted [{id, name, value}] list of everyone currently tracked. */
function getSortedInitiative() {
  const entries = [];
  for (const item of lastItemsSnapshot) {
    const value = item.metadata?.[INIT_KEY];
    if (value == null) continue;
    const name = item.name || item.text?.plainText || "Unnamed";
    entries.push({ id: item.id, name, value });
  }
  entries.sort((a, b) => b.value - a.value);
  return entries;
}

function renderInitiative() {
  const list = document.getElementById("init-list");
  const summary = document.getElementById("init-summary");
  if (!list || !summary) return;

  const entries = getSortedInitiative();

  if (entries.length === 0) {
    list.innerHTML = `<div class="init-empty">No one in the initiative order yet.</div>`;
    summary.textContent = "Not started";
    return;
  }

  const currentEntry = entries.find(e => e.id === sceneTurnMeta.currentId);
  summary.textContent = currentEntry
    ? `Round ${sceneTurnMeta.round} — ${currentEntry.name}'s turn`
    : `Round ${sceneTurnMeta.round} — not started`;

  list.innerHTML = entries.map(e => {
    const isCurrent = e.id === sceneTurnMeta.currentId;
    const removeBtn = isGM ? `<button class="init-remove" data-id="${e.id}">✕</button>` : "";
    return `
      <div class="init-row ${isCurrent ? "current" : ""}">
        <span class="init-value">${e.value}</span>
        <span class="init-name">${isCurrent ? "▶ " : ""}${esc(e.name)}</span>
        ${removeBtn}
      </div>`;
  }).join("");

  if (isGM) {
    list.querySelectorAll(".init-remove").forEach(btn => {
      btn.addEventListener("click", () => removeFromInitiative(btn.dataset.id));
    });
  }
}

/** Roll d20 + DEX modifier (if that token has stats) for every selected token. */
async function rollInitiativeForSelected() {
  const sel = (await OBR.player.getSelection()) ?? [];
  if (sel.length === 0) {
    showStatus("Select one or more tokens first", true);
    return;
  }

  const items = await OBR.scene.items.getItems(sel);
  const results = [];

  for (const item of items) {
    const npc = item.metadata?.[`${PLUGIN_ID}/npc`];
    const explicitBonus = item.metadata?.[INIT_BONUS_KEY];
    let mod;
    if (explicitBonus != null) {
      mod = explicitBonus;
    } else {
      const dex = npc?.dex;
      mod = dex != null ? Math.floor((dex - 10) / 2) : 0;
    }
    const { die, total } = rollAttack(mod);
    const name = item.name || item.text?.plainText || "Unnamed";
    results.push({ id: item.id, name, total, die, mod });
  }

  await OBR.scene.items.updateItems(sel, (updateItems) => {
    for (const item of updateItems) {
      const result = results.find(r => r.id === item.id);
      if (result) {
        if (!item.metadata) item.metadata = {};
        item.metadata[INIT_KEY] = result.total;
      }
    }
  });

  const summary = results.map(r => `${r.name}: ${r.die}${r.mod >= 0 ? "+" : ""}${r.mod === 0 ? "" : r.mod} = ${r.total}`).join(" | ");
  await announceRoll(`⚡ Initiative — ${summary}`);
}

async function nextTurn() {
  const entries = getSortedInitiative();
  if (entries.length === 0) return;

  const currentIndex = entries.findIndex(e => e.id === sceneTurnMeta.currentId);
  let nextIndex, nextRound;

  if (currentIndex === -1) {
    // Not started yet — begin at the top of the order.
    nextIndex = 0;
    nextRound = sceneTurnMeta.round || 1;
  } else if (currentIndex === entries.length - 1) {
    // Wrapped around — new round.
    nextIndex = 0;
    nextRound = (sceneTurnMeta.round || 1) + 1;
  } else {
    nextIndex = currentIndex + 1;
    nextRound = sceneTurnMeta.round || 1;
  }

  const next = entries[nextIndex];
  const newMeta = { currentId: next.id, round: nextRound };
  await OBR.scene.setMetadata({ [TURN_KEY]: newMeta });
  await announceRoll(`⚡ Round ${nextRound} — it's ${next.name}'s turn!`);
}

async function removeFromInitiative(id) {
  await OBR.scene.items.updateItems([id], (items) => {
    for (const item of items) {
      if (item.metadata) delete item.metadata[INIT_KEY];
    }
  });
  if (sceneTurnMeta.currentId === id) {
    await OBR.scene.setMetadata({ [TURN_KEY]: { currentId: null, round: sceneTurnMeta.round || 1 } });
  }
}

async function clearInitiative() {
  if (!confirm("Clear the entire initiative order for everyone?")) return;
  const entries = getSortedInitiative();
  const ids = entries.map(e => e.id);
  if (ids.length > 0) {
    await OBR.scene.items.updateItems(ids, (items) => {
      for (const item of items) {
        if (item.metadata) delete item.metadata[INIT_KEY];
      }
    });
  }
  await OBR.scene.setMetadata({ [TURN_KEY]: { currentId: null, round: 1 } });
}

// ── Roll log (persistent, independent of current mode) ────────────────────
function addRollLogEntry(message) {
  rollLog.unshift({ message, time: Date.now() });
  if (rollLog.length > ROLL_LOG_MAX) rollLog.length = ROLL_LOG_MAX;
  renderRollLog();
}

function classifyRoll(message) {
  if (message.includes("MISS")) return "miss";
  if (message.includes("HIT!")) return "hit";
  if (message.includes("💥") || message.includes("takes")) return "damage";
  return "";
}

function renderRollLog() {
  const list = document.getElementById("roll-log-list");
  if (!list) return;

  if (rollLog.length === 0) {
    list.innerHTML = `<div class="roll-log-empty">No rolls yet this session.</div>`;
    return;
  }

  list.innerHTML = rollLog.map(entry => {
    const cls = classifyRoll(entry.message);
    return `<div class="roll-log-entry ${cls}">${esc(entry.message)}</div>`;
  }).join("");
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── GM EDIT FORM ────────────────────────────────────────────────────────
function showEditForm(npc) {
  document.getElementById("view-card-wrapper").style.display = "none";
  document.getElementById("combat-panel").style.display = "none";
  document.getElementById("no-token-msg").style.display = "none";
  document.getElementById("editor").style.display = "block";
  populateForm(npc);
}

function populateForm(npc) {
  setVal("f-name",     npc.name     ?? "");
  setVal("f-subtitle", npc.subtitle ?? "");
  setVal("f-ac",       npc.ac       ?? "");
  setVal("f-hp",       npc.hp       ?? "");
  setVal("f-currenthp", npc.currentHp ?? npc.hp ?? "");
  setVal("f-speed",    npc.speed    ?? "");
  setVal("f-str", npc.str ?? ""); updateMod("str");
  setVal("f-dex", npc.dex ?? ""); updateMod("dex");
  setVal("f-con", npc.con ?? ""); updateMod("con");
  setVal("f-int", npc.int ?? ""); updateMod("int");
  setVal("f-wis", npc.wis ?? ""); updateMod("wis");
  setVal("f-cha", npc.cha ?? ""); updateMod("cha");
  setVal("f-notes", npc.notes ?? "");

  document.getElementById("attacks-list").innerHTML = "";
  (npc.attacks ?? []).forEach(a => addAttack(a));
  document.getElementById("abilities-list").innerHTML = "";
  (npc.abilities ?? []).forEach(ab => addAbility(ab));

  currentVisibility = npc.visibility ?? "gm";
  document.getElementById("vis-gm").classList.toggle("active", currentVisibility === "gm");
  document.getElementById("vis-all").classList.toggle("active", currentVisibility === "all");
}

function buildNPCFromForm() {
  const attacks = [...document.querySelectorAll(".attack-row")].map(row => {
    const charges = row.querySelector(".atk-charges").value.trim();
    const rechargeMin = row.querySelector(".atk-recharge").value.trim();
    const maxCharges = charges === "" ? null : parseInt(charges);
    let curCharges = row.dataset.currentCharges;
    curCharges = (curCharges === "" || curCharges == null) ? maxCharges : parseInt(curCharges);
    if (maxCharges != null && curCharges != null) {
      curCharges = Math.max(0, Math.min(maxCharges, curCharges));
    }
    return {
      name: row.querySelector(".atk-name").value.trim(),
      bonus: parseInt(row.querySelector(".atk-bonus").value) || 0,
      damage: row.querySelector(".atk-damage").value.trim(),
      charges: maxCharges,
      rechargeMin: rechargeMin === "" ? null : parseInt(rechargeMin),
      currentCharges: maxCharges != null ? curCharges : null
    };
  }).filter(a => a.name);

  const abilities = [...document.querySelectorAll(".ability-row")].map(row => {
    const charges = row.querySelector(".abl-charges").value.trim();
    const rechargeMin = row.querySelector(".abl-recharge").value.trim();
    const maxCharges = charges === "" ? null : parseInt(charges);
    let curCharges = row.dataset.currentCharges;
    curCharges = (curCharges === "" || curCharges == null) ? maxCharges : parseInt(curCharges);
    if (maxCharges != null && curCharges != null) {
      curCharges = Math.max(0, Math.min(maxCharges, curCharges));
    }
    return {
      name: row.querySelector(".abl-name").value.trim(),
      text: row.querySelector(".abl-text").value.trim(),
      damage: row.querySelector(".abl-damage").value.trim(),
      charges: maxCharges,
      rechargeMin: rechargeMin === "" ? null : parseInt(rechargeMin),
      currentCharges: maxCharges != null ? curCharges : null
    };
  }).filter(a => a.name);

  const maxHp = num("f-hp");
  let curHp = num("f-currenthp");
  if (curHp == null) curHp = maxHp;
  if (maxHp != null && curHp != null) curHp = Math.max(0, Math.min(maxHp, curHp));

  return {
    name: getVal("f-name"), subtitle: getVal("f-subtitle"),
    ac: num("f-ac"), hp: maxHp, currentHp: curHp, speed: num("f-speed"),
    str: num("f-str"), dex: num("f-dex"), con: num("f-con"),
    int: num("f-int"), wis: num("f-wis"), cha: num("f-cha"),
    notes: getVal("f-notes"), visibility: currentVisibility,
    attacks, abilities
  };
}

async function writeNPCToToken(npc) {
  await writeNPCToTokenId(currentTokenId, npc);
  currentNpc = npc;
}

async function writeNPCToTokenId(tokenId, npc) {
  if (!tokenId) return;
  await OBR.scene.items.updateItems([tokenId], (items) => {
    for (const item of items) {
      if (!item.metadata) item.metadata = {};
      item.metadata[`${PLUGIN_ID}/npc`] = npc;
    }
  });
}

async function saveStats() {
  if (!currentTokenId) return;
  const btn = document.getElementById("save-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await writeNPCToToken(buildNPCFromForm());
    showStatus("Saved to token!", false);
  } catch (e) {
    showStatus("Save failed — check console", true);
    console.error(e);
  }
  btn.disabled = false;
  btn.textContent = "Save to Token";
}

async function setVisibilityAndSave(val) {
  currentVisibility = val;
  document.getElementById("vis-gm").classList.toggle("active", val === "gm");
  document.getElementById("vis-all").classList.toggle("active", val === "all");
  if (!currentTokenId) return;
  try {
    await writeNPCToToken(buildNPCFromForm());
    showStatus(val === "all" ? "Now visible to everyone" : "Now GM only", false);
  } catch (e) {
    showStatus("Visibility save failed", true);
    console.error(e);
  }
}

// ── Library ─────────────────────────────────────────────────────────────
function getLibrary() {
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "{}"); }
  catch { return {}; }
}
function setLibrary(lib) { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); }

function saveToLibrary() {
  const npc = buildNPCFromForm();
  if (!npc.name) { showStatus("Give this NPC a name first", true); return; }
  const lib = getLibrary();
  const existingKey = Object.keys(lib).find(k => k.toLowerCase() === npc.name.toLowerCase());
  if (existingKey && !confirm(`"${existingKey}" already exists. Overwrite it?`)) return;
  lib[npc.name] = npc;
  setLibrary(lib);
  refreshLibraryDropdown(npc.name);
  showStatus(`"${npc.name}" saved to library!`, false);
}

function loadFromLibrary() {
  const key = document.getElementById("library-select").value;
  if (!key) return;
  const npc = getLibrary()[key];
  if (!npc) return;
  populateForm(npc);
  showStatus(`Loaded "${key}"`, false);
}

function deleteFromLibrary() {
  const key = document.getElementById("library-select").value;
  if (!key) return;
  if (!confirm(`Delete "${key}" from your library?`)) return;
  const lib = getLibrary();
  delete lib[key];
  setLibrary(lib);
  refreshLibraryDropdown();
  showStatus(`"${key}" deleted`, false);
}

function refreshLibraryDropdown(selectKey = "") {
  const select = document.getElementById("library-select");
  if (!select) return;
  const lib = getLibrary();
  const keys = Object.keys(lib).sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">— Choose a saved NPC —</option>`;
  keys.forEach(k => {
    const opt = document.createElement("option");
    opt.value = k; opt.textContent = k;
    if (k === selectKey) opt.selected = true;
    select.appendChild(opt);
  });
  const empty = document.getElementById("library-empty");
  if (empty) empty.style.display = keys.length === 0 ? "block" : "none";
  const count = document.getElementById("library-count");
  if (count) count.textContent = keys.length === 0 ? "" : `${keys.length} saved NPC${keys.length === 1 ? "" : "s"}`;
}

function exportLibrary() {
  const lib = getLibrary();
  if (Object.keys(lib).length === 0) { showStatus("Library is empty", true); return; }
  const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "npc-library.json"; a.click();
  URL.revokeObjectURL(url);
  showStatus("Library exported!", false);
}

function importLibrary() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const incoming = JSON.parse(await file.text());
      if (typeof incoming !== "object" || Array.isArray(incoming)) { showStatus("Invalid file", true); return; }
      const lib = getLibrary();
      const existingKeys = Object.keys(lib);
      const incomingKeys = Object.keys(incoming);
      let mode = "merge";
      if (existingKeys.length > 0) {
        mode = confirm(`Importing ${incomingKeys.length} NPCs.\n\nOK = Merge\nCancel = Replace entire library`) ? "merge" : "replace";
      }
      setLibrary(mode === "merge" ? { ...incoming, ...lib } : incoming);
      refreshLibraryDropdown();
      showStatus(`Imported ${incomingKeys.length} NPCs (${mode})`, false);
    } catch {
      showStatus("Failed to read file", true);
    }
  });
  input.click();
}

// ── Dynamic rows ────────────────────────────────────────────────────────
function addAttack(data = {}) {
  const list = document.getElementById("attacks-list");
  const div = document.createElement("div");
  div.className = "dynamic-row attack-row";
  const startingCharges = data.currentCharges ?? data.charges ?? "";
  div.dataset.currentCharges = startingCharges;
  div.innerHTML = `
    <button class="remove-btn" onclick="this.closest('.attack-row').remove()">✕</button>
    <div class="row">
      <div class="field" style="flex:2"><label>Attack name</label><input class="atk-name" type="text" placeholder="Scimitar" value="${esc(data.name ?? "")}" /></div>
      <div class="field" style="flex:1"><label>To Hit</label><input class="atk-bonus" type="number" placeholder="4" value="${data.bonus ?? ""}" /></div>
    </div>
    <div class="field"><label>Damage</label><input class="atk-damage" type="text" placeholder="1d6+2 slashing" value="${esc(data.damage ?? "")}" /></div>
    <div class="row">
      <div class="field" style="flex:1"><label>Charges</label><input class="atk-charges" type="number" min="0" placeholder="Unlimited" value="${data.charges ?? ""}" /></div>
      <div class="field" style="flex:1"><label>Recharge on d6 ≥</label><input class="atk-recharge" type="number" min="1" max="6" placeholder="e.g. 5" value="${data.rechargeMin ?? ""}" /></div>
    </div>`;
  list.appendChild(div);
}

function addAbility(data = {}) {
  const list = document.getElementById("abilities-list");
  const div = document.createElement("div");
  div.className = "dynamic-row ability-row";
  const startingCharges = data.currentCharges ?? data.charges ?? "";
  div.dataset.currentCharges = startingCharges;
  div.innerHTML = `
    <button class="remove-btn" onclick="this.closest('.ability-row').remove()">✕</button>
    <div class="field"><label>Trait name</label><input class="abl-name" type="text" placeholder="Nimble Escape" value="${esc(data.name ?? "")}" /></div>
    <div class="field"><label>Description</label><textarea class="abl-text" placeholder="What this trait does…">${esc(data.text ?? "")}</textarea></div>
    <div class="field"><label>Damage (optional)</label><input class="abl-damage" type="text" placeholder="e.g. 3d8 (leave blank if none)" value="${esc(data.damage ?? "")}" /></div>
    <div class="row">
      <div class="field" style="flex:1"><label>Charges</label><input class="abl-charges" type="number" min="0" placeholder="Unlimited" value="${data.charges ?? ""}" /></div>
      <div class="field" style="flex:1"><label>Recharge on d6 ≥</label><input class="abl-recharge" type="number" min="1" max="6" placeholder="e.g. 5" value="${data.rechargeMin ?? ""}" /></div>
    </div>`;
  list.appendChild(div);
}

function updateMod(stat) {
  const val = parseInt(document.getElementById(`f-${stat}`).value);
  const el = document.getElementById(`mod-${stat}`);
  if (isNaN(val)) { el.textContent = ""; return; }
  const mod = Math.floor((val - 10) / 2);
  el.textContent = mod >= 0 ? `+${mod}` : `${mod}`;
}

function clearForm() {
  if (!confirm("Clear all stats for this token?")) return;
  ["f-name","f-subtitle","f-ac","f-hp","f-currenthp","f-speed","f-str","f-dex","f-con","f-int","f-wis","f-cha","f-notes"]
    .forEach(id => document.getElementById(id).value = "");
  ["str","dex","con","int","wis","cha"].forEach(updateMod);
  document.getElementById("attacks-list").innerHTML = "";
  document.getElementById("abilities-list").innerHTML = "";
  currentVisibility = "gm";
  document.getElementById("vis-gm").classList.add("active");
  document.getElementById("vis-all").classList.remove("active");
}

// ── Helpers ─────────────────────────────────────────────────────────────
function setVal(id, v) { document.getElementById(id).value = v; }
function getVal(id)    { return document.getElementById(id).value.trim(); }
function num(id)       { const v = parseInt(getVal(id)); return isNaN(v) ? null : v; }

function showStatus(msg, isError = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = isError ? "error show" : "show";
  setTimeout(() => el.classList.remove("show"), 2500);
}