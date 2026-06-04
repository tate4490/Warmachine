#!/usr/bin/env python3
"""
Warmachine Army Reference File Builder (All Formats)
=====================================================
Extracts fully self-contained JSON reference files for every army in
data_general.json -- Prime and Legacy -- using the canonical card eligibility
rules documented in the wm-card skill.

Eligibility rule (in priority order):
    1. card.guidStr in army.excludedCardIds  -> excluded, full stop
    2. card.guidStr in army.includedCardIds  -> included, bypasses gates 3-5
    3. card.factionId != army.factionId      -> excluded
    4. card.editionId != army.editionId      -> excluded
    5. army.includedKeywordsIds is empty     -> included (no keyword filter)
    6. card.keywordsIds intersects army.includedKeywordsIds -> included

Key differences from build_army_files.py (Prime-only):
    - Covers all arenas (Prime and Legacy) derived from army.arenaId -> arena.v5Name
    - Uses army.arenaId to determine format; ignores the unreliable isUnlimited flag
    - Uses card.keywordsIds (not card.keywords, which is empty in data_general.json)
    - Cadre keyword logic is scoped per-arena to avoid cross-format contamination
    - Output files are organized into subdirectories by format: Prime/ and Legacy/

Usage:
    # Build all armies (Prime and Legacy)
    python3 build_all_armies.py

    # Build specific armies by name
    python3 build_all_armies.py "Grymkin" "Winter Korps"

    # Specify input file and/or output directory
    python3 build_all_armies.py --input /path/to/data_general.json --output ./armies

    # Build only one format
    python3 build_all_armies.py --format Prime
    python3 build_all_armies.py --format Legacy

Notes:
    - validAttachmentIds are NOT embedded (optional upgrades with their own cards).
    - companionIds and requiredAttachmentIds ARE embedded as companionCards.
    - Mercenaries are duplicated into each army file that has access to them.
    - Output directory structure: <output>/Prime/ and <output>/Legacy/
    - Format label comes from arena.v5Name ("Prime" or "Legacy"), not arena.name.
"""

import json
import os
import sys
import argparse
from collections import defaultdict


# ---------------------------------------------------------------------------
# Fields to strip from all output objects (internal/publishing metadata)
# ---------------------------------------------------------------------------

STRIP_FIELDS = {
    'arenaId', 'animosityIds', 'animosityKeywordsIds',
    'artSegId', 'articleId', 'chapterId', 'publicationId', 'dataBundleId',
}


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------

def card_in_army(card, army):
    """
    Canonical eligibility check per wm-card skill rules.
    Uses card.keywordsIds (not card.keywords -- the latter is empty here).
    """
    cid = card['guidStr']

    # Gate 1: hard exclude
    if cid in set(army.get('excludedCardIds', [])):
        return False

    # Gate 2: explicit include (bypasses faction/edition/keyword)
    if cid in set(army.get('includedCardIds', [])):
        return True

    # Gate 3: faction
    if card.get('factionId') != army.get('factionId'):
        return False

    # Gate 4: edition
    if card.get('editionId') != army.get('editionId'):
        return False

    # Gate 5: keyword filter (empty = no filter = all faction+edition cards included)
    inc_kw = army.get('includedKeywordsIds', [])
    if not inc_kw:
        return True

    return bool(set(card.get('keywordsIds', [])) & set(inc_kw))


def get_army_card_ids(army, cards_list, all_card_guids):
    """Return the set of card GUIDs eligible for this army."""
    pool = set()
    excluded = set(army.get('excludedCardIds', []))
    explicitly_included = set(army.get('includedCardIds', []))

    for card in cards_list:
        if card_in_army(card, army):
            pool.add(card['guidStr'])

    # includedCardIds may reference GUIDs not in cards (e.g. command cards); skip those
    pool |= {cid for cid in explicitly_included if cid in all_card_guids}
    pool -= excluded
    return pool


# ---------------------------------------------------------------------------
# Resolution helpers (identical logic to build_army_files.py)
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
    return resolve_help_terms(strip(dict(keyword_map[kid])), helpterm_map)


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

    ct_id = c.pop('cardTypeId', None)
    c['cardType'] = (
        resolve_help_terms(strip(maps['card_type'][ct_id]), maps['helpterm'])
        if ct_id in maps['card_type'] else ct_id
    )

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
# Build a single army file
# ---------------------------------------------------------------------------

