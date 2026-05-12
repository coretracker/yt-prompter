import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { PlaylistRecommendation, SongCandidate, YouTubeMatch } from "@/lib/types";

const requestSchema = z.object({
  prompt: z.string().min(5),
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
    .max(20),
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid prompt" }, { status: 400 });
    }

    const { openAiApiKey, youTubeApiKey } = getEnv();
    const openai = new OpenAI({ apiKey: openAiApiKey });

    const firstPass = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You create structured music candidates. Return JSON only with shape { vibe: string, songs: [{ title: string, artist?: string, reason?: string }] }. Include 10 songs.",
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
    if (!firstRaw) {
      return NextResponse.json({ error: "OpenAI first pass returned empty content" }, { status: 500 });
    }

    const firstJson = JSON.parse(firstRaw);
    const candidates = candidatesSchema.parse(firstJson);

    const youtubeResults = (
      await Promise.all(candidates.songs.map((song) => fetchYouTubeMatch(song, youTubeApiKey)))
    ).filter((item): item is YouTubeMatch => Boolean(item));

    const secondPass = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Given initial desired songs and YouTube matches, choose the best matching playlist and return JSON only with shape { title: string, description: string, picks: [{ title: string, why: string, youtubeUrl: string }] }. Pick 8-12 songs.",
        },
        {
          role: "user",
          content: JSON.stringify({
            originalPrompt: parsed.data.prompt,
            candidates,
            youtubeResults,
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.6,
    });

    const secondRaw = secondPass.choices[0]?.message?.content;
    if (!secondRaw) {
      return NextResponse.json({ error: "OpenAI second pass returned empty content" }, { status: 500 });
    }

    const recommendation = recommendationSchema.parse(JSON.parse(secondRaw)) as PlaylistRecommendation;

    return NextResponse.json({
      recommendation,
      debugContext: {
        candidates,
        youtubeResults,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
