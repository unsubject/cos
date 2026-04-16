import { generateMorningReview } from "./review";

export function startScheduler(): void {
  const reviewTime = process.env.MORNING_REVIEW_TIME || "06:00";
  const timezone = process.env.TIMEZONE || "UTC";

  const [targetHour, targetMinute] = reviewTime.split(":").map(Number);
  let lastRunDate = "";

  setInterval(() => {
    const now = new Date();
    const localParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const currentHour = parseInt(
      localParts.find((p) => p.type === "hour")!.value,
      10
    );
    const currentMinute = parseInt(
      localParts.find((p) => p.type === "minute")!.value,
      10
    );
    const today = now.toLocaleDateString("en-CA", { timeZone: timezone });

    if (
      currentHour === targetHour &&
      currentMinute === targetMinute &&
      lastRunDate !== today
    ) {
      lastRunDate = today;
      console.log("Generating morning review...");
      generateMorningReview().catch((err) =>
        console.error("Error generating morning review:", err)
      );
    }
  }, 60_000);

  console.log(
    `Morning review scheduled at ${reviewTime} (${timezone})`
  );
}
