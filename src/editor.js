import OBR from "@owlbear-rodeo/sdk";

const PLUGIN_ID = "com.yourname.npcstatbox";
const LIBRARY_KEY = `${PLUGIN_ID}/library`;

let currentTokenId = null;
let currentVisibility = "gm";

// ── Expose globals needed by inline handlers ───────────────────────────────
window.updateMod         = updateMod;
window.addAttack         = addAttack;
window.addAbility        = addAbility;
window.setVisibility     = setVisibility;
window.clearForm         = clearForm;
window.saveStats         = saveStats;
window.saveToLibrary     = saveToLibrary;
window.loadFromLibrary   = loadFromLibrary;
window.deleteFromLibrary = deleteFromLibrary;
window.exportLibrary     = exportLibrary;
window.importLibrary     = importLibrary;

// ── OBR Init ──────────────────────────────────────────────────────────────
OBR.onReady(async () => {
  const role = await OBR.player.getRole();
  if (role !== "GM") {
    document.getElementById("no-token-msg").innerHTML =
      `<p style="color:#666">Only the GM<br>can edit NPC stats.</p>`;
    return;
  }

  refreshLibraryDropdown();

  OBR.player.onChange(async (player) => {
    const sel = player.selection ?? [];
    if (sel.length === 1) {
      await loadToken(sel[0]);
    } else {
      showNoToken(sel.length === 0
        ? "No token selected"
        : "Select a single token to edit");
    }
  });

  const sel = (await OBR.player.getSelection()) ?? [];
  if (sel.length === 1) {
    await loadToken(sel[0]);
  } else {
    showNoToken(sel.length === 0
      ? "No token selected"
      : "Select a single token to edit");
  }
});

// ── Load token data into the form ─────────────────────────────────────────
async function loadToken(tokenId) {
  const items = await OBR.scene.items.getItems([tokenId]);
  const token = items[0];
  if (!token) return;

  currentTokenId = tokenId;
  const npc = token.metadata?.[`${PLUGIN_ID}/npc`] ?? {};
  const tokenName = token.name || token.text?.plainText || "Unnamed Token";

  document.getElementById("token-label").textContent = `Editing: ${tokenName}`;
  document.getElementById("no-token-msg").style.display = "none";
  document.getElementById("editor").style.display = "block";

  populateForm(npc);
}

function populateForm(npc) {
  setVal("f-name",     npc.name     ?? "");
  setVal("f-subtitle", npc.subtitle ?? "");
  setVal("f-ac",       npc.ac       ?? "");
  setVal("f-hp",       npc.hp       ?? "");
  setVal("f-speed",    npc.speed    ?? "");
  setVal("f-str",      npc.str      ?? ""); updateMod("str");
  setVal("f-dex",      npc.dex      ?? ""); updateMod("dex");
  setVal("f-con",      npc.con      ?? ""); updateMod("con");
  setVal("f-int",      npc.int      ?? ""); updateMod("int");
  setVal("f-wis",      npc.wis      ?? ""); updateMod("wis");
  setVal("f-cha",      npc.cha      ?? ""); updateMod("cha");
  setVal("f-notes",    npc.notes    ?? "");

  document.getElementById("attacks-list").innerHTML = "";
  (npc.attacks ?? []).forEach(a => addAttack(a));

  document.getElementById("abilities-list").innerHTML = "";
  (npc.abilities ?? []).forEach(ab => addAbility(ab));

  setVisibility(npc.visibility ?? "gm");
}

function showNoToken(msg) {
  currentTokenId = null;
  document.getElementById("token-label").textContent = msg;
  document.getElementById("editor").style.display = "none";
  document.getElementById("no-token-msg").style.display = "flex";
}

// ── Build NPC object from current form ────────────────────────────────────
function buildNPCFromForm() {
  const attacks = [...document.querySelectorAll(".attack-row")].map(row => ({
    name:   row.querySelector(".atk-name").value.trim(),
    bonus:  parseInt(row.querySelector(".atk-bonus").value) || 0,
    damage: row.querySelector(".atk-damage").value.trim()
  })).filter(a => a.name);

  const abilities = [...document.querySelectorAll(".ability-row")].map(row => ({
    name: row.querySelector(".abl-name").value.trim(),
    text: row.querySelector(".abl-text").value.trim()
  })).filter(a => a.name);

  return {
    name:       getVal("f-name"),
    subtitle:   getVal("f-subtitle"),
    ac:         num("f-ac"),
    hp:         num("f-hp"),
    speed:      num("f-speed"),
    str:        num("f-str"),
    dex:        num("f-dex"),
    con:        num("f-con"),
    int:        num("f-int"),
    wis:        num("f-wis"),
    cha:        num("f-cha"),
    notes:      getVal("f-notes"),
    visibility: currentVisibility,
    attacks,
    abilities
  };
}