def build_army_file(army, raw, maps, arena_label, out_path):
    faction = resolve_help_terms(
        strip(dict(maps['faction'][army['factionId']])), maps['helpterm']
    )

    all_card_guids = {c['guidStr'] for c in raw['cards']}
    card_ids = get_army_card_ids(army, raw['cards'], all_card_guids)
    card_ids = {cid for cid in card_ids if cid in maps['card']}

    # Strip companions that will be embedded under their parent
    embedded_companion_ids = set()
    for cid in card_ids:
        card = maps['card'].get(cid, {})
        for companion_id in card.get('companionIds', []) + card.get('requiredAttachmentIds', []):
            embedded_companion_ids.add(companion_id)
    card_ids -= embedded_companion_ids

    cards = [rc for cid in card_ids for rc in [resolve_card(cid, maps)] if rc]
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
    army_out['format'] = arena_label

    output = {
        'army':         army_out,
        'faction':      faction,
        'cards':        cards,
        'commandCards': cmd_cards,
    }

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    size = os.path.getsize(out_path)
    faction_name = maps['faction'].get(army['factionId'], {}).get('name', ['?'])[0]
    native = sum(1 for c in cards
                 if maps['card'].get(c['guidStr'], {}).get('factionId') == army['factionId'])
    non_native = len(cards) - native
    print(f"  [{arena_label}] {os.path.basename(out_path)}")
    print(f"    Faction: {faction_name}")
    print(f"    Cards: {len(cards)} ({native} native, {non_native} non-native)")
    print(f"    Command cards: {len(cmd_cards)}")
    print(f"    File size: {size:,} bytes ({size / 1024:.1f} KB)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Build Warmachine army reference files for all formats.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('armies', nargs='*', help='Army names to build (default: all)')
    parser.add_argument('--input',  default='data general.json', help='Path to data_general.json')
    parser.add_argument('--output', default='WM_Army_Files',     help='Output root directory')
    parser.add_argument('--format', choices=['Prime', 'Legacy'],  help='Limit to one format')
    args = parser.parse_args()

    # Load
    print(f"Loading {args.input}...")
    with open(args.input, encoding='utf-8') as f:
        raw = json.load(f)
    print(f"  Loaded {len(raw.get('cards', []))} cards, {len(raw.get('armies', []))} armies.")

    # Arena map: guidStr -> v5Name label ("Prime" or "Legacy")
    # v5Name is the player-facing label; arena.name is internal ("Prime"/"Unlimited")
    arena_map = {}
    for arena in raw.get('arenas', []):
        v5 = arena.get('v5Name') or []
        label = next((s for s in v5 if s), None) or arena.get('name', ['?'])[0]
        arena_map[arena['guidStr']] = label
    print(f"  Arenas: {sorted(set(arena_map.values()))}")

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

    # All armies, resolved to their format label via arenaId
    all_armies = []
    for army in raw.get('armies', []):
        arena_id = army.get('arenaId')
        label = arena_map.get(arena_id)
        if not label:
            continue
        if args.format and label != args.format:
            continue
        all_armies.append((army, label))

    print(f"  Found {len(all_armies)} armies across all formats.")

    # Filter to requested army names
    if args.armies:
        requested = set(args.armies)
        build_list = [(a, lbl) for a, lbl in all_armies if a['name'][0] in requested]
        not_found = requested - {a['name'][0] for a, _ in build_list}
        if not_found:
            print(f"\nWARNING: Army name(s) not found: {sorted(not_found)}")
            print("Available armies:")
            for army, label in sorted(all_armies, key=lambda x: x[0]['name'][0]):
                print(f"  [{label}] {army['name'][0]}")
            if not build_list:
                sys.exit(1)
    else:
        build_list = all_armies

    # Build
    print(f"\nBuilding {len(build_list)} army file(s) into '{args.output}/'...\n")
    errors = []
    for army, label in sorted(build_list, key=lambda x: (x[1], x[0]['name'][0])):
        army_name = army['name'][0]
        filename = (
            army_name.lower()
            .replace(' ', '_')
            .replace("'", '')
            .replace(',', '')
            + '.json'
        )
        out_path = os.path.join(args.output, label, filename)
        print(f"Building: {army_name}")
        try:
            build_army_file(army, raw, maps, label, out_path)
        except Exception as e:
            print(f"  ERROR: {e}")
            errors.append((army_name, label, e))

    print(f"\n{'=' * 50}")
    print(f"Done. {len(build_list) - len(errors)} file(s) written.")
    if errors:
        print(f"{len(errors)} error(s):")
        for name, label, e in errors:
            print(f"  [{label}] {name}: {e}")


if __name__ == '__main__':
    main()
