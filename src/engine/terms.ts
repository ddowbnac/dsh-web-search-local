
const TOKEN = /[A-Za-z0-9À-ɏĀ-ɟḀ-ỿЀ-ӿЀ-ӿ\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]+/g;

export function extractTerms(query: string, cap = 24): string[] {
  const tokens = query.match(TOKEN) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (k.length === 0 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}