// ── Save to token ─────────────────────────────────────────────────────────
async function saveStats() {
  if (!currentTokenId) return;

  const btn = document.getElementById("save-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const npc = buildNPCFromForm();
    await writeNPCToToken(npc);
    showStatus("Saved to token!", false);
  } catch (e) {
    showStatus("Save failed — check console", true);
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = "Save to Token";
}

// ── Shared write helper (used by saveStats AND visibility toggle) ──────────
async function writeNPCToToken(npc) {
  if (!currentTokenId) return;
  await OBR.scene.items.updateItems([currentTokenId], (items) => {
    for (const item of items) {
      if (!item.metadata) item.metadata = {};
      item.metadata[`${PLUGIN_ID}/npc`] = npc;
    }
  });
}

// ── Visibility ────────────────────────────────────────────────────────────
// ⚠️  Clicking a visibility button now immediately saves to the token
//     so players see the change without the GM having to hit Save again.
function setVisibility(val) {
  currentVisibility = val;
  document.getElementById("vis-gm").classList.toggle("active",  val === "gm");
  document.getElementById("vis-all").classList.toggle("active", val === "all");
}

// Called from the HTML buttons — sets visibility AND auto-saves
window.setVisibilityAndSave = async function(val) {
  setVisibility(val);
  if (!currentTokenId) return; // nothing selected yet, just update UI
  try {
    await writeNPCToToken(buildNPCFromForm());
    showStatus(val === "all" ? "Now visible to everyone" : "Now GM only", false);
  } catch (e) {
    showStatus("Visibility save failed", true);
    console.error(e);
  }
};

// ── Library: localStorage helpers ─────────────────────────────────────────
function getLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function setLibrary(lib) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
}

// ── Library: Save current form as a named entry ───────────────────────────
function saveToLibrary() {
  const npc = buildNPCFromForm();
  if (!npc.name) {
    showStatus("Give this NPC a name first", true);
    return;
  }

  const lib = getLibrary();
  const existingKey = Object.keys(lib).find(
    k => k.toLowerCase() === npc.name.toLowerCase()
  );

  if (existingKey && !confirm(`"${existingKey}" already exists. Overwrite it?`)) return;

  lib[npc.name] = npc;
  setLibrary(lib);
  refreshLibraryDropdown(npc.name);
  showStatus(`"${npc.name}" saved to library!`, false);
}

// ── Library: Load selected entry into form ────────────────────────────────
function loadFromLibrary() {
  const select = document.getElementById("library-select");
  const key = select.value;
  if (!key) return;

  const lib = getLibrary();
  const npc = lib[key];
  if (!npc) return;

  populateForm(npc);
  showStatus(`Loaded "${key}" from library`, false);
}

// ── Library: Delete selected entry ────────────────────────────────────────
function deleteFromLibrary() {
  const select = document.getElementById("library-select");
  const key = select.value;
  if (!key) return;

  if (!confirm(`Delete "${key}" from your library?`)) return;

  const lib = getLibrary();
  delete lib[key];
  setLibrary(lib);
  refreshLibraryDropdown();
  showStatus(`"${key}" deleted`, false);
}

// ── Library: Refresh dropdown ─────────────────────────────────────────────
function refreshLibraryDropdown(selectKey = "") {
  const select = document.getElementById("library-select");
  if (!select) return;

  const lib = getLibrary();
  const keys = Object.keys(lib).sort((a, b) => a.localeCompare(b));

  select.innerHTML = `<option value="">— Choose a saved NPC —</option>`;
  keys.forEach(k => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    if (k === selectKey) opt.selected = true;
    select.appendChild(opt);
  });

  const empty = document.getElementById("library-empty");
  if (empty) empty.style.display = keys.length === 0 ? "block" : "none";

  const count = document.getElementById("library-count");
  if (count) count.textContent = keys.length === 0
    ? ""
    : `${keys.length} saved NPC${keys.length === 1 ? "" : "s"}`;
}

// ── Library: Export as JSON file ──────────────────────────────────────────
function exportLibrary() {
  const lib = getLibrary();
  if (Object.keys(lib).length === 0) {
    showStatus("Library is empty — nothing to export", true);
    return;
  }
  const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "npc-library.json"; a.click();
  URL.revokeObjectURL(url);
  showStatus("Library exported!", false);
}

