import PostalMime from "postal-mime";

interface Env {
  CAPTURE_API_URL: string;
  CAPTURE_API_KEY: string;
  ALLOWED_SENDERS: string;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const allowed = env.ALLOWED_SENDERS.split(",").map((s) =>
      s.trim().toLowerCase()
    );
    if (!allowed.includes(message.from.toLowerCase())) {
      console.log(`Rejected email from ${message.from}`);
      message.setReject("Sender not allowed");
      return;
    }

    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(rawEmail);

    const subject = parsed.subject || "";
    const body = parsed.text || "";
    const text = subject ? `${subject}\n\n${body}` : body;

    if (!text.trim()) {
      console.log("Empty email, skipping");
      return;
    }

    const response = await fetch(`${env.CAPTURE_API_URL}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CAPTURE_API_KEY}`,
      },
      body: JSON.stringify({
        text: text.trim(),
        channel: "email",
        channel_message_id:
          message.headers.get("message-id") || crypto.randomUUID(),
        user_id: message.from,
      }),
    });

    if (!response.ok) {
      console.error(`Capture API responded ${response.status}`);
      message.setReject("Processing failed");
    }
  },
};
