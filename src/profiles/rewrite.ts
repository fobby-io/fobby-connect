import { z } from "zod";
import type { MetaClient } from "../gateway/meta-client.ts";
import type { ModelId } from "../gateway/models.ts";
import type { FieldError, PromptVersion, Rewrite } from "./loop.ts";

const Notes = z.strictObject({ notes: z.array(z.string()) });

const INSTRUCTIONS = `You maintain the reading notes for one sender's freight documents. A reader model reads each page with these notes.
You get the current notes, the fields the reader got wrong on an approved document (the value it returned and the value a person confirmed), and the printed text of that document's first page, each word with its x position.
Compare each wrong value with the printed text: find where the confirmed value is printed and why the reader took the wrong one (a neighbouring column, a swapped label, a wrapped line, a unit).
Return the full revised notes (at most 8): short rules about how this sender prints its values and which column label or position holds each field, so the reader gets them right next time.
Never put values of one document (a particular quantity, PO number or date) in a note. Keep notes that still hold; drop ones the errors contradict.`;

// The first page's text is enough to see the layout; a long scan-free page is about 20k characters.
const PAGE_CHARS = 30_000;

/** Step 8 with Muse Wonder, Meta's coding model: it compares the corrections with the printed page and rewrites the notes. */
export function museRewrite(client: MetaClient, model: ModelId = "muse-wonder-1.0", effort: "low" | "medium" = "low"): Rewrite {
  return async (current: PromptVersion, errors: FieldError[], doc) => {
    const parts = (doc.pages[0] ?? []) as { type: string; text?: string }[];
    const page = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n").slice(0, PAGE_CHARS);
    const r = await client({
      model, reasoning_effort: effort, max_tokens: 6000,
      response_format: { type: "json_schema", json_schema: { name: "notes", strict: true, schema: z.toJSONSchema(Notes, { target: "draft-7" }) } },
      messages: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: JSON.stringify({ columns: current.columns, notes: current.notes, errors: errors.slice(0, 40), page: page || "(scanned page: no text layer)" }) },
      ],
    });
    return Notes.parse(JSON.parse(r.content)).notes.slice(0, 8);
  };
}
