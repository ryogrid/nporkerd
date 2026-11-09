// Hourly maintenance cron (design 08 §7, 05 §8, 03 §5).
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup",
  { hours: 1 }, // 08 §7: every hour
  internal.game.cleanupExpired,
);

export default crons;
