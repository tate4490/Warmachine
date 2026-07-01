# Warmachine Icon Reference

Converted from the app's own "Icon Reference" library page (`Reference/` folder
screenshots) into text form for quick lookup - use this instead of opening the
source images every time. Each entry includes a short visual description (for
matching against a card screenshot) and the record's `guidStr` in the
Data_Structure files (`model_advantages.json` for Advantages/Resistances,
`weapon_qualities.json` for Weapon Qualities).

If a new icon shows up on a card that isn't listed here, don't guess - it may
be a genuinely new mechanic (add it properly, see wm-new) or a UI-only icon
with no rules meaning (confirm with the person).

---

## Model Advantages

| Icon (visual description) | Name | guidStr |
|---|---|---|
| Black circle, white 6-point star (sheriff-badge style) | 'Jack Marshal | `a5b0a54f-c752-4ba0-87fe-2647613ceb3e` |
| Circular arrow pointing right, inside a ring | Advance Deployment | `400de431-5cc9-45cb-b0f8-e37f61744faa` |
| Dark mask/hooded silhouette with yellow starburst | Ambush | `64184d93-f771-45c8-bfe2-5bace8aa7a04` |
| Dark wave/fin shape | Amphibious | `7f18e656-8b16-4b71-90e1-dd3eea087634` |
| Vertical antenna/node shape | Arc Node | `f2755094-aa5d-4bf9-b445-e7f6caf359a5` |
| Diagonal slashed/torn shape | Assault | `2b6c3849-4237-4667-9ec7-f43f724acc99` |
| Horse head silhouette | Cavalry | `64509333-5e49-4e61-9993-e8fa3de58b3f` |
| Crossed swords with a diagonal slash overlay | Combined Melee Attack | `a0a536f3-62a1-4e22-bdd3-29f23ed7ab9d` |
| Crossed ranged weapons with a diagonal slash overlay | Combined Ranged Attack | `a07b8f48-3a15-4747-a86f-ac1d5dc300b3` |
| Single wrench/pick-axe silhouette | Construct | `2dae2089-c98a-4d99-bec3-5b1ad72b5a4b` |
| Crossed hammer/pick tools | Dual Attack | `dd6bfd0d-8fbe-4c59-a9f9-073fca0e5de6` |
| Single eye in a ring | Eyeless Sight | `dadd3434-11b1-4961-aced-9f1977a10ec8` |
| Wing/feather shape | Flight | `161493f9-c421-4d15-b3e8-64bfba167863` |
| Helmet profile (gladiator-style) | Gladiator | `b20c04e2-8777-4d82-82db-3bbea403862b` |
| Revolver/pistol silhouette | Gunfighter | `ed0f2490-b35a-4ad1-bb30-3510e5f15d5f` |
| Dark helmet/hood shape with yellow starburst | Headbutt Power Attack | `7cc10016-772a-4faa-8cc0-96a1108f066f` |
| Ghost/skull-hood silhouette | Incorporeal | `dc67f649-b9cf-410b-b8c2-165cdd4eec62` |
| Boot silhouette | Pathfinder | `4ed29e21-f2d2-45c4-b27e-802d21884ad5` |
| Yellow downward arrow on dark burst | Slam Power Attack | `b9d27fc3-95e1-4a5d-b71a-46e46d3e303c` |
| Swirl/spiral shape | Soulless | `a90f9025-fdc5-4f7f-9893-ba356be63e60` |
| Vertical ribbed/bandage shape | Stealth | `22d83447-2f18-4482-8b47-cf5d8d3e39de` |
| Asterisk/plain star | Tough | `23d8e5f4-a479-414b-a368-af3c8328414e` |
| Wheel/hoof shape with motion lines | Trample Power Attack | `ac133871-865b-49aa-aea8-42b71f346aa2` |
| Skull silhouette | Undead | `6555f43d-b797-401b-b6fe-3392f831af3d` |
| Compass/directional arrows in a ring | Unstoppable | `f5200740-40c9-44b6-b70c-2ae2161156a9` (**stored as "Unstopable"** - typo in source data, match the existing spelling) |

