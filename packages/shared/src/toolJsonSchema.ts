import { z } from "zod";

/** Preserve the pre-Zod-4 tool contracts, including JSON key order, for Ask, KB and MCP. */
// Unhandled Zod 4 divergences: loose/passthrough/catchall objects, nullable, literal,
// primitive unions, string formats, coerce, date/transform pipes, lazy recursion,
// and explicit safe-integer bounds. A new tool using any of these needs a byte test.
export function toolJsonSchema(schema: z.ZodObject) {
  const json = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    reused: "inline",
    override: ({ zodSchema, jsonSchema }) => {
      // Native input schemas omit strip-mode additionalProperties and add safe-integer
      // bounds. The previous converter emitted false and only explicitly set bounds.
      if (jsonSchema.type === "object") jsonSchema.additionalProperties ??= false;
      if (jsonSchema.type === "integer") {
        if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) delete jsonSchema.minimum;
        if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) delete jsonSchema.maximum;
      }
      const { description, default: fallback, ...body } = jsonSchema;
      for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
      Object.assign(jsonSchema, body);
      const def = zodSchema._zod.def;
      // A description applied after default() followed the default in Zod 3.
      let inner = def.type === "default" ? def.innerType : undefined;
      while (inner instanceof z.ZodOptional) inner = inner.unwrap();
      const describeAfterDefault = inner !== undefined && !z.globalRegistry.get(inner)?.description;
      if (description !== undefined && !describeAfterDefault) jsonSchema.description = description;
      if (fallback !== undefined) jsonSchema.default = fallback;
      if (description !== undefined && describeAfterDefault) jsonSchema.description = description;
    },
  });
  const { $schema, ...body } = json;
  return { ...body, $schema };
}
