import { defaultFilter } from "cmdk";

const MIN_TOKEN_SCORE = 0.05;

/**
 * cmdk filter that ignores the item `value` (we use ids there) and fuzzy-matches
 * only the item's `keywords`. Multi-word queries are AND-ed: every whitespace
 * separated token must match ("web 10.0" matches hostname web-1 with IP 10.0.0.4).
 */
export function fuzzyFilter(value: string, search: string, keywords?: string[]): number {
  const haystack = (keywords && keywords.length ? keywords.join(" ") : value).toLowerCase();
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  let score = 1;
  for (const t of tokens) {
    // exact substring wins strongly
    const s = haystack.includes(t) ? 1 : defaultFilter(haystack, t);
    // drop letters-scattered-across-everything matches ("ban" ≈ "jobs … agent … history")
    if (s < MIN_TOKEN_SCORE) return 0;
    score *= s;
  }
  return score;
}

/** Normalise a list of optional strings into cmdk keywords. */
export function toKeywords(...parts: Array<string | number | null | undefined | false | Array<string | null | undefined>>): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p === null || p === undefined || p === false) continue;
    if (Array.isArray(p)) {
      for (const x of p) if (x) out.push(String(x));
    } else {
      out.push(String(p));
    }
  }
  return out;
}
