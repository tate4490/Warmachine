#!/usr/bin/env python3
"""
Warmachine Prime Army Reference File Builder
=============================================
Extracts fully self-contained JSON reference files for each Prime (MKIV) army
from data_general.json. Each output file contains the full army roster with all
cards, models, weapons, abilities, spells, keywords, command cards, and mercenaries
fully resolved — no dangling ID references.

Usage:
    # Build all Prime armies
    python3 build_army_files.py

    # Build specific armies (exact name match)
    python3 build_army_files.py "Grymkin" "Old Umbrey"

    # Specify input file and/or output directory
    python3 build_army_files.py --input /path/to/data_general.json --output ./armies

    # Combine: specific armies with custom paths
    python3 build_army_files.py --input ./data_general.json --output ./out "Grymkin"

Prime armies (40 total):
    5th Division, Armored Korps, Army of the Western Reaches, Blackfleet,
    Blindwater Congregation, Brineblood Marauders, Convergence of Cyriss,
    Crucible Guard, Dark Host, Dark Operations, Devourer's Host, Dragon's Host,
    Exalted, Fane of Nyrro, Final Interdiction, First Army, Gravediggers,
    Grymkin, House Kallyss, Infernals, Kithguard, Legions of Dawn,
    Necrofactorium, Old Umbrey, Ravens of War, Reaper Covenant, Rhul Guard,
    Sea Raiders, Secret Dominion, Shadowflame Shard, Shadows of the Retribution,
    Soldiers of Fortune, Storm Knights, Storm Legion, Storm of the North,
    Talion Charter, Temple Guardians, Thornfall Alliance, United Kriels,
    Winter Korps

Notes:
    - Legacy/Unlimited armies are skipped entirely.
    - Card pool = army-specific keyword membership + cadre cards + explicit inclusions.
    - validAttachmentIds are NOT embedded (optional paid upgrades with their own cards).
    - companionIds and requiredAttachmentIds ARE embedded as companionCards.
    - Mercenaries are duplicated into each army file that has access to them.
    - Saxon Orrik edge case handled: single-army keywords never pull in off-faction cards.
"""

import json
import os
import sys
import argparse
from collections import defaultdict


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PRIME_ARENA_ID = 'eef0b157-f202-4d42-b8ee-12d5f5f58cd5'

