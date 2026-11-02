import { LINK_KINDS } from "../../../memory/links/link-store.mjs";
const LINK_GENERATOR_RESPONSE_FORMAT = {
  name: "link_generator_v1",
  description: "Emit zero or more directed memory-link triples between candidate ids. Use the `none` discriminator with an empty `links` array when no genuine relation exists.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["none", "links"] },
      links: {
        type: "array",
        // The runtime caps further at parse time via `maxLinks`. The
        // schema cap is a hard ceiling so a runaway model cannot
        // hand the provider a megabyte of triples.
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            from_id: { type: "integer", minimum: 1 },
            to_id: { type: "integer", minimum: 1 },
            link_kind: {
              type: "string",
              enum: [...LINK_KINDS]
            }
          },
          required: ["from_id", "to_id", "link_kind"]
        }
      }
    },
    required: ["kind", "links"]
  }
};
export {
  LINK_GENERATOR_RESPONSE_FORMAT
};
