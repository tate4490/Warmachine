# data_map.md
Mapping of `data_general.json` top-level keys to split files.

---

## Core / Config

| Key | File | Notes |
|-----|------|-------|
| `general` | `general.json` | App-wide settings, color constants, HT ID lists, arena/edition/game-type references |
| `arenas` | `arenas.json` | 2 entries: Prime, Unlimited/Legacy |
| `editions` | `editions.json` | 2 entries: Legacy, MKIV |
| `gameTypes` | `game_types.json` | 1 entry |
| `matchTypes` | `match_types.json` | 9 entries |

---

## Factions & Armies

| Key | File | Notes |
|-----|------|-------|
| `factions` | `factions.json` | 19 factions |
| `armies` | `armies.json` | 54 army definitions |

---

## Cards

| Key | File | Notes |
|-----|------|-------|
| `cards` | `cards.json` | 1,650 card records |
| `cardTypes` | `card_types.json` | 17 card type definitions |
| `cardAbilities` | `card_abilities.json` | 222 card abilities |
| `cardOptions` | `card_options.json` | 354 card options/upgrades |
| `commandCards` | `command_cards.json` | 29 command cards |
| `commandCardAbilities` | `command_card_abilities.json` | 27 command card abilities |
| `spells` | `spells.json` | 458 spell definitions |
| `spellCards` | `spell_cards.json` | 0 entries (empty) |

---

## Models & Weapons

| Key | File | Notes |
|-----|------|-------|
| `models` | `models.json` | 1,807 model records |
| `modelAbilities` | `model_abilities.json` | 1,662 model ability definitions |
| `modelAdvantages` | `model_advantages.json` | 35 model advantage types |
| `weapons` | `weapons.json` | 3,062 weapon records |
| `weaponAbilities` | `weapon_abilities.json` | 396 weapon ability definitions |
| `weaponQualities` | `weapon_qualities.json` | 18 weapon quality types |

---

## Reference / Rules

| Key | File | Notes |
|-----|------|-------|
| `keywords` | `keywords.json` | 187 keyword definitions |
| `helpTerms` | `help_terms.json` | 393 help/glossary terms |
| `rulings` | `rulings.json` | 3 rulings |

---

## Packed ID Arrays

All packed ID arrays are consolidated into a single file for lookup convenience.

| Key | File | Count |
|-----|------|-------|
| `packedArenaIds` | `packed_ids.json` | 2 |
| `packedEditionIds` | `packed_ids.json` | 2 |
| `packedGameTypeIds` | `packed_ids.json` | 1 |
| `packedArmyIds` | `packed_ids.json` | 60 |
| `packedMatchTypeIds` | `packed_ids.json` | 11 |
| `packedCardIds` | `packed_ids.json` | 1,872 |
| `packedCardOptionIds` | `packed_ids.json` | 482 |
| `packedCommandCardIds` | `packed_ids.json` | 51 |
| `packedSpellCardIds` | `packed_ids.json` | 126 |

---

## Empty Keys (not split out)

The following keys were present in the source but contained empty arrays. They are not written to separate files.

`dataBundles`, `mediaBundles`, `releaseNotes`, `menuOptions`, `cardConfigs`, `steamrollerCards`, `cadres`, `libCats`, `libSubCats`, `articleSegments`, `articles`, `chapters`, `publications`, `marquees`