STRIP_FIELDS = {
    'arenaId', 'animosityIds', 'animosityKeywordsIds',
    'artSegId', 'articleId', 'chapterId', 'publicationId', 'dataBundleId',
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def strip(d):
    return {k: v for k, v in d.items() if k not in STRIP_FIELDS}


def resolve_help_terms(obj, helpterm_map):
    obj['helpTerms'] = [
        strip(helpterm_map[h])
        for h in obj.pop('helpTermIds', [])
        if h in helpterm_map
    ]
    return obj


def resolve_keyword(kid, keyword_map, helpterm_map):
    if kid not in keyword_map:
        return None
    k = resolve_help_terms(strip(dict(keyword_map[kid])), helpterm_map)
    return k


def resolve_weapon(wid, weapon_map, weapon_ab_map, weapon_qu_map, helpterm_map):
    if wid not in weapon_map:
        return None
    w = resolve_help_terms(strip(dict(weapon_map[wid])), helpterm_map)
    w['weaponAbilities'] = [
        resolve_help_terms(strip(weapon_ab_map[a]), helpterm_map)
        for a in w.pop('weaponAbilityIds', [])
        if a in weapon_ab_map
    ]
    w['weaponQualities'] = [
        resolve_help_terms(strip(weapon_qu_map[q]), helpterm_map)
        for q in w.pop('weaponQualityIds', [])
        if q in weapon_qu_map
    ]
    return w


def resolve_model(mid, model_map, model_ab_map, model_adv_map,
                  weapon_map, weapon_ab_map, weapon_qu_map, helpterm_map):
    if mid not in model_map:
        return None
    m = resolve_help_terms(strip(dict(model_map[mid])), helpterm_map)
    m['modelAbilities'] = [
        resolve_help_terms(strip(model_ab_map[a]), helpterm_map)
        for a in m.pop('modelAbilityIds', [])
        if a in model_ab_map
    ]
    m['modelAdvantages'] = [
        resolve_help_terms(strip(model_adv_map[a]), helpterm_map)
        for a in m.pop('modelAdvantageIds', [])
        if a in model_adv_map
    ]
    m['weapons'] = [
        w for wid in m.pop('weaponIds', [])
        for w in [resolve_weapon(wid, weapon_map, weapon_ab_map, weapon_qu_map, helpterm_map)]
        if w
    ]
    return m


def resolve_card_option(oid, card_opt_map, model_map, model_ab_map, model_adv_map,
                        weapon_map, weapon_ab_map, weapon_qu_map, spell_map,
                        keyword_map, ruling_map, helpterm_map):
    if oid not in card_opt_map:
        return None
    o = resolve_help_terms(strip(dict(card_opt_map[oid])), helpterm_map)
    o['grantedModels'] = [
        m for mid in o.pop('grantedModelIds', [])
        for m in [resolve_model(mid, model_map, model_ab_map, model_adv_map,
                                weapon_map, weapon_ab_map, weapon_qu_map, helpterm_map)]
        if m
    ]
    o['grantedModelAbilities'] = [
        resolve_help_terms(strip(model_ab_map[a]), helpterm_map)
        for a in o.pop('grantedModelAbilityIds', [])
        if a in model_ab_map
    ]
    o['grantedSpells'] = [
        resolve_help_terms(strip(spell_map[s]), helpterm_map)
        for s in o.pop('grantedSpellIds', [])
        if s in spell_map
    ]
    o['grantedWeapons'] = [
        w for wid in o.pop('grantedWeaponIds', [])
        for w in [resolve_weapon(wid, weapon_map, weapon_ab_map, weapon_qu_map, helpterm_map)]
        if w
    ]
    o['keywords'] = [
        k for kid in o.pop('keywordsIds', [])
        for k in [resolve_keyword(kid, keyword_map, helpterm_map)]
        if k
    ]
    o['rulings'] = [
        strip(ruling_map[r])
        for r in o.pop('rulingsIds', [])
        if r in ruling_map
    ]
    return o


def resolve_card(cid, maps, resolved_cards=None):
    if resolved_cards is None:
        resolved_cards = set()
    if cid in resolved_cards or cid not in maps['card']:
        return None
    resolved_cards.add(cid)

    c = resolve_help_terms(strip(dict(maps['card'][cid])), maps['helpterm'])

    # Card type
    ct_id = c.pop('cardTypeId', None)
    c['cardType'] = (
        resolve_help_terms(strip(maps['card_type'][ct_id]), maps['helpterm'])
        if ct_id in maps['card_type'] else ct_id
    )

    # Inline resolutions
    c['keywords'] = [
        k for kid in c.pop('keywordsIds', [])
        for k in [resolve_keyword(kid, maps['keyword'], maps['helpterm'])]
        if k
    ]
    c['rulings'] = [
        strip(maps['ruling'][r])
        for r in c.pop('rulingsIds', [])
        if r in maps['ruling']
    ]
    c['cardAbilities'] = [
        resolve_help_terms(strip(maps['card_ab'][a]), maps['helpterm'])
        for a in c.pop('cardAbilityIds', [])
        if a in maps['card_ab']
    ]
    c['spells'] = [
        resolve_help_terms(strip(maps['spell'][s]), maps['helpterm'])
        for s in c.pop('spellIds', [])
        if s in maps['spell']
    ]
    c['models'] = [
        m for mid in c.pop('modelIds', [])
        for m in [resolve_model(mid, maps['model'], maps['model_ab'], maps['model_adv'],
                                maps['weapon'], maps['weapon_ab'], maps['weapon_qu'], maps['helpterm'])]
        if m
    ]
    c['grantedModels'] = [
        m for mid in c.pop('grantedModelIds', [])
        for m in [resolve_model(mid, maps['model'], maps['model_ab'], maps['model_adv'],
                                maps['weapon'], maps['weapon_ab'], maps['weapon_qu'], maps['helpterm'])]
        if m
    ]

    # Card options
    all_opt_ids = (
        c.pop('cardOption1Ids', []) + c.pop('cardOption2Ids', []) +
        c.pop('cardOption3Ids', []) + c.pop('cardOption4Ids', []) +
        c.pop('cardOption5Ids', []) + c.pop('cardOption6Ids', [])
    )
    c['cardOptions'] = [
        o for oid in all_opt_ids
        for o in [resolve_card_option(
            oid, maps['card_opt'], maps['model'], maps['model_ab'], maps['model_adv'],
            maps['weapon'], maps['weapon_ab'], maps['weapon_qu'], maps['spell'],
            maps['keyword'], maps['ruling'], maps['helpterm']
        )]
        if o
    ]

    # True companions only (required attachments + named companions)
    # validAttachmentIds are optional paid upgrades — do NOT embed
    companion_ids = (
        c.pop('companionIds', []) +
        c.pop('requiredAttachmentIds', [])
    )
    c.pop('validAttachmentIds', None)
    c.pop('characterAltIds', None)
    c.pop('summonIds', None)
    c.pop('grantedValidCardIds', None)
    c.pop('grantedCardIds', None)

    c['companionCards'] = [
        rc for crid in companion_ids
        for rc in [resolve_card(crid, maps, resolved_cards)]
        if rc
    ]

    return c


def resolve_cmd_card(cid, maps):
    if cid not in maps['cmd_card']:
        return None
    cc = resolve_help_terms(strip(dict(maps['cmd_card'][cid])), maps['helpterm'])
    cc['commandCardAbilities'] = [
        resolve_help_terms(strip(maps['cmd_ab'][a]), maps['helpterm'])
        for a in cc.pop('commandCardAbilityIds', [])
        if a in maps['cmd_ab']
    ]
    cc['keywords'] = [
        k for kid in cc.pop('keywordsIds', [])
        for k in [resolve_keyword(kid, maps['keyword'], maps['helpterm'])]
        if k
    ]
    cc['grantedCards'] = [
        rc for crid in cc.pop('grantedCardIds', [])
        for rc in [resolve_card(crid, maps)]
        if rc
    ]
    cc['grantedModels'] = [
        m for mid in cc.pop('grantedModelIds', [])
        for m in [resolve_model(mid, maps['model'], maps['model_ab'], maps['model_adv'],
                                maps['weapon'], maps['weapon_ab'], maps['weapon_qu'], maps['helpterm'])]
        if m
    ]
    return cc


# ---------------------------------------------------------------------------
# Card pool logic
# ---------------------------------------------------------------------------

def get_army_card_ids(army, raw, cadre_keyword_ids):
    """
    Build the full card pool for an army:
      - Cards with the army-specific keyword (NOT cadre keywords)
      - Cadre cards: off-faction cards carrying a keyword shared across 2+ prime armies
      - Explicit inclusions from includedCardIds (mercenaries etc.)
      - Minus excludedCardIds
    """
    included_kw_ids      = set(army.get('includedKeywordsIds', []))
    army_specific_kw_ids = included_kw_ids - cadre_keyword_ids
    cadre_kw_ids         = included_kw_ids & cadre_keyword_ids
    explicitly_included  = set(army.get('includedCardIds', []))
    excluded             = set(army.get('excludedCardIds', []))
    faction_id           = army.get('factionId')
    all_card_ids         = {c['guidStr'] for c in raw['cards']}

    pool = set()
    for card in raw['cards']:
        cid      = card['guidStr']
        card_kws = set(card.get('keywordsIds', []))
        if card_kws & army_specific_kw_ids:
            pool.add(cid)
        elif card_kws & cadre_kw_ids and card.get('factionId') != faction_id:
            pool.add(cid)

    pool |= {cid for cid in explicitly_included if cid in all_card_ids}
    pool -= excluded
    return pool


# ---------------------------------------------------------------------------
# Build a single army file
# ---------------------------------------------------------------------------

def build_army_file(army, raw, maps, cadre_keyword_ids, out_path):
    faction = resolve_help_terms(
        strip(dict(maps['faction'][army['factionId']])), maps['helpterm']
    )

    card_ids  = get_army_card_ids(army, raw, cadre_keyword_ids)
    card_ids  = {cid for cid in card_ids if cid in maps['card']}  # drop dead refs

    # Find all cards that are companions/required attachments of another card in the pool.
    # These should only appear embedded under their parent, not as standalone top-level cards.
    embedded_companion_ids = set()
    for cid in card_ids:
        card = maps['card'].get(cid, {})
        for companion_id in card.get('companionIds', []) + card.get('requiredAttachmentIds', []):
            embedded_companion_ids.add(companion_id)
    card_ids -= embedded_companion_ids

    cards     = [rc for cid in card_ids for rc in [resolve_card(cid, maps)] if rc]
    cmd_cards = [
        rc for cid in army.get('armyCommandCardIds', [])
        for rc in [resolve_cmd_card(cid, maps)]
        if rc
    ]

    army_out = resolve_help_terms(strip(dict(army)), maps['helpterm'])
    army_out['includedKeywords'] = [
        k for kid in army_out.pop('includedKeywordsIds', [])
        for k in [resolve_keyword(kid, maps['keyword'], maps['helpterm'])]
        if k
    ]

    output = {
        'army':         army_out,
        'faction':      faction,
        'cards':        cards,
        'commandCards': cmd_cards,
    }

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    size        = os.path.getsize(out_path)
    faction_name = maps['faction'].get(army['factionId'], {}).get('name', ['?'])[0]
    native      = sum(1 for c in cards if maps['card'].get(c['guidStr'], {}).get('factionId') == army['factionId'])
    non_native  = len(cards) - native
    print(f"  {os.path.basename(out_path)}")
    print(f"    Faction: {faction_name}")
    print(f"    Cards: {len(cards)} ({native} native, {non_native} non-native)")
    print(f"    Command cards: {len(cmd_cards)}")
    print(f"    File size: {size:,} bytes ({size / 1024:.1f} KB)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Build Warmachine Prime army reference files.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('armies', nargs='*', help='Army names to build (default: all)')
    parser.add_argument('--input',  default='data_general.json', help='Path to data_general.json')
    parser.add_argument('--output', default='armies',            help='Output directory')
    args = parser.parse_args()

    # Load source data
    print(f"Loading {args.input}...")
    with open(args.input, encoding='utf-8') as f:
        raw = json.load(f)
    print(f"  Loaded {len(raw.get('cards', []))} cards, {len(raw.get('armies', []))} armies.")

    # Build lookup maps
    print("  Building lookup maps...")
    maps = {
        'faction':   {f['guidStr']: f for f in raw['factions']},
        'card':      {c['guidStr']: c for c in raw['cards']},
        'model':     {m['guidStr']: m for m in raw['models']},
        'weapon':    {w['guidStr']: w for w in raw['weapons']},
        'spell':     {s['guidStr']: s for s in raw['spells']},
        'card_ab':   {a['guidStr']: a for a in raw['cardAbilities']},
        'model_ab':  {a['guidStr']: a for a in raw['modelAbilities']},
        'model_adv': {a['guidStr']: a for a in raw['modelAdvantages']},
        'weapon_ab': {a['guidStr']: a for a in raw['weaponAbilities']},
        'weapon_qu': {q['guidStr']: q for q in raw['weaponQualities']},
        'cmd_card':  {c['guidStr']: c for c in raw['commandCards']},
        'cmd_ab':    {a['guidStr']: a for a in raw['commandCardAbilities']},
        'card_opt':  {o['guidStr']: o for o in raw['cardOptions']},
        'card_type': {t['guidStr']: t for t in raw['cardTypes']},
        'keyword':   {k['guidStr']: k for k in raw['keywords']},
        'ruling':    {r['guidStr']: r for r in raw['rulings']},
        'helpterm':  {h['guidStr']: h for h in raw['helpTerms']},
    }

    # Identify Prime armies
    prime_armies = [
        a for a in raw['armies']
        if a.get('arenaId') == PRIME_ARENA_ID and not a.get('isUnlimited')
    ]
    print(f"  Found {len(prime_armies)} Prime armies.")

    # Identify cadre keywords (shared across 2+ prime armies)
    kw_army_count = defaultdict(list)
    for army in prime_armies:
        for kid in army.get('includedKeywordsIds', []):
            kw_army_count[kid].append(army['guidStr'])
    cadre_keyword_ids = {kid for kid, armies in kw_army_count.items() if len(armies) > 1}
    cadre_names = sorted(
        maps['keyword'].get(k, {}).get('name', ['?'])[0] for k in cadre_keyword_ids
    )
    print(f"  Cadre keywords: {cadre_names}")

    # Filter to requested armies
    if args.armies:
        requested  = set(args.armies)
        build_list = [a for a in prime_armies if a['name'][0] in requested]
        not_found  = requested - {a['name'][0] for a in build_list}
        if not_found:
            print(f"\nWARNING: Army name(s) not found: {sorted(not_found)}")
            print("Available Prime armies:")
            for a in sorted(prime_armies, key=lambda x: x['name'][0]):
                print(f"  {a['name'][0]}")
            if not build_list:
                sys.exit(1)
    else:
        build_list = prime_armies

    # Build files
    print(f"\nBuilding {len(build_list)} army file(s) into '{args.output}/'...\n")
    errors = []
    for army in sorted(build_list, key=lambda a: a['name'][0]):
        army_name = army['name'][0]
        filename  = army_name.lower().replace(' ', '_').replace("'", '').replace(',', '') + '.json'
        out_path  = os.path.join(args.output, filename)
        print(f"Building: {army_name}")
        try:
            build_army_file(army, raw, maps, cadre_keyword_ids, out_path)
        except Exception as e:
            print(f"  ERROR: {e}")
            errors.append((army_name, e))

    print(f"\n{'='*50}")
    print(f"Done. {len(build_list) - len(errors)} file(s) written to '{args.output}/'.")
    if errors:
        print(f"{len(errors)} error(s):")
        for name, e in errors:
            print(f"  {name}: {e}")


if __name__ == '__main__':
    main()
