import cron from "node-cron";
import { generateMorningReview } from "./review";

export function startScheduler(): void {
  const cronExpr = process.env.MORNING_REVIEW_CRON || "0 6 * * *";
  const timezone = process.env.TIMEZONE || "UTC";

  cron.schedule(
    cronExpr,
    async () => {
      console.log("Generating morning review...");
      try {
        await generateMorningReview();
      } catch (err) {
        console.error("Error generating morning review:", err);
      }
    },
    { timezone }
  );

  console.log(`Morning review scheduled: ${cronExpr} (${timezone})`);
}
