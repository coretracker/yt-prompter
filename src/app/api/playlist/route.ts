import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { PlaylistRecommendation, SongCandidate, YouTubeMatch } from "@/lib/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  prompt: z.string().min(5),
  songCount: z.union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)]),
  excludeYoutubeUrls: z.array(z.string().url()).optional(),
});

const candidatesSchema = z.object({
  vibe: z.string(),
  songs: z
    .array(
      z.object({
        title: z.string(),
        artist: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .min(5)
    .max(40),
});

const recommendationSchema = z.object({
  title: z.string(),
  description: z.string(),
  picks: z
    .array(
      z.object({
        title: z.string(),
        why: z.string(),
        youtubeUrl: z.string().url(),
      }),
    )
    .min(1),
});

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    description?: string;
  };
};

const getEnv = () => {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const youTubeApiKey = process.env.YOUTUBE_API_KEY;

  if (!openAiApiKey || !youTubeApiKey) {
    throw new Error("Missing OPENAI_API_KEY or YOUTUBE_API_KEY in environment variables");
  }

  return { openAiApiKey, youTubeApiKey };
};

async function fetchYouTubeMatch(song: SongCandidate, apiKey: string): Promise<YouTubeMatch | null> {
  const query = [song.title, song.artist, "official audio"].filter(Boolean).join(" ");

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as { items?: YouTubeSearchItem[] };
  const item = data.items?.[0];
  const videoId = item?.id?.videoId;
  if (!videoId) return null;

  return {
    query,
    videoId,
    title: item?.snippet?.title || song.title,
    channelTitle: item?.snippet?.channelTitle || "Unknown channel",
    description: item?.snippet?.description,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function stringifyLogData(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

async function writeRequestLog(fileName: string, lines: string[]) {
  const logDir = path.join(process.cwd(), "logs");
  await mkdir(logDir, { recursive: true });
  await writeFile(path.join(logDir, fileName), `${lines.join("\n\n")}\n`, "utf8");
}

export async function POST(req: NextRequest) {
  const startedAt = new Date();
  const requestId = randomUUID();
  const logFileName = `${startedAt.toISOString().replace(/[:.]/g, "-")}_${requestId}.txt`;
  const logLines: string[] = [];

  const addLog = (title: string, data: unknown) => {
    logLines.push(`[${new Date().toISOString()}] ${title}\n${stringifyLogData(data)}`);
  };

  addLog("REQUEST_START", {
    requestId,
    method: req.method,
    path: req.nextUrl.pathname,
  });

  try {
    const body = await req.json();
    addLog("REQUEST_BODY", body);

    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      addLog("REQUEST_VALIDATION_ERROR", parsed.error.format());
      return NextResponse.json({ error: "Invalid prompt" }, { status: 400 });
    }

    const { openAiApiKey, youTubeApiKey } = getEnv();
    const excludedYoutubeUrls = parsed.data.excludeYoutubeUrls || [];
    const candidateCount = Math.min(40, parsed.data.songCount + Math.min(20, excludedYoutubeUrls.length));
    addLog("REQUEST_PROMPT", parsed.data.prompt);
    addLog("REQUEST_SONG_COUNT", parsed.data.songCount);
    addLog("REQUEST_EXCLUDED_URL_COUNT", excludedYoutubeUrls.length);
    const openai = new OpenAI({ apiKey: openAiApiKey });

    const firstPass = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            `You create structured music candidates. Return JSON only with shape { vibe: string, songs: [{ title: string, artist?: string, reason?: string }] }. Include exactly ${candidateCount} songs.`,
        },
        {
          role: "user",
          content: parsed.data.prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });

    const firstRaw = firstPass.choices[0]?.message?.content;
    addLog("OPENAI_FIRST_PASS_RAW", firstRaw || "EMPTY");
    if (!firstRaw) {
      return NextResponse.json({ error: "OpenAI first pass returned empty content" }, { status: 500 });
    }

    const firstJson = JSON.parse(firstRaw);
    const candidates = candidatesSchema.parse(firstJson);
    addLog("OPENAI_FIRST_PASS_PARSED", candidates);

    const youtubeResults = (
      await Promise.all(candidates.songs.map((song) => fetchYouTubeMatch(song, youTubeApiKey)))
    ).filter((item): item is YouTubeMatch => Boolean(item));
    addLog("YOUTUBE_RESULTS", youtubeResults);

    const secondPass = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            `Given initial desired songs and YouTube matches, choose the best matching playlist and return JSON only with shape { title: string, description: string, picks: [{ title: string, why: string, youtubeUrl: string }] }. Return exactly ${parsed.data.songCount} picks.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            originalPrompt: parsed.data.prompt,
            constraint: "Do not return picks whose youtubeUrl appears in excludedYoutubeUrls.",
            excludedYoutubeUrls,
            candidates,
            youtubeResults,
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.6,
    });

    const secondRaw = secondPass.choices[0]?.message?.content;
    addLog("OPENAI_SECOND_PASS_RAW", secondRaw || "EMPTY");
    if (!secondRaw) {
      return NextResponse.json({ error: "OpenAI second pass returned empty content" }, { status: 500 });
    }

    const recommendation = recommendationSchema.parse(JSON.parse(secondRaw)) as PlaylistRecommendation;
    const excludedSet = new Set(excludedYoutubeUrls);
    const uniquePicks = recommendation.picks.filter(
      (pick, index, arr) =>
        !excludedSet.has(pick.youtubeUrl) &&
        arr.findIndex((entry) => entry.youtubeUrl === pick.youtubeUrl) === index,
    );

    if (uniquePicks.length < parsed.data.songCount) {
      for (const match of youtubeResults) {
        if (excludedSet.has(match.url)) continue;
        if (uniquePicks.some((pick) => pick.youtubeUrl === match.url)) continue;

        uniquePicks.push({
          title: match.title,
          why: "Added as an additional relevant match from YouTube results.",
          youtubeUrl: match.url,
        });

        if (uniquePicks.length >= parsed.data.songCount) break;
      }
    }

    const finalRecommendation: PlaylistRecommendation = {
      ...recommendation,
      picks: uniquePicks.slice(0, parsed.data.songCount),
    };
    addLog("OPENAI_SECOND_PASS_PARSED", finalRecommendation);

    return NextResponse.json({
      recommendation: finalRecommendation,
      debugContext: {
        candidates,
        youtubeResults,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    addLog("REQUEST_ERROR", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    addLog("REQUEST_END", {
      requestId,
      durationMs: Date.now() - startedAt.getTime(),
      logFileName,
    });

    try {
      await writeRequestLog(logFileName, logLines);
    } catch (logError) {
      console.error("Failed to write request log", logError);
    }
  }
}
