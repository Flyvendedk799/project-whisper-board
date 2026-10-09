/**
 * Turns a catalog entry into what the MCP SDK wants: a description and a zod
 * input shape. Kept apart from the catalog so the page does not need zod.
 */
import { z } from "zod";
import { toolByName, type ToolParam } from "./tool-catalog";

function paramSchema(param: ToolParam): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (param.type === "string[]") schema = z.array(z.string());
  else if (param.type === "(string | object)[]") {
    schema = z.array(z.union([z.string(), z.record(z.string(), z.unknown())]));
  } else if (param.type === "integer") schema = z.number().int();
  else if (param.type === "boolean") schema = z.boolean();
  else if (param.enum && param.enum.length > 0) {
    schema = z.enum(param.enum as [string, ...string[]]);
  } else schema = z.string();
  schema = schema.describe(param.description);
  return param.required ? schema : schema.optional();
}

export function toolDescription(name: string): string {
  const tool = toolByName(name);
  return tool.description ?? tool.summary;
}

export function toolShape(name: string): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(
    toolByName(name).params.map((param) => [param.name, paramSchema(param)]),
  );
}
