# Profile search terms and explicit fact links

Profile search previously matched the entire query as one contiguous substring.
It now splits on whitespace and requires every case-insensitive term to occur
in at least one active fact field (key, value, or keyword). Terms may match
inside words and in any order; punctuation remains literal. Results stay capped
at 50. Historical facts remain excluded.

Knowledge links default to the existing note namespace for compatibility.
Callers must explicitly select `entityType: profile` for profile fact IDs.
Fact edges live in `atomic_profile_links`, with foreign keys and cascade deletion;
existing note edges and facts are not rewritten or merged. Both endpoint IDs
are validated before mutation, producing actionable errors instead of raw SQL
foreign-key errors. Profile get expands two hops, capped at 50 related IDs.

Synthetic regression tests cover Korean and English terms, cross-field matches,
ID namespace isolation, invalid IDs, idempotence, restart persistence, explicit
edge removal and cascade deletion. No production records are modified by tests.