// ── Library: Import from JSON file ────────────────────────────────────────
function importLibrary() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";

  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const incoming = JSON.parse(text);
      if (typeof incoming !== "object" || Array.isArray(incoming)) {
        showStatus("Invalid file format", true);
        return;
      }
      const lib = getLibrary();
      const existingKeys = Object.keys(lib);
      const incomingKeys = Object.keys(incoming);
      const conflicts = incomingKeys.filter(k => existingKeys.includes(k));

      let mode = "merge";
      if (existingKeys.length > 0) {
        const choice = confirm(
          conflicts.length > 0
            ? `Importing ${incomingKeys.length} NPCs. ${conflicts.length} conflict(s) with existing entries.\n\nOK = Merge (keep yours)\nCancel = Replace entire library`
            : `Importing ${incomingKeys.length} NPCs.\n\nOK = Merge\nCancel = Replace entire library`
        );
        mode = choice ? "merge" : "replace";
      }

      const newLib = mode === "merge" ? { ...incoming, ...lib } : incoming;
      setLibrary(newLib);
      refreshLibraryDropdown();
      showStatus(`Imported ${incomingKeys.length} NPCs (${mode})`, false);
    } catch {
      showStatus("Failed to read file — is it valid JSON?", true);
    }
  });

  input.click();
}

// ── Dynamic rows ──────────────────────────────────────────────────────────
function addAttack(data = {}) {
  const list = document.getElementById("attacks-list");
  const div = document.createElement("div");
  div.className = "dynamic-row attack-row";
  div.innerHTML = `
    <button class="remove-btn" onclick="this.closest('.attack-row').remove()">✕</button>
    <div class="row">
      <div class="field" style="flex:2">
        <label>Attack name</label>
        <input class="atk-name" type="text" placeholder="Scimitar" value="${esc(data.name ?? "")}" />
      </div>
      <div class="field" style="flex:1">
        <label>To Hit</label>
        <input class="atk-bonus" type="number" placeholder="4" value="${data.bonus ?? ""}" />
      </div>
    </div>
    <div class="field">
      <label>Damage</label>
      <input class="atk-damage" type="text" placeholder="1d6+2 slashing" value="${esc(data.damage ?? "")}" />
    </div>`;
  list.appendChild(div);
}

function addAbility(data = {}) {
  const list = document.getElementById("abilities-list");
  const div = document.createElement("div");
  div.className = "dynamic-row ability-row";
  div.innerHTML = `
    <button class="remove-btn" onclick="this.closest('.ability-row').remove()">✕</button>
    <div class="field">
      <label>Trait name</label>
      <input class="abl-name" type="text" placeholder="Nimble Escape" value="${esc(data.name ?? "")}" />
    </div>
    <div class="field">
      <label>Description</label>
      <textarea class="abl-text" placeholder="What this trait does…">${esc(data.text ?? "")}</textarea>
    </div>`;
  list.appendChild(div);
}

// ── Ability modifier display ──────────────────────────────────────────────
function updateMod(stat) {
  const val = parseInt(document.getElementById(`f-${stat}`).value);
  const el  = document.getElementById(`mod-${stat}`);
  if (isNaN(val)) { el.textContent = ""; return; }
  const mod = Math.floor((val - 10) / 2);
  el.textContent = mod >= 0 ? `+${mod}` : `${mod}`;
}

// ── Clear ─────────────────────────────────────────────────────────────────
function clearForm() {
  if (!confirm("Clear all stats for this token?")) return;
  ["f-name","f-subtitle","f-ac","f-hp","f-speed",
   "f-str","f-dex","f-con","f-int","f-wis","f-cha","f-notes"]
    .forEach(id => document.getElementById(id).value = "");
  ["str","dex","con","int","wis","cha"].forEach(updateMod);
  document.getElementById("attacks-list").innerHTML = "";
  document.getElementById("abilities-list").innerHTML = "";
  setVisibility("gm");
}

// ── Helpers ───────────────────────────────────────────────────────────────
function setVal(id, v) { document.getElementById(id).value = v; }
function getVal(id)    { return document.getElementById(id).value.trim(); }
function num(id)       { const v = parseInt(getVal(id)); return isNaN(v) ? null : v; }
function esc(s)        { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function showStatus(msg, isError = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = isError ? "error show" : "show";
  setTimeout(() => el.classList.remove("show"), 2500);
}