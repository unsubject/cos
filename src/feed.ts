interface ReviewItem {
  id: string;
  review_date: string;
  content_html: string;
  entry_count: number;
  created_at: Date;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateRssFeed(
  reviews: ReviewItem[],
  baseUrl: string
): string {
  const items = reviews
    .map(
      (r) => `    <item>
      <title>${escapeXml(`Morning Review — ${r.review_date}`)}</title>
      <description><![CDATA[${r.content_html}]]></description>
      <pubDate>${new Date(r.created_at).toUTCString()}</pubDate>
      <guid isPermaLink="false">${r.id}</guid>
    </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Journal Morning Review</title>
    <description>Daily morning review from your second brain</description>
    <link>${escapeXml(baseUrl)}/feed</link>
    <atom:link href="${escapeXml(baseUrl)}/feed" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}
