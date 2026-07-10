let modifierData = {};
let modifierLinkData = {};
let abilityTalentData = {};
let troopCountTalentData = {};

function loadTalents(loadJSON) {
  return Promise.all([
    loadJSON("unitParameterModifierNested.json"),
    loadJSON("abilityAddUnitModifier.json"),
    loadJSON("abilityAddUnitAbility.json"),
    loadJSON("abilityTroopCountAttackModifier.json"),
    loadJSON("abilityAddKillerModifier.json"),
    loadJSON("abilityAddUnitModifierOnAttack.json"),
    loadJSON("abilityAddUnitModifierOnDamage.json"),
    loadJSON("abilityAddUnitModifierOnHasStat.json"),
    loadJSON("abilityAddUnitModifierOnStat.json"),
    loadJSON("abilityHpAddModifier.json")
  ]).then(([modifierNested, modifierLinks, abilityLinks,
    troopCount, killerMod, onAttack, onDamage, onHasStat, onStat, hpAdd]) => {

    modifierData = modifierNested;
    modifierLinkData = modifierLinks;
    abilityTalentData = abilityLinks;

    // merge all "hidden talent" files into one object
    for (let data of [troopCount, killerMod, onAttack, onDamage, onHasStat, onStat, hpAdd]) {
      for (let key in data) {
        let entry = data[key];
        // only include entries that have abilityInfoId ending with _buff
        if (entry.abilityInfoId && entry.abilityInfoId.endsWith("_buff")) {
          troopCountTalentData[key] = entry;
        }
      }
    }

    console.log("✅ Talents loaded");
  });
}


// Modifier talents — unit and level come from the modifier string (e.g. "iceMage_buff_1")
function getModifierTalents(unitKey, level) {
  let result = {};

  for (let key in modifierLinkData) {
    let link = modifierLinkData[key];
    if (!link.modifier) continue;

    let parts = link.modifier.split("_");
    let unit = parts[0];                          // e.g. "iceMage"
    let lvl = parseInt(parts[parts.length - 1]); // e.g. 1

    if (unit.toLowerCase() !== unitKey.toLowerCase()) continue;
    if (lvl > level) continue;

    let modifier = modifierData[key];
    if (!modifier) continue;

    // Talent name = outer key minus trailing _<level>  (e.g. "frostArmor_1" → "frostArmor")
    let name = key.split("_").slice(0, -1).join("_");

    // Keep only the highest unlocked level
    if (!result[name] || lvl > result[name].level) {
      result[name] = {
        name,
        type: modifier.type,
        value: modifier.value,
        appliesTo: link.units,
        applyToBoss: link.applyToBoss,
        keepWhenSourceKilled: link.keepWhenSourceKilled,
        level: lvl
      };
    }
  }

  return Object.values(result);
}
function getAbilityTalents(unitKey, level) {
  let result = {};

  for (let key in abilityTalentData) {
    let talent = abilityTalentData[key];

    let parts = key.split("_");
    let unit = parts[0];
    let lvl = parseInt(parts[parts.length - 1]);

    if (unit.toLowerCase() !== unitKey.toLowerCase()) continue;
    if (lvl > level) continue;

    let name = parts.slice(1, -1).join("_").replace(/^talent_/, "");

    if (!result[name] || lvl > result[name].level) {
      // check modifierData first (e.g. revengeOfTheFallen), then abilityData (e.g. giftOfLight)
      let mod = modifierData[talent.addAbilityId];
      let abilityEntry = abilityData ? abilityData[talent.addAbilityId] : null;

      // collect all extra stats from abilityData (skip metadata keys)
      let skipAbilityKeys = ["key", "abilityInfoId", "iconId", "isActive", "isImmortalWhenActive",
        "sourceRestrictionId", "targetRestrictionId", "sourceEffectId", "targetEffectId", "showInLobbyUi",
        "title_Localized", "description_Localized"];
      let extraStats = {};
      if (abilityEntry) {
        for (let k in abilityEntry) {
          if (!skipAbilityKeys.includes(k)) extraStats[k] = abilityEntry[k];
        }
      }

      result[name] = {
        name,
        type: mod ? mod.type : undefined,
        value: mod ? mod.value : undefined,
        ...extraStats,
        addAbilityId: talent.addAbilityId,
        appliesTo: talent.units,
        applyToBoss: talent.applyToBoss,
        keepWhenSourceKilled: talent.keepWhenSourceKilled,
        level: lvl
      };

      // clean up undefined fields
      if (result[name].type === undefined) delete result[name].type;
      if (result[name].value === undefined) delete result[name].value;
    }
  }

  return Object.values(result);
}

