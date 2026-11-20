import { z } from "zod";
import { defineTool } from "./defineTool";
import { escapeLike, Query } from "./sql";
import { resolveSupplierMatch, type SupplierCandidate } from "./supplierMatch";

export const searchSuppliers = defineTool({
  name: "search_suppliers",
  description:
    "Find a supplier by (partial or misspelled) name and get its supplier_id. " +
    "ALWAYS call this first whenever the user mentions a supplier by name, because every other tool takes supplier_id, not a name. " +
    "If the result has ambiguous: true, do NOT pick one: call ask_clarification with the candidate names. " +
    "If resolved is null and there are no candidates, tell the user no supplier matched. " +
    "Do not use this to list all suppliers or to look up orders.",
  input: z.object({
    query: z.string().trim().min(2).max(100).describe("Supplier name or part of it, as the user wrote it."),
  }),
  async run({ query }, ctx) {
    const q = new Query();
    const text = q.param(query);
    const like = q.param(`%${escapeLike(query)}%`);
    // Score = best of whole-string trigram similarity and word similarity, so
    // both "Shree Ganesh Stel" (typo) and "Ganesh" (one word) score well.
    const { rows } = await ctx.db.query<SupplierCandidate>(
      `SELECT id, name, city,
              round(GREATEST(similarity(name, ${text}), word_similarity(${text}, name))::numeric, 2)::float8 AS score,
              lower(name) = lower(${text}) AS exact
         FROM suppliers
        WHERE name ILIKE ${like}
           OR similarity(name, ${text}) >= 0.2
           OR word_similarity(${text}, name) >= 0.3
        ORDER BY exact DESC, score DESC, name
        LIMIT 5`,
      q.params,
    );

    const match = resolveSupplierMatch(rows);
    const candidates = match.candidates.map(({ id, name, city, score }) => ({ id, name, city, score }));
    if (match.status === "resolved") {
      const { id, name, city } = match.supplier;
      return { ambiguous: false, resolved: { supplier_id: id, name, city }, candidates };
    }
    if (match.status === "ambiguous") {
      return {
        ambiguous: true,
        resolved: null,
        candidates,
        instruction: "Several suppliers match. Ask the user which one they mean. Do not guess.",
      };
    }
    return { ambiguous: false, resolved: null, candidates: [], message: `No supplier matches "${query}".` };
  },
});
