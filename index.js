import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const processedEvents = new Set();

app.use(express.json());

app.post("/slack/events", async (req, res) => {
  // Log event
  console.log("Event ID:", req.body.event_id);

  // ✅ Slack verification
  if (req.body.type === "url_verification") {
    return res.status(200).json({
      challenge: req.body.challenge
    });
  }

  // Temporary way to avoid duplicate events
  const eventId = req.body.event_id;

  // 🚨 DEDUP CHECK
  if (processedEvents.has(eventId)) {
    console.log("Duplicate event ignored:", eventId);
    return res.sendStatus(200);
  }

  processedEvents.add(eventId);

  // Prevent memory leak
  setTimeout(() => processedEvents.delete(eventId), 5 * 60 * 1000);

  const event = req.body.event;

  res.sendStatus(200);

  // ✅ When someone mentions your bot
  if (event && event.type === "app_mention") {
    console.log("Mention received:", event.text);

    // 👉 SEND REPLY
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: event.channel,
        text: "Hey 👋 I'm alive! (fixed reply for now)"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  }
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));