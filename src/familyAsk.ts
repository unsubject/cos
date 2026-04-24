import OpenAI from "openai";
import { generateEmbedding } from "./embeddings";
import * as fq from "./db/familyQueries";

const openai = new OpenAI();

const SYSTEM_PROMPT = `You answer questions using the user's private family archive.

You receive a question and retrieved excerpts from four sources: journal entries, emails, calendar events, and tasks. Each excerpt is numbered.

Rules:
- Ground your answer ONLY in the retrieved excerpts.
- If the answer isn't in the excerpts, say "I couldn't find that in the archive."
- Cite sources inline with [1], [2], etc.
- At the bottom, list cited sources:
  Sources:
  [1] <one-line label>
  [2] ...
- Reply in the language the question was asked in.
- Plain text, suitable for Telegram. Keep total response under 3500 chars.`;

export type AskScope = "personal" | "family";

export async function askFamilyArchive(
  question: string,
  scopes: AskScope[]
): Promise<string> {
  const embedding = await generateEmbedding(question);

  const [journal, emails, calendar, tasks] = await Promise.all([
    fq.searchJournalForAsk(embedding, scopes, 5),
    fq.searchEmailsForAsk(embedding, scopes, 5),
    fq.searchCalendarForAsk(question, scopes, 5),
    fq.searchTasksForAsk(question, scopes, 5),
  ]);

  const blocks: string[] = [];
  let idx = 1;

  for (const e of journal) {
    const date = e.created_at.toISOString().slice(0, 10);
    const text = e.summary || e.full_text.slice(0, 500);
    blocks.push(`[${idx}] Journal (${e.scope}, ${date}): ${text}`);
    idx++;
  }

  for (const e of emails) {
    const date = e.sent_at ? e.sent_at.toISOString().slice(0, 10) : "?";
    const snippet = (e.snippet || e.body_text || "").slice(0, 500);
    const subject = e.subject || "(no subject)";
    blocks.push(
      `[${idx}] Email (${e.scope}, ${date}) from ${e.from_address}, subject "${subject}": ${snippet}`
    );
    idx++;
  }

  for (const c of calendar) {
    const date = c.start_at.toISOString().slice(0, 10);
    const where = c.location ? ` @ ${c.location}` : "";
    const desc = c.description ? `: ${c.description.slice(0, 300)}` : "";
    blocks.push(
      `[${idx}] Calendar event (${c.scope}, ${date}) — ${c.title}${where}${desc}`
    );
    idx++;
  }

  for (const t of tasks) {
    const due = t.due_at ? t.due_at.toISOString().slice(0, 10) : "no due date";
    const list = t.list_name ? `list "${t.list_name}"` : "unfiled";
    const notes = t.notes ? `: ${t.notes.slice(0, 200)}` : "";
    blocks.push(
      `[${idx}] Task (${t.scope}, ${list}, ${due}) — ${t.title}${notes}`
    );
    idx++;
  }

  if (blocks.length === 0) {
    return "I couldn't find that in the archive.";
  }

  const userMessage = `Question: ${question}

Retrieved excerpts:
${blocks.join("\n\n")}

Answer the question, citing the excerpts.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4-nano",
    max_completion_tokens: 1500,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  return (
    response.choices[0]?.message?.content ||
    "Sorry, couldn't synthesize an answer."
  );
}
