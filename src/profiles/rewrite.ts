import { z } from "zod";
import type { MetaClient } from "../gateway/meta-client.ts";
import { DEFAULT_MODEL } from "../gateway/models.ts";
import type { FieldError, PromptVersion, Rewrite } from "./loop.ts";

const Notes = z.strictObject({ notes: z.array(z.string()) });

const INSTRUCTIONS = `You maintain the reading notes for one sender's freight documents. A reader model reads each page with these notes.
You get the current notes and the fields the reader got wrong on an approved document: the value it returned and the value a person confirmed.
Return the full revised notes (at most 8): short rules about how this sender prints its values and which column or cell holds each field, so the reader gets them right next time.
Never put values of one document (a particular quantity, PO number or date) in a note. Keep notes that still hold; drop ones the errors contradict.`;

/** Step 8 with Spark. Effort is a parameter: low or medium is measured, not assumed. */
export function sparkRewrite(client: MetaClient, effort: "low" | "medium" = "low"): Rewrite {
  return async (current: PromptVersion, errors: FieldError[]) => {
    const r = await client({
      model: DEFAULT_MODEL, reasoning_effort: effort, max_tokens: 4000,
      response_format: { type: "json_schema", json_schema: { name: "notes", strict: true, schema: z.toJSONSchema(Notes, { target: "draft-7" }) } },
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: JSON.stringify({ columns: current.columns, notes: current.notes, errors: errors.slice(0, 40) }) },
      ],
    });
    return Notes.parse(JSON.parse(r.content)).notes.slice(0, 8);
  };
}
