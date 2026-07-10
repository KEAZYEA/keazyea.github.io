var abilityData = {};
var abilityInfoKeys = new Set();

function loadAbilities(loadJSON) {

  const abilityFiles = [

    "abilityAddNeighbourUnitModifier.json",
    "abilityAddNeighbourUnitModifierOnReflectDamage.json",
    "abilityAddUnitAbility.json",
    "abilityAddUnitModifier.json",
    "abilityAddUnitModifierOnAoeEvasion.json",
    "abilityAoeAggression.json",
    "abilityAoeAttackReduction.json",
    "abilityAoeDamage.json",
    "abilityAoeDamageSuicide.json",
    "abilityAoeExtraGold.json",
    "abilityAoeFearEffect.json",
    "abilityAoeHeal.json",
    "abilityAoeMeteoriteSummon.json",
    "abilityAoePull.json",
    "abilityAoeSqueeze.json",
    "abilityAuraBlessing.json",
    "abilityAuraDefence.json",
    "abilityBleed.json",
    "abilityCharge.json",
    "abilityCure.json",
    "abilityDamageLevelup.json",
    "abilityDamageLevelupNested.json",
    "abilityDarknessRange.json",
    "abilityDarknessSummon.json",
    "abilityDevour.json",
    "abilityDisableHeroAbility.json",
    "abilityFear.json",
    "abilityFireGolem.json",
    "abilityHealOverTime.json",
    "abilityHex.json",

    "abilityInfo.json",
    "abilityInitialEffect.json",
    "abilityInitialModifier.json",
    "abilityKrakenCannon.json",
    "abilityLevelup.json",
    "abilityLightning.json",
    "abilityMelee.json",
    "abilityMeleeEmpowered.json",
    "abilityMeleePoison.json",
    "abilityMeleeThrow.json",
    "abilityMetamorph.json",
    "abilityMeteoriteCellsBuff.json",
    "abilityMindControl.json",
    "abilityModifierAura.json",
    "abilityMultiAoeDamage.json",
    "abilityMultiAoeDamageHit.json",
    "abilityMultiShotDebuff.json",
    "abilityMultiplyDamage.json",
    "abilityPet.json",
    "abilityPiercingAoe.json",
    "abilityPiercingFire.json",
    "abilityPiercingMove.json",
    "abilityPiercingRange.json",
    "abilityPiercingShip.json",
    "abilityPiercingSummonProjectile.json",
    "abilityPoisonAreas.json",
    "abilityPoisonDebuffPuddles.json",
    "abilityPoisonFearAoe.json",
    "abilityPoisonPuddles.json",
    "abilityPowerJump.json",
    "abilityPullClaws.json",
    "abilityRage.json",
    "abilityRange.json",
    "abilityRangeDemonAoe.json",
    "abilityRangeFlame.json",
    "abilityRangeMultiple.json",
    "abilityRangeStun.json",
    "abilityRay.json",
    "abilityRayPoison.json",
    "abilityRebirth.json",
    "abilityRebirthLimited.json",
    "abilityRestriction.json",
    "abilityRestrictionStats.json",
    "abilityResurrection.json",
    "abilityRoots.json",
    "abilityRunAway.json",
    "abilityShadowBlink.json",
    "abilityShieldDash.json",
    "abilityShieldLimitBuff.json",
    "abilitySleep.json",
    "abilitySnowball.json",
    "abilitySpecialThrow.json",
    "abilitySpirit.json",
    "abilitySpiritDruid.json",
    "abilityStormCloud.json",
    "abilitySummon.json",
    "abilitySummonAfterDeath.json",
    "abilitySummonAfterDeathNoTimeLimit.json",
    "abilitySummonMultiple.json",
    "abilitySummonProjectile.json",
    "abilitySunrise.json",
    "abilityTargetMinions.json",
    "abilityTeleport.json",
    "abilityTeleportProjectile.json",
    "abilityTentacle.json",
    "abilityToadJump.json",
    "abilityTornado.json",
    "abilityTriangularAoe.json",
    "abilityUndeadAoeAfterDeath.json",
    "abilityUndeadAoeAttack.json",
    "abilityVortex.json",
    "abilityWaterPuddles.json",
    "abilityWhirlwind.json"
  ];

  return Promise.all(abilityFiles.map(file => loadJSON(file)))
    .then(results => {

      results.forEach((data, index) => {
        let isInfoFile = abilityFiles[index] === "abilityInfo.json";
        for (let key in data) {
          abilityData[key] = data[key];
          // only entries from abilityInfo.json are eligible for method 1 matching
          if (isInfoFile) abilityInfoKeys.add(key);
        }
      });

    });
}

const showBasicAttackAsAbility = {
    magicArcher: true
};
const abilityAliasMap = {
    demonMageGolem: "vulkanGolem"
};
const imageAliasMap = {
    demonMageGolem: "vulkanGolem"
};

