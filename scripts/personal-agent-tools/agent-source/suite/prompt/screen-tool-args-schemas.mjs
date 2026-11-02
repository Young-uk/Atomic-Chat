const numberSchema = { type: "number" };
function obj(properties, required = []) {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false
  };
}
const SCREEN_TOOL_ARGS_SCHEMAS = [
  [
    "os.screen.capture",
    // The region is flat (all four or none): no strict-converted schema
    // nests an object (openai-tool-call-adapter.test.ts pins it).
    obj({ x: numberSchema, y: numberSchema, width: numberSchema, height: numberSchema })
  ],
  [
    "os.screen.click",
    obj(
      {
        x: numberSchema,
        y: numberSchema,
        button: { type: "string", enum: ["left", "right"] },
        double: { type: "boolean" },
        scale: numberSchema
      },
      ["x", "y"]
    )
  ],
  [
    "os.screen.type",
    obj({ text: { type: "string" }, via: { type: "string", enum: ["keys", "paste"] } }, ["text"])
  ],
  ["os.screen.key", obj({ keys: { type: "string" } }, ["keys"])]
];
export {
  SCREEN_TOOL_ARGS_SCHEMAS
};
