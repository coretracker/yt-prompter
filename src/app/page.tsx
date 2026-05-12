"use client";

import { useMemo, useState } from "react";
import { ArrowRightOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Flex, Input, List, Space, Spin, Typography } from "antd";
import { PlaylistRecommendation } from "@/lib/types";

const { TextArea } = Input;
const { Title, Paragraph, Text, Link } = Typography;

type ApiResponse = {
  recommendation: PlaylistRecommendation;
  error?: string;
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

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaylistRecommendation | null>(null);
  const temporaryPlaylistUrl = useMemo(() => {
    if (!result) return null;
    return buildTemporaryPlaylistUrl(result.picks.map((pick) => pick.youtubeUrl));
  }, [result]);

  async function onSubmit() {
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const data = (await res.json()) as ApiResponse;

      if (!res.ok || data.error) {
        setError(data.error || "Something went wrong");
        return;
      }

      setResult(data.recommendation);
    } catch {
      setError("Failed to contact server");
    } finally {
      setLoading(false);
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

          <Flex justify="space-between" align="center" wrap gap={10}>
            {temporaryPlaylistUrl ? (
              <Button type="primary" icon={<PlayCircleOutlined />} href={temporaryPlaylistUrl} target="_blank">
                Open All Songs
              </Button>
            ) : (
              <Text type="secondary">Temporary playlist link unavailable for current picks.</Text>
            )}

            <Button icon={<ReloadOutlined />} onClick={() => setResult(null)}>
              Create Another Playlist
            </Button>
          </Flex>
        </Space>
      </div>
    </main>
  );
}
