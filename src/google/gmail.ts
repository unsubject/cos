import { google } from "googleapis";
import { getAuthenticatedClient } from "./auth";
import { pool } from "../db/client";

const FAMILY_EMAIL = "yinfun.li@gmail.com";
const FAMILY_DOMAIN_SUFFIX = "@leesim.one";
const FAMILY_LABEL = "DSJ";

const FAMILY_QUERY =
  "(to:*@leesim.one OR from:*@leesim.one OR to:yinfun.li@gmail.com OR from:yinfun.li@gmail.com OR label:DSJ) newer_than:30d";

function extractAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function addressIsFamily(raw: string): boolean {
  const addr = extractAddress(raw);
  return addr === FAMILY_EMAIL || addr.endsWith(FAMILY_DOMAIN_SUFFIX);
}

function computeScope(
  from: string,
  to: string[],
  cc: string[],
  labelNames: string[]
): "personal" | "family" {
  if (labelNames.includes(FAMILY_LABEL)) return "family";
  if (from && addressIsFamily(from)) return "family";
  if (to.some(addressIsFamily)) return "family";
  if (cc.some(addressIsFamily)) return "family";
  return "personal";
}

type GmailService = ReturnType<typeof google.gmail>;

async function fetchLabelNameMap(
  service: GmailService
): Promise<Record<string, string>> {
  const { data } = await service.users.labels.list({ userId: "me" });
  const map: Record<string, string> = {};
  for (const label of data.labels || []) {
    if (label.id && label.name) map[label.id] = label.name;
  }
  return map;
}

// One-time: populate label_names on rows ingested before this column existed.
// Also reclassifies scope → 'family' for pre-existing DSJ-labeled rows.
async function backfillLabelNamesAndScope(
  labelNameMap: Record<string, string>
): Promise<void> {
  const { rows } = await pool.query<{ id: string; label_ids: string[] }>(
    `SELECT id, label_ids FROM email_ref
     WHERE label_ids IS NOT NULL AND label_names IS NULL`
  );
  for (const row of rows) {
    const names = (row.label_ids || [])
      .map((id) => labelNameMap[id])
      .filter((n): n is string => Boolean(n));
    await pool.query(
      `UPDATE email_ref SET label_names = $1 WHERE id = $2`,
      [names, row.id]
    );
  }
  await pool.query(
    `UPDATE email_ref SET scope = 'family'
     WHERE scope = 'personal' AND 'DSJ' = ANY(label_names)`
  );
}

async function fetchMessages(
  query: string,
  service: GmailService,
  labelNameMap: Record<string, string>
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const { data } = await service.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
      pageToken,
    });

    for (const msg of data.messages || []) {
      if (!msg.id) continue;

      // Skip if already stored. Existing rows have been reclassified by
      // backfillLabelNamesAndScope at the start of this sync; nothing more to do.
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM email_ref WHERE external_system = 'gmail' AND external_message_id = $1`,
        [msg.id]
      );
      if (existing.length > 0) continue;

      const { data: full } = await service.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const headers = full.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
          ?.value || "";

      const subject = getHeader("subject") || null;
      const from = getHeader("from");
      const to = getHeader("to");
      const cc = getHeader("cc");
      const date = getHeader("date");

      const toAddresses = to
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const ccAddresses = cc
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const labelIds = full.labelIds || [];
      const labelNames = labelIds
        .map((id) => labelNameMap[id])
        .filter((n): n is string => Boolean(n));

      const isSent = labelIds.includes("SENT");
      const isStarred = labelIds.includes("STARRED");
      const scope = computeScope(from, toAddresses, ccAddresses, labelNames);

      const bodyText = extractTextBody(full.payload) || "";

      await pool.query(
        `INSERT INTO email_ref
           (user_id, external_system, external_message_id, thread_id,
            subject, from_address, to_addresses, snippet, body_text,
            label_ids, label_names, is_starred, is_sent, scope, sent_at, updated_at)
         VALUES ('default', 'gmail', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         ON CONFLICT (external_system, external_message_id) DO UPDATE
           SET is_starred = EXCLUDED.is_starred,
               is_sent = EXCLUDED.is_sent,
               label_ids = EXCLUDED.label_ids,
               label_names = EXCLUDED.label_names,
               scope = EXCLUDED.scope,
               updated_at = now()`,
        [
          msg.id,
          full.threadId || null,
          subject,
          from || null,
          toAddresses,
          full.snippet || null,
          bodyText.slice(0, 10000),
          labelIds,
          labelNames,
          isStarred,
          isSent,
          scope,
          date ? new Date(date) : null,
        ]
      );
    }

    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextBody(payload: any): string | null {
  if (!payload) return null;

  const mimeType = payload.mimeType as string | undefined;
  const body = payload.body as { data?: string } | undefined;
  const parts = payload.parts as any[] | undefined;

  if (mimeType === "text/plain" && body?.data) {
    return Buffer.from(body.data, "base64url").toString("utf-8");
  }

  if (parts) {
    for (const part of parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }

  return null;
}

export async function syncGmail(): Promise<void> {
  const auth = await getAuthenticatedClient();
  const service = google.gmail({ version: "v1", auth });

  console.log("Loading Gmail label map...");
  const labelNameMap = await fetchLabelNameMap(service);

  console.log("Backfilling label_names on pre-existing rows...");
  await backfillLabelNamesAndScope(labelNameMap);

  console.log("Syncing sent mail...");
  await fetchMessages("in:sent newer_than:30d", service, labelNameMap);

  console.log("Syncing starred mail...");
  await fetchMessages("is:starred", service, labelNameMap);

  console.log("Syncing family mail...");
  await fetchMessages(FAMILY_QUERY, service, labelNameMap);
}
