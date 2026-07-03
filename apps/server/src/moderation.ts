import { config } from "./config.js";

/**
 * Moderación mínima de prompts para una galería pública: bloquea términos
 * sexuales/gore evidentes (EN/ES) antes de gastar créditos. Ampliable por env
 * con BLOCKED_TERMS="palabra1,palabra2".
 */
const BASE_BLOCKLIST = [
  // sexual
  "nsfw", "nude", "naked", "porn", "hentai", "erotic", "sex", "genitals",
  "desnud", "porno", "erotic", "sexual",
  // gore / violencia gráfica
  "gore", "dismember", "decapitat", "mutilat", "beheaded",
  "descuartiz", "decapitad", "mutilad",
  // menores + sexual (cualquier combinación cae por los términos de arriba,
  // esto refuerza)
  "loli", "shota",
];

export function findBlockedTerm(prompt: string): string | null {
  const p = ` ${prompt.toLowerCase()} `;
  for (const term of [...BASE_BLOCKLIST, ...config.blockedTerms]) {
    if (term && p.includes(term)) return term;
  }
  return null;
}