function cleanAbility(raw) {
  let cleaned = {};

  const skipAbilityKeys = ["key", "rootsEffectRestriction", "poisonRestrictionId"];

  for (let key in raw) {
    if (skipAbilityKeys.includes(key) || (key.endsWith("Id") && key !== "summonedTroopId")) continue;
    cleaned[key] = raw[key];
  }

  // find ALL matching modifiers for this ability
  let modKey = raw.modifierKey || raw.modifier;
  if (modKey) {
    let mods = Object.values(modifierData).filter(m =>
      m.modifierKey === modKey && m.modifierKey // non-empty/specific
    );
    // debug: log how many matched
    if (mods.length > 3) {
      console.warn("Suspicious modifier match for", modKey, mods.length, "entries");
    }
    mods.forEach(m => cleaned[m.type] = m.value);
  }

  delete cleaned.modifier;
  delete cleaned.modifierKey;

  return cleaned;
}

function getAbilitiesForUnit(unitKey, level) {
  let lookupKey = abilityAliasMap[unitKey] || unitKey;
  let bestAbilities = {};

  // Method 3: "reflect_aura_<unitKey>_<level>_<n>" style entries living in modifierData
  // (e.g. unitParameterModifierNested.json), not abilityData. These don't have an
  // abilityInfoId and their key doesn't start with the unit key, so methods 1 & 2 can't find them.
  if (typeof modifierData !== "undefined") {
    for (let key in modifierData) {
      let entry = modifierData[key];
      let prefixMatch = key.match(/^(.+)_([a-zA-Z0-9]+)_(\d+)_(\d+)$/);
      if (!prefixMatch) continue;

      let abilityPrefix = prefixMatch[1];   // e.g. "reflect_aura"
      let unit = prefixMatch[2];            // e.g. "cactus"
      let abilityLevel = parseInt(prefixMatch[3]);

      if (unit !== lookupKey) continue;
      if (abilityLevel > level) continue;

      let abilityName = abilityPrefix;
      if (!bestAbilities[abilityName] || abilityLevel > bestAbilities[abilityName].level) {
        let cleaned = { name: abilityName, abilityInfoId: abilityName };
        cleaned[entry.type] = entry.value;
        bestAbilities[abilityName] = {
          level: abilityLevel,
          data: cleaned
        };
      }
    }
  }

  for (let key in abilityData) {
    let entry = abilityData[key];
    let parts = key.split("_");
    let abilityLevel, abilityName, unit;

    if (entry.abilityInfoId && abilityInfoKeys.has(key)) {
      let infoParts = entry.abilityInfoId.split("_");
      unit = infoParts.slice(0, -1).join("_");
    }

    if (!unit || unit !== lookupKey) {
    if (!key.startsWith(lookupKey)) continue;
    let remainder = parts.slice(lookupKey.split("_").length);
      if (remainder.length === 0) continue;

      if (!isNaN(parseInt(remainder[0]))) {
        abilityLevel = parseInt(remainder[0]);
        abilityName = remainder.slice(1).join("_");
      } else if (!isNaN(parseInt(remainder[remainder.length - 1]))) {
        abilityLevel = parseInt(remainder[remainder.length - 1]);
        abilityName = remainder.slice(0, -1).join("_");
      } else {
        continue;
      }

      // skip base attack stat blocks (not real abilities), unless explicitly allowed
      if ((abilityName === "range" || abilityName === "melee") && !showBasicAttackAsAbility[lookupKey]) continue;
    } else {
      if (unit !== unitKey) continue;
      abilityLevel = parseInt(parts[parts.length - 1]);
      abilityName = parts.slice(0, -1).join("_");
      if (isNaN(abilityLevel)) continue;
    }

   if (abilityLevel > level) continue;
    if ((abilityName === "range" || abilityName === "melee") && !showBasicAttackAsAbility[lookupKey]) continue;
    console.log("MATCH:", key, "-> name:", abilityName, "level:", abilityLevel, entry);

if (!bestAbilities[abilityName] || abilityLevel > bestAbilities[abilityName].level) {
      let cleaned = cleanAbility(entry);
      cleaned.name = abilityName;
      cleaned.abilityInfoId = entry.abilityInfoId || abilityName;
      bestAbilities[abilityName] = {
        level: abilityLevel,
        data: cleaned
      };
    }
  }

  return Object.values(bestAbilities).map(a => a.data);
}


function getAbilityDescription(abilityInfoId) {
    if (!abilityInfoId || !abilityData) return "";
    let entry = abilityData[abilityInfoId];
    if (!entry) return "";
    let locKey = entry.description_Localized;
    if (!locKey) return "";
    let locEntry = localization[locKey];
    if (!locEntry) return "";
    return en[locEntry.value] || "";
}
