import {
  LESSON_ACTIVATION_MAX_LENGTH,
  LESSON_MAX_TAGS,
  LESSON_PRINCIPLE_MAX_LENGTH,
  LESSON_TAG_MAX_LENGTH
} from "../lessons/lesson-store.mjs";
import {
  PROCEDURE_ACTIVATION_MAX_LENGTH,
  PROCEDURE_DESCRIPTION_MAX_LENGTH,
  PROCEDURE_MAX_STEPS,
  PROCEDURE_MAX_TAGS,
  PROCEDURE_MIN_STEPS,
  PROCEDURE_TOOL_HINT_MAX_LENGTH
} from "../procedures/procedure-store.mjs";
const DISTILL_RESPONSE_FORMAT = {
  name: "distill_lesson_v1",
  description: "Distill a memory cluster into one lesson. Use the `none` discriminator when no durable advice can be extracted.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["none", "lesson"] },
      activation: { type: "string", maxLength: LESSON_ACTIVATION_MAX_LENGTH },
      principle: { type: "string", maxLength: LESSON_PRINCIPLE_MAX_LENGTH },
      tags: {
        type: "array",
        maxItems: LESSON_MAX_TAGS,
        items: { type: "string", maxLength: LESSON_TAG_MAX_LENGTH }
      }
    },
    required: ["kind", "activation", "principle", "tags"]
  }
};
const DISTILL_WITH_PROCEDURE_RESPONSE_FORMAT = {
  name: "distill_lesson_and_procedure_v1",
  description: "Distill a memory cluster into one lesson plus an optional procedure. Use `kind=none` when nothing durable can be extracted; use `procedure=null` when only a lesson applies.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["none", "lesson"] },
      activation: { type: "string", maxLength: LESSON_ACTIVATION_MAX_LENGTH },
      principle: { type: "string", maxLength: LESSON_PRINCIPLE_MAX_LENGTH },
      tags: {
        type: "array",
        maxItems: LESSON_MAX_TAGS,
        items: { type: "string", maxLength: LESSON_TAG_MAX_LENGTH }
      },
      procedure: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              activation: {
                type: "string",
                maxLength: PROCEDURE_ACTIVATION_MAX_LENGTH
              },
              steps: {
                type: "array",
                minItems: PROCEDURE_MIN_STEPS,
                maxItems: PROCEDURE_MAX_STEPS,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    description: {
                      type: "string",
                      maxLength: PROCEDURE_DESCRIPTION_MAX_LENGTH
                    },
                    tool_hint: {
                      anyOf: [
                        { type: "null" },
                        {
                          type: "string",
                          maxLength: PROCEDURE_TOOL_HINT_MAX_LENGTH
                        }
                      ]
                    }
                  },
                  required: ["description", "tool_hint"]
                }
              },
              tags: {
                type: "array",
                maxItems: PROCEDURE_MAX_TAGS,
                items: { type: "string", maxLength: LESSON_TAG_MAX_LENGTH }
              }
            },
            required: ["activation", "steps", "tags"]
          }
        ]
      }
    },
    required: ["kind", "activation", "principle", "tags", "procedure"]
  }
};
export {
  DISTILL_RESPONSE_FORMAT,
  DISTILL_WITH_PROCEDURE_RESPONSE_FORMAT
};
