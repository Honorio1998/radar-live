import express from "express";

const app = express();

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.SPORTRADAR_API_KEY;
const ACCESS_LEVEL = process.env.ACCESS_LEVEL || "trial";
const LANGUAGE_CODE = process.env.LANGUAGE_CODE || "pt";
const POLL_MS = Number(process.env.POLL_MS || 1000);

const appData = {
  events: [],
  seen: new Set(),
  lastPoll: null,
  lastStatus: "iniciando",
  lastError: null
};

app.use(express.static("public"));

function timelineUrl() {
  return `https://api.sportradar.com/soccer/${ACCESS_LEVEL}/v4/${LANGUAGE_CODE}/schedules/live/timelines.json`;
}

function findTimelines(obj, result = []) {
  if (!obj || typeof obj !== "object") return result;

  if (obj.sport_event && obj.timeline) {
    result.push(obj);
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findTimelines(item, result);
    }
  } else {
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        findTimelines(value, result);
      }
    }
  }

  return result;
}

function processData(data) {
  const matches = findTimelines(data);

  for (const match of matches) {
    const sportEvent = match.sport_event;
    const timeline = match.timeline || [];

    const matchId = sportEvent.id;

    const home =
      sportEvent.competitors?.find(c => c.qualifier === "home")?.name || "Casa";

    const away =
      sportEvent.competitors?.find(c => c.qualifier === "away")?.name || "Fora";

    for (const event of timeline) {
      const description = String(event.description || "").toLowerCase();

      let eventType = null;

      if (description === "goal") {
        eventType = "GOAL";
      }

      if (description === "corner") {
        eventType = "CORNER";
      }

      if (!eventType) continue;

      const eventId =
        event.id ||
        `${matchId}-${eventType}-${event.time}-${event.match_time}`;

      if (appData.seen.has(eventId)) continue;

      appData.seen.add(eventId);

      const sourceTime = event.time || null;
      const receivedAt = new Date().toISOString();

      let feedLagMs = null;

      if (sourceTime) {
        const sourceMs = Date.parse(sourceTime);

        if (!Number.isNaN(sourceMs)) {
          feedLagMs = Date.now() - sourceMs;
        }
      }

      const item = {
        source: "Sportradar",
        matchId,
        eventId,
        eventType,
        home,
        away,
        matchClock: event.match_time || event.match_clock || null,
        sourceTime,
        receivedAt,
        feedLagMs,
        homeScore: sportEvent.status?.home_score ?? null,
        awayScore: sportEvent.status?.away_score ?? null
      };

      appData.events.unshift(item);

      if (appData.events.length > 100) {
        appData.events.pop();
      }

      console.log(
        `[RADAR] ${eventType} | ${home} x ${away} | lag=${feedLagMs}ms`
      );
    }
  }
}

async function pollSportradar() {
  try {
    if (!API_KEY) {
      throw new Error("SPORTRADAR_API_KEY não configurada");
    }

    const response = await fetch(timelineUrl(), {
      headers: {
        "x-api-key": API_KEY
      }
    });

    appData.lastPoll = new Date().toISOString();

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Sportradar HTTP ${response.status}: ${text.slice(0, 300)}`
      );
    }

    const data = await response.json();

    processData(data);

    appData.lastStatus = "OK";
    appData.lastError = null;

    console.log(
      `[Sportradar] HTTP ${response.status} | ${new Date().toLocaleTimeString()}`
    );
  } catch (error) {
    appData.lastStatus = "ERRO";
    appData.lastError = error.message;

    console.error("[Sportradar]", error.message);
  }
}

app.get("/api/status", (_req, res) => {
  res.json({
    radar: "online",
    status: appData.lastStatus,
    lastPoll: appData.lastPoll,
    lastError: appData.lastError,
    eventsStored: appData.events.length,
    pollMs: POLL_MS
  });
});

app.get("/api/events", (_req, res) => {
  res.json(appData.events);
});

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = () => {
    res.write(
      `data: ${JSON.stringify({
        events: appData.events,
        status: appData.lastStatus,
        lastPoll: appData.lastPoll
      })}\n\n`
    );
  };

  send();

  const timer = setInterval(send, 1000);

  req.on("close", () => {
    clearInterval(timer);
  });
});

app.listen(PORT, () => {
  console.log(`Radar Live rodando na porta ${PORT}`);
  console.log(`Sportradar: ${timelineUrl()}`);

  pollSportradar();

  setInterval(pollSportradar, POLL_MS);
});
