"use client";

import { useMemo, useState } from "react";
import { ArrowRightOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Flex, Input, List, Segmented, Space, Spin, Typography } from "antd";
import { PlaylistRecommendation } from "@/lib/types";

const { TextArea } = Input;
const { Title, Paragraph, Text, Link } = Typography;

type ApiResponse = {
  recommendation: PlaylistRecommendation;
  debug?: {
    requestId: string;
    requestedSongCount: number;
    excludedUrlCount: number;
    candidateSongCount: number;
    youtubeSearchRequestsAttempted: number;
    youtubeMatchesFound: number;
    openAiCallCount: number;
    finalPickCount: number;
    youtubeQueriesAttempted: string[];
  };
  error?: string;
};

type SongCount = 10 | 20 | 30;
type RequestSongCount = 5 | SongCount;
type DebugRun = {
  phase: "initial" | "load-more";
  at: string;
  debug: NonNullable<ApiResponse["debug"]>;
};

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get("v");
    if (fromQuery) return fromQuery;

    if (parsed.hostname.includes("youtu.be")) {
      const shortId = parsed.pathname.replace("/", "").trim();
      return shortId || null;
    }
  } catch {
    return null;
  }

  return null;
}

function buildTemporaryPlaylistUrl(urls: string[]): string | null {
  const ids = urls
    .map(extractYouTubeVideoId)
    .filter((id): id is string => Boolean(id));

  if (!ids.length) return null;

  return `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;
}

function dedupePicksByYoutubeUrl(
  existing: PlaylistRecommendation["picks"],
  incoming: PlaylistRecommendation["picks"],
) {
  const seen = new Set(existing.map((pick) => pick.youtubeUrl));
  return incoming.filter((pick) => {
    if (seen.has(pick.youtubeUrl)) return false;
    seen.add(pick.youtubeUrl);
    return true;
  });
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaylistRecommendation | null>(null);
  const [playlistHistory, setPlaylistHistory] = useState<string[]>([]);
  const [debugRuns, setDebugRuns] = useState<DebugRun[]>([]);
  const [songCount, setSongCount] = useState<SongCount>(10);
  const temporaryPlaylistUrl = useMemo(() => {
    if (!result) return null;
    return buildTemporaryPlaylistUrl(result.picks.map((pick) => pick.youtubeUrl));
  }, [result]);

  const cumulativeDebug = useMemo(() => {
    return debugRuns.reduce(
      (acc, run) => {
        acc.openAiCalls += run.debug.openAiCallCount;
        acc.youtubeSearches += run.debug.youtubeSearchRequestsAttempted;
        return acc;
      },
      { openAiCalls: 0, youtubeSearches: 0 },
    );
  }, [debugRuns]);

  async function requestPlaylist(count: RequestSongCount, excludedUrls: string[] = []) {
    const res = await fetch("/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, songCount: count, excludeYoutubeUrls: excludedUrls }),
    });

    const data = (await res.json()) as ApiResponse;

    if (!res.ok || data.error) {
      throw new Error(data.error || "Something went wrong");
    }

    return data;
  }

  async function onSubmit() {
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await requestPlaylist(songCount);
      setResult(data.recommendation);
      setPlaylistHistory(data.recommendation.picks.map((pick) => pick.youtubeUrl));
      const debug = data.debug;
      if (debug) {
        setDebugRuns([{ phase: "initial", at: new Date().toISOString(), debug }]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to contact server";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function onLoadMore() {
    if (!prompt.trim() || !result) return;

    setLoadingMore(true);
    setError(null);

    try {
      const data = await requestPlaylist(5, playlistHistory);
      const uniqueNewPicks = dedupePicksByYoutubeUrl(result.picks, data.recommendation.picks);

      if (!uniqueNewPicks.length) {
        setError("No additional unique songs found. Try a new prompt for more variety.");
        return;
      }

      setResult((current) => {
        if (!current) return current;
        return {
          ...current,
          picks: [...current.picks, ...uniqueNewPicks],
        };
      });
      setPlaylistHistory((current) => [...current, ...uniqueNewPicks.map((pick) => pick.youtubeUrl)]);
      const debug = data.debug;
      if (debug) {
        setDebugRuns((current) => [
          ...current,
          { phase: "load-more", at: new Date().toISOString(), debug },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load more songs";
      setError(message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <main style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <Card style={{ width: "100%", maxWidth: 640, borderRadius: 16 }}>
          <Flex vertical align="center" justify="center" gap={12} style={{ padding: "56px 24px" }}>
            <Spin size="large" />
            <Text type="secondary">Building your playlist and matching tracks on YouTube...</Text>
          </Flex>
        </Card>
      </main>
    );
  }

  if (!result) {
    return (
      <main style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <Card style={{ width: "100%", maxWidth: 760, borderRadius: 16 }}>
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Space direction="vertical" size={6}>
              <Title level={2} style={{ margin: 0 }}>
                AI Playlist Builder
              </Title>
              <Paragraph type="secondary" style={{ margin: 0 }}>
                Describe your mood, activity, or music taste. You will get a curated playlist with links.
              </Paragraph>
            </Space>

            <TextArea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Example: Build me an upbeat late-night coding playlist with synthwave and chill electronic tracks"
              autoSize={{ minRows: 7, maxRows: 12 }}
              showCount
              maxLength={800}
            />

            <Space direction="vertical" size={8}>
              <Text type="secondary">Number of songs</Text>
              <Segmented<SongCount>
                options={[
                  { label: "10 songs", value: 10 },
                  { label: "20 songs", value: 20 },
                  { label: "30 songs", value: 30 },
                ]}
                value={songCount}
                onChange={(value) => setSongCount(value)}
              />
            </Space>

            <Flex justify="space-between" align="center" wrap>
              <Text type="secondary">Tip: mention genre, energy, era, and activity for better results.</Text>
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                onClick={onSubmit}
                disabled={!prompt.trim()}
              >
                Create Playlist
              </Button>
            </Flex>

            {error ? <Alert type="error" message={error} showIcon /> : null}
          </Space>
        </Card>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Card style={{ borderRadius: 16 }}>
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <Title level={3} style={{ margin: 0 }}>
                {result.title}
              </Title>
              <Paragraph type="secondary" style={{ margin: 0 }}>
                {result.description}
              </Paragraph>
            </Space>
          </Card>

          <Card style={{ borderRadius: 16 }}>
            <List
              itemLayout="vertical"
              dataSource={result.picks}
              split
              renderItem={(pick) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Text strong>{pick.title}</Text>
                    <Text type="secondary">{pick.why}</Text>
                    <Link href={pick.youtubeUrl} target="_blank" rel="noreferrer">
                      <Space size={6}>
                        <PlayCircleOutlined />
                        Open on YouTube
                      </Space>
                    </Link>
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          {error ? <Alert type="error" message={error} showIcon /> : null}

          <Flex justify="space-between" align="center" wrap gap={10}>
            {temporaryPlaylistUrl ? (
              <Button type="primary" icon={<PlayCircleOutlined />} href={temporaryPlaylistUrl} target="_blank">
                Open All Songs
              </Button>
            ) : (
              <Text type="secondary">Temporary playlist link unavailable for current picks.</Text>
            )}

            <Space size={10} wrap>
              <Button onClick={onLoadMore} loading={loadingMore} disabled={loadingMore}>
                Load 5 More
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  setResult(null);
                  setPlaylistHistory([]);
                  setDebugRuns([]);
                }}
              >
                Create Another Playlist
              </Button>
            </Space>
          </Flex>

          {debugRuns.length ? (
            <Card style={{ borderRadius: 16 }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Text strong>Debug Summary</Text>
                <Text type="secondary">
                  Session totals: OpenAI calls = {cumulativeDebug.openAiCalls}, YouTube searches ={" "}
                  {cumulativeDebug.youtubeSearches}
                </Text>
                <Collapse
                  items={debugRuns.map((run, index) => ({
                    key: `${run.at}-${index}`,
                    label: `${run.phase === "initial" ? "Initial" : "Load more"} | request ${
                      run.debug.requestId
                    } | OpenAI ${run.debug.openAiCallCount} | YouTube ${run.debug.youtubeSearchRequestsAttempted}`,
                    children: (
                      <pre
                        style={{
                          margin: 0,
                          overflowX: "auto",
                          background: "#f7f7f8",
                          padding: 12,
                          borderRadius: 8,
                        }}
                      >
                        {JSON.stringify(run.debug, null, 2)}
                      </pre>
                    ),
                  }))}
                />
              </Space>
            </Card>
          ) : null}
        </Space>
      </div>
    </main>
  );
}
