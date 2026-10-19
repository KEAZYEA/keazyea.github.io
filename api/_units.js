/**
 * api/_units.js
 * The game data games-core.js builds its units from, for the server. One
 * plain require per file (not a loop over names) so Vercel bundles every
 * file with the functions that use it.
 */
const G = require("../games-core.js");

const FILES = {
  "troops.json": () => require("../troops.json"),
  "troopsLevel.json": () => require("../troopsLevel.json"),
  "hero.json": () => require("../hero.json"),
  "heroLevel.json": () => require("../heroLevel.json"),
  "localization.json": () => require("../localization.json"),
  "en.json": () => require("../en.json"),
  "heroTalent.json": () => require("../heroTalent.json"),
  "heroTalentLevel.json": () => require("../heroTalentLevel.json"),
  "unitParameterModifierNested.json": () => require("../unitParameterModifierNested.json"),
  "abilityInfo.json": () => require("../abilityInfo.json"),
  "abilityAoeAttackReduction.json": () => require("../abilityAoeAttackReduction.json"),
  "abilityAoeDamage.json": () => require("../abilityAoeDamage.json"),
  "abilityAoeDamageSuicide.json": () => require("../abilityAoeDamageSuicide.json"),
  "abilityAoeExtraGold.json": () => require("../abilityAoeExtraGold.json"),
  "abilityAoeFearEffect.json": () => require("../abilityAoeFearEffect.json"),
  "abilityAoeHeal.json": () => require("../abilityAoeHeal.json"),
  "abilityAoeMeteoriteSummon.json": () => require("../abilityAoeMeteoriteSummon.json"),
  "abilityAuraBlessing.json": () => require("../abilityAuraBlessing.json"),
  "abilityAuraDefence.json": () => require("../abilityAuraDefence.json"),
  "abilityCharge.json": () => require("../abilityCharge.json"),
  "abilityDarknessSummon.json": () => require("../abilityDarknessSummon.json"),
  "abilityFear.json": () => require("../abilityFear.json"),
  "abilityFireGolem.json": () => require("../abilityFireGolem.json"),
  "abilityHealOverTime.json": () => require("../abilityHealOverTime.json"),
  "abilityInitialModifier.json": () => require("../abilityInitialModifier.json"),
  "abilityMetamorph.json": () => require("../abilityMetamorph.json"),
  "abilityMindControl.json": () => require("../abilityMindControl.json"),
  "abilityModifierAura.json": () => require("../abilityModifierAura.json"),
  "abilityPet.json": () => require("../abilityPet.json"),
  "abilityPiercingMove.json": () => require("../abilityPiercingMove.json"),
  "abilityPiercingShip.json": () => require("../abilityPiercingShip.json"),
  "abilityPiercingSummonProjectile.json": () => require("../abilityPiercingSummonProjectile.json"),
  "abilityPoisonFearAoe.json": () => require("../abilityPoisonFearAoe.json"),
  "abilityPowerJump.json": () => require("../abilityPowerJump.json"),
  "abilityPullClaws.json": () => require("../abilityPullClaws.json"),
  "abilityRage.json": () => require("../abilityRage.json"),
  "abilityRangeDemonAoe.json": () => require("../abilityRangeDemonAoe.json"),
  "abilityRebirth.json": () => require("../abilityRebirth.json"),
  "abilityRebirthLimited.json": () => require("../abilityRebirthLimited.json"),
  "abilityRoots.json": () => require("../abilityRoots.json"),
  "abilityShieldDash.json": () => require("../abilityShieldDash.json"),
  "abilityShieldLimitBuff.json": () => require("../abilityShieldLimitBuff.json"),
  "abilitySleep.json": () => require("../abilitySleep.json"),
  "abilitySnowball.json": () => require("../abilitySnowball.json"),
  "abilitySpirit.json": () => require("../abilitySpirit.json"),
  "abilitySpiritDruid.json": () => require("../abilitySpiritDruid.json"),
  "abilityStormCloud.json": () => require("../abilityStormCloud.json"),
  "abilitySummon.json": () => require("../abilitySummon.json"),
  "abilitySummonProjectile.json": () => require("../abilitySummonProjectile.json"),
  "abilitySunrise.json": () => require("../abilitySunrise.json"),
  "abilityTeleport.json": () => require("../abilityTeleport.json"),
  "abilityToadJump.json": () => require("../abilityToadJump.json"),
  "abilityTornado.json": () => require("../abilityTornado.json"),
  "abilityTriangularAoe.json": () => require("../abilityTriangularAoe.json"),
  "abilityVortex.json": () => require("../abilityVortex.json"),
  "abilityWaterPuddles.json": () => require("../abilityWaterPuddles.json"),
  "abilityWhirlwind.json": () => require("../abilityWhirlwind.json"),
};

let units = null;
function loadUnits() {
  if (!units) {
    units = G.unitsFromFiles((f) => {
      if (!FILES[f]) throw new Error("games data file not listed in api/_units.js: " + f);
      return FILES[f]();
    });
  }
  return units;
}

module.exports = { loadUnits };
