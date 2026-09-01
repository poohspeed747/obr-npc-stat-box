import OBR from "@owlbear-rodeo/sdk";

const PLUGIN_ID = "com.yourname.npcstatbox";
export const ROLL_CHANNEL = `${PLUGIN_ID}/roll`;

/** Roll a single d20 (1-20, uniform). */
function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

/**
 * Roll a damage-style dice expression like "1d6+2" or "2d8".
 * Returns { total, rolls, expression } — rolls is the array of individual die results.
 */
export function rollDiceExpression(expr) {
  const match = String(expr).trim().match(/^(\d+)d(\d+)\s*([+-]\s*\d+)?/i);
  if (!match) return { total: null, rolls: [], expression: expr };

  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const modifier = match[3] ? parseInt(match[3].replace(/\s/g, "")) : 0;

  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;

  return { total, rolls, modifier, expression: expr };
}

/**
 * Roll an ability check: 1d20 + modifier.
 */
export function rollAbilityCheck(score) {
  const mod = Math.floor((score - 10) / 2);
  const die = rollD20();
  return { die, mod, total: die + mod };
}

/**
 * Roll an attack's to-hit: 1d20 + bonus.
 */
export function rollAttack(bonus) {
  const die = rollD20();
  return { die, bonus, total: die + bonus };
}

/**
 * Roll a recharge die (e.g. 1d6) and check it against a minimum threshold.
 * Used for limited-use attacks that recharge on a roll, like D&D's
 * "Recharge 5-6" breath weapons.
 */
export function rollRecharge(sides, threshold) {
  const die = Math.floor(Math.random() * sides) + 1;
  return { die, sides, threshold, success: die >= threshold };
}

/**
 * Broadcast a roll result to everyone in the room, and show it locally too.
 * Every connected client (including this one) is listening on ROLL_CHANNEL
 * and will display the same notification, so it feels like a native OBR roll.
 */
export async function announceRoll(message) {
  await OBR.broadcast.sendMessage(ROLL_CHANNEL, { message }, { destination: "ALL" });
}

/**
 * Call once per popover instance to start showing roll results as they come in.
 */
export function listenForRolls() {
  OBR.broadcast.onMessage(ROLL_CHANNEL, (event) => {
    const { message } = event.data ?? {};
    if (!message) return;
    OBR.notification.show(message, "DEFAULT");
  });
}