/**
 * Picker grouping helpers (pure).
 *
 * The icon picker shows two sections: vendor marks (the company or channel) and
 * model marks (the model product). This module turns the merged artwork set plus
 * the generated prominence ranks into those two ordered lists, and applies the
 * picker's search filter. It has no DOM or React imports, so the ordering and
 * filtering rules are unit-testable without mounting the modal.
 */
import type { LogoGroup, LogoSet } from '../types';

/** One picker entry after grouping, ranking and normalization. */
export interface GroupedLogoEntry {
  key: string;
  title: string;
  svg: string;
  group: LogoGroup;
  /** Generated prominence rank; 1 is the most prominent. */
  rank: number;
}

/** The two picker sections, already sorted by rank. */
export interface LogoGroups {
  vendor: GroupedLogoEntry[];
  model: GroupedLogoEntry[];
}

/**
 * Model-group marks that official vendor channels also use.
 *
 * DeepSeek, Mistral and MiniMax publish one mark for both the company and its
 * models. The mark lives in the model group, while the vendor channel rows still
 * resolve to it; the build validates this explicit exception list.
 */
export const SHARED_VENDOR_MARKS: readonly string[] = Object.freeze(['deepseek', 'mistral', 'minimax']);

/** Rank used for an entry the ranking snapshot did not cover. */
const UNRANKED = Number.MAX_SAFE_INTEGER;

/** Compare two entries by rank, then title, then key (stable, locale-free). */
function compareEntries(a: GroupedLogoEntry, b: GroupedLogoEntry): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const byTitle = a.title.localeCompare(b.title);
  return byTitle !== 0 ? byTitle : a.key.localeCompare(b.key);
}

/**
 * Group and sort every brand mark.
 * @param logos - merged artwork set.
 * @param ranks - generated `LOGO_RANKS` map (`key → 1-based rank`).
 */
export function groupLogoEntries(logos: LogoSet, ranks: Readonly<Record<string, number>>): LogoGroups {
  const vendor: GroupedLogoEntry[] = [];
  const model: GroupedLogoEntry[] = [];
  for (const key of Object.keys(logos)) {
    const entry = logos[key];
    if (entry === undefined) continue;
    const rawRank = ranks[key];
    const rank = typeof rawRank === 'number' && Number.isFinite(rawRank) ? rawRank : UNRANKED;
    const grouped: GroupedLogoEntry = {
      key: key,
      title: entry.title,
      svg: entry.svg,
      group: entry.group,
      rank: rank,
    };
    if (entry.group === 'vendor') vendor.push(grouped);
    else if (entry.group === 'model') model.push(grouped);
  }
  vendor.sort(compareEntries);
  model.sort(compareEntries);
  return { vendor: vendor, model: model };
}

/**
 * Extra searchable text for one picker entry.
 *
 * The caller supplies localized brand names here so the picker can be searched
 * in either language without teaching this pure module about i18n state.
 */
export type LogoSearchAliases = (entry: GroupedLogoEntry) => readonly string[];

/**
 * Filter both groups by the picker query (key, title or an extra alias,
 * case-insensitive).
 * @param groups - already grouped and sorted sections.
 * @param query - raw search input.
 * @param aliases - optional extra text per entry (localized brand names).
 */
export function filterLogoGroups(groups: LogoGroups, query: unknown, aliases?: LogoSearchAliases): LogoGroups {
  const normalized = String(query ?? '')
    .trim()
    .toLowerCase();
  if (normalized === '') return groups;
  const matches = (entry: GroupedLogoEntry): boolean => {
    if (entry.key.toLowerCase().includes(normalized) || entry.title.toLowerCase().includes(normalized)) return true;
    if (aliases === undefined) return false;
    for (const alias of aliases(entry)) {
      if (alias.toLowerCase().includes(normalized)) return true;
    }
    return false;
  };
  return {
    vendor: groups.vendor.filter(matches),
    model: groups.model.filter(matches),
  };
}

/** Total number of entries across both groups. */
export function countLogoEntries(groups: LogoGroups): number {
  return groups.vendor.length + groups.model.length;
}