// Ability talents — unit and level come from the key string (e.g. "charmer_revengeOfTheFallen_7")
// addAbilityId is stored as-is; no stat file available to resolve it further
function getTroopCountTalents(unitKey, level) {
  let result = {};

  for (let key in troopCountTalentData) {
    let entry = troopCountTalentData[key];
    if (!entry.abilityInfoId) continue;

    let infoParts = entry.abilityInfoId.split("_");
    let unit = infoParts.slice(0, -1).join("_");
    if (unit.toLowerCase() !== unitKey.toLowerCase()) continue;

    let parts = key.split("_");
    let lvl = parseInt(parts[parts.length - 1]);
    let name = parts.slice(0, -1).join("_");

    if (isNaN(lvl) || lvl > level) continue;

    let skipKeys = ["key", "abilityInfoId", "units", "group",];
    let statFields = {};
    for (let k in entry) {
      if (!skipKeys.includes(k)) statFields[k] = entry[k];
    }

    // NEW: if entry has a kilerModifier, look it up in modifierData to get type/value
    if (entry.kilerModifier && modifierData[entry.kilerModifier]) {
      let mod = modifierData[entry.kilerModifier];
      if (mod.type) statFields.type = mod.type;
      if (mod.value !== undefined) statFields.value = mod.value;
    }

    if (!result[name] || lvl > result[name].level) {
      result[name] = {
        name,
        ...statFields,
        appliesTo: entry.units,
        level: lvl
      };
    }
  }

  return Object.values(result);
}

function getTalentsForUnit(unitKey, level) {
  let seen = new Set();
  let all = [
    ...getModifierTalents(unitKey, level),
    ...getAbilityTalents(unitKey, level),
    ...getTroopCountTalents(unitKey, level),
    ...getHeroIconTalents(unitKey, level)
  ];

  return all.filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

function getHeroIconTalents(unitKey, level) {
  // find the heroTalent entry for this unit
  let heroTalentEntry = Object.values(heroTalentData).find(t => t.heroId === unitKey);
  if (!heroTalentEntry || !heroTalentEntry.icon) return [];

  // icon e.g. "talent_demonMage_meteoricRequiem" -> talent name = "meteoricRequiem"
  let iconParts = heroTalentEntry.icon.split("_");
  // drop "talent" and unitKey parts, rest is the talent name
  // "talent_demonMage_meteoricRequiem" -> ["talent","demonMage","meteoricRequiem"] -> "meteoricRequiem"
  let talentName = iconParts.slice(2).join("_");

  // look up abilityData[talentName_level] e.g. "meteoricRequiem_10"
  let abilityEntry = abilityData ? abilityData[talentName + "_" + level] : null;
  if (!abilityEntry) {
    // fallback to highest available level
    for (let l = level; l >= 1; l--) {
      abilityEntry = abilityData ? abilityData[talentName + "_" + l] : null;
      if (abilityEntry) break;
    }
  }
  if (!abilityEntry) return [];

  // skip metadata keys
  let skipKeys = ["key", "abilityInfoId", "iconId", "isActive", "isImmortalWhenActive",
    "sourceRestrictionId", "targetRestrictionId", "sourceEffectId", "targetEffectId",
    "showInLobbyUi", "title_Localized", "description_Localized"];

  let statFields = {};
  for (let k in abilityEntry) {
    if (!skipKeys.includes(k)) statFields[k] = abilityEntry[k];
  }

  return [{
    name: talentName,
    ...statFields,

    level: level
  }];
}
