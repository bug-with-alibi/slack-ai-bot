import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post("/slack/events", async (req, res) => {
  // ✅ Slack verification
  if (req.body.type === "url_verification") {
    return res.status(200).json({
      challenge: req.body.challenge
    });
  }

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