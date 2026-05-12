import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { PlaylistRecommendation, SongCandidate, SpotifyMatch } from "@/lib/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  prompt: z.string().min(5),
  songCount: z.union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)]),
  excludeSongUrls: z.array(z.string().url()).optional(),
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
        songUrl: z.string().url(),
      }),
    )
    .min(1),
});

type SpotifySearchResponse = {
  tracks?: {
    items?: Array<{
      id?: string;
      name?: string;
      artists?: Array<{ name?: string }>;
      album?: { name?: string };
      external_urls?: { spotify?: string };
    }>;
  };
};

let spotifyTokenCache: { token: string; expiresAt: number } | null = null;

const getEnv = () => {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
  const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!openAiApiKey || !spotifyClientId || !spotifyClientSecret) {
    throw new Error("Missing OPENAI_API_KEY, SPOTIFY_CLIENT_ID, or SPOTIFY_CLIENT_SECRET in environment variables");
  }

  return { openAiApiKey, spotifyClientId, spotifyClientSecret };
};

function buildTrackQuery(song: SongCandidate): string {
  return [song.title, song.artist].filter(Boolean).join(" ");
}

async function getSpotifyAccessToken(clientId: string, clientSecret: string) {
  if (spotifyTokenCache && spotifyTokenCache.expiresAt > Date.now()) {
    return spotifyTokenCache.token;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials" });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Spotify token request failed with status ${res.status}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token || !data.expires_in) {
    throw new Error("Spotify token response was invalid");
  }

  spotifyTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return spotifyTokenCache.token;
}

async function fetchSpotifyMatch(song: SongCandidate, accessToken: string): Promise<SpotifyMatch | null> {
  const query = buildTrackQuery(song);
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data = (await res.json()) as SpotifySearchResponse;
  const track = data.tracks?.items?.[0];
  const trackId = track?.id;
  const spotifyUrl = track?.external_urls?.spotify;

  if (!trackId || !spotifyUrl) return null;

  return {
    query,
    trackId,
    title: track?.name || song.title,
    artist: track?.artists?.[0]?.name || song.artist || "Unknown artist",
    album: track?.album?.name,
    url: spotifyUrl,
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

  let openAiCallCount = 0;
  let spotifySearchRequestsAttempted = 0;

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

    const { openAiApiKey, spotifyClientId, spotifyClientSecret } = getEnv();
    const excludedSongUrls = parsed.data.excludeSongUrls || [];
    const candidateCount = Math.min(40, parsed.data.songCount + Math.min(20, excludedSongUrls.length));

    addLog("REQUEST_PROMPT", parsed.data.prompt);
    addLog("REQUEST_SONG_COUNT", parsed.data.songCount);
    addLog("REQUEST_EXCLUDED_URL_COUNT", excludedSongUrls.length);

    const openai = new OpenAI({ apiKey: openAiApiKey });
    const spotifyAccessToken = await getSpotifyAccessToken(spotifyClientId, spotifyClientSecret);

    openAiCallCount += 1;
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

    spotifySearchRequestsAttempted = candidates.songs.length;
    const spotifyResults = (
      await Promise.all(candidates.songs.map((song) => fetchSpotifyMatch(song, spotifyAccessToken)))
    ).filter((item): item is SpotifyMatch => Boolean(item));
    addLog("SPOTIFY_RESULTS", spotifyResults);

    openAiCallCount += 1;
    const secondPass = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            `Given initial desired songs and Spotify matches, choose the best matching playlist and return JSON only with shape { title: string, description: string, picks: [{ title: string, why: string, songUrl: string }] }. Return exactly ${parsed.data.songCount} picks.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            originalPrompt: parsed.data.prompt,
            constraint: "Do not return picks whose songUrl appears in excludedSongUrls.",
            excludedSongUrls,
            candidates,
            spotifyResults,
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
    const excludedSet = new Set(excludedSongUrls);
    const uniquePicks = recommendation.picks.filter(
      (pick, index, arr) =>
        !excludedSet.has(pick.songUrl) &&
        arr.findIndex((entry) => entry.songUrl === pick.songUrl) === index,
    );

    if (uniquePicks.length < parsed.data.songCount) {
      for (const match of spotifyResults) {
        if (excludedSet.has(match.url)) continue;
        if (uniquePicks.some((pick) => pick.songUrl === match.url)) continue;

        uniquePicks.push({
          title: `${match.title} - ${match.artist}`,
          why: "Added as an additional relevant match from Spotify results.",
          songUrl: match.url,
        });

        if (uniquePicks.length >= parsed.data.songCount) break;
      }
    }

    const finalRecommendation: PlaylistRecommendation = {
      ...recommendation,
      picks: uniquePicks.slice(0, parsed.data.songCount),
    };
    addLog("OPENAI_SECOND_PASS_PARSED", finalRecommendation);

    const debug = {
      requestId,
      requestedSongCount: parsed.data.songCount,
      excludedUrlCount: excludedSongUrls.length,
      candidateSongCount: candidates.songs.length,
      spotifySearchRequestsAttempted,
      spotifyMatchesFound: spotifyResults.length,
      openAiCallCount,
      finalPickCount: finalRecommendation.picks.length,
      spotifyQueriesAttempted: candidates.songs.map((song) => buildTrackQuery(song)),
    };
    addLog("REQUEST_DEBUG", debug);

    return NextResponse.json({
      recommendation: finalRecommendation,
      debug,
      debugContext: {
        candidates,
        spotifyResults,
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