## Model Resistances

| Icon (visual description) | Name | guidStr |
|---|---|---|
| Red "no" circle over a blast/explosion symbol | Resistance: Blast | `f4fa6176-f6ab-4da6-bbb0-628b45fbebb8` |
| Red "no" circle over a snowflake | Resistance: Cold | `b0a614f3-3f73-46a4-8713-09fcdec658ff` |
| Red "no" circle over a dripping/corrosion symbol | Resistance: Corrosion | `bd167369-ce44-47d8-ab31-497ab7c8703b` |
| Red "no" circle over a lightning bolt | Resistance: Electricity | `94759d91-77f6-4971-ba90-542a97ea83d7` |
| Red "no" circle over a flame | Resistance: Fire | `626fc2c8-e564-4cdb-bb59-0f204938bf36` |

## Weapon Qualities

| Icon (visual description) | Name | guidStr |
|---|---|---|
| Halo/blessing symbol over a weapon | Blessed | `1eb9561e-efe7-4b00-be90-f9eddcfa91a7` |
| Round shield with a dot/boss | Buckler | `c02f0323-c6e0-4de3-b5a0-2e2659aaeb15` |
| Linked chain segments | Chain Weapon | `66f7ef06-7f1f-455b-8a06-8893871f1f7e` |
| Green vial/flask (continuous drip) | Continuous Effect: Corrosion | `e4471b02-80a4-4951-b7c6-790474bab53c` |
| Orange flame (continuous burn) | Continuous Effect: Fire | `4152d18e-cf65-4924-ac43-e0a8548ae469` |
| Corrosion droplet with a crit-star overlay | Critical Corrosion | `09028b1d-0101-46bd-9467-50f6a1ff97d1` |
| Gear/disruption symbol with a crit-star overlay | Critical Disruption | `70897a96-393e-4355-aba8-d7b0020d9f3b` |
| Flame with a crit-star overlay | Critical Fire | `050fd8a9-4e54-462e-ada1-eea7099cd8f1` |
| Snowflake | Damage Type: Cold | `8e0aebf9-2a86-4921-b66d-34465342a5d1` |
| Green vial/flask | Damage Type: Corrosion | `bf0a49d8-9a98-4a62-bab2-230adbb9a481` |
| Yellow lightning bolt | Damage Type: Electricity | `31f6cd6a-10ae-499f-a8af-d9539e74e56e` |
| Orange flame | Damage Type: Fire | `86b1bdb8-7ec9-47af-8a94-024d89f18429` |
| Crossed/woven pattern (arcane) | Damage Type: Magical | `72eadc6f-3cfb-4cd3-b01b-6025df3dccd9` |
| Gear/cog symbol | Disruption | `fc6961c1-fc96-42fa-a906-d0910ca77209` |
| Single pistol silhouette | Pistol | `732594ab-49a5-483b-b63e-ce221c9969da` |
| Shield with a numeral | Shield | `79a058dd-436e-4f6f-98ce-3b710de279d3` |
| Fist/throwing motion symbol | Throw Power Attack | `cd9820fb-ffcf-4aee-b793-d69acef4dc0c` |
| Weapon with a ribbed/banded haft | Weapon Master | `03c1ea67-8233-48ba-b782-f53a1f099ec7` |

---

## Notes

- This list reflects the two reference images in the repo's `Reference/`
  folder as of this writing. If more entries get added to the app's own
  Icon Reference page later, this file will need a manual refresh - it isn't
  auto-generated.
- Base size (e.g. "80" in a plain circle) is not part of this legend - it's
  a numeral badge showing the model's base diameter in mm, and maps to a
  `z_XXmm` entry in `modelAdvantageIds` if `baseSize` is blank on the model
  record (see wm-new).
- Visual descriptions here are a memory aid, not a substitute for looking at
  the actual icon when there's any doubt - two icons in the same category can
  look superficially similar (e.g. Dual Attack vs. Construct both involve
  tool-like shapes) and are worth zooming in on rather than pattern-matching
  from a text description alone.
