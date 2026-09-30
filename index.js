require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const { google } = require("googleapis");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (dashboard.html)
app.use(express.static(__dirname));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const TOKEN_PATH = path.join(__dirname, "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");

// Helper function to resolve OAuth credentials (from file or Vercel env)
function getOAuthClient() {
  let credentials;
  if (process.env.CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.CREDENTIALS_JSON);
  } else if (fs.existsSync(CREDENTIALS_PATH)) {
    credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  } else {
    throw new Error("Missing Google OAuth credentials. Check environment variables or credentials.json.");
  }

  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris ? redirect_uris[0] : "http://localhost"
  );

  let token;
  if (process.env.TOKEN_JSON) {
    token = JSON.parse(process.env.TOKEN_JSON);
  } else if (fs.existsSync(TOKEN_PATH)) {
    token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  } else {
    throw new Error("Missing OAuth token. Run authentication locally to generate token.json or set TOKEN_JSON.");
  }

  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

// API Endpoint to fetch and summarize unread emails
app.get("/api/emails", async (req, res) => {
  try {
    const auth = getOAuthClient();
    const gmail = google.gmail({ version: "v1", auth });

    const response = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
      maxResults: 3,
    });

    const messages = response.data.messages || [];
    if (messages.length === 0) {
      return res.json({ emails: [] });
    }

    const emailSummaries = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: messages[i].id,
      });

      const snippet = msg.data.snippet;
      const headers = msg.data.payload.headers;
      const subjectHeader = headers.find((h) => h.name === "Subject");
      const fromHeader = headers.find((h) => h.name === "From");
      const dateHeader = headers.find((h) => h.name === "Date");

      const subject = subjectHeader ? subjectHeader.value : "No Subject";
      const sender = fromHeader ? fromHeader.value : "Unknown Sender";
      const date = dateHeader ? dateHeader.value : "";

      // Generate concise summary using Gemini API
      const aiResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: `Summarize this email snippet concisely in 2 bullet points:\nSubject: ${subject}\nSnippet: ${snippet}`,
      });

      emailSummaries.push({
        id: messages[i].id,
        subject,
        sender,
        date,
        snippet,
        summary: aiResponse.text.trim(),
      });
    }

    res.json({ emails: emailSummaries });
  } catch (error) {
    console.error("Error fetching emails:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Serve dashboard.html on the root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Start server locally if not on Vercel
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`🤖 AI Gmail Summarizer Web Server`);
    console.log(`=================================`);
    console.log(`🚀 Dashboard running at: http://localhost:${PORT}`);
  });
}

// Export for Vercel Serverless Function deployment
module.exports = app;