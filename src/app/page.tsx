"use client";

import { useState } from "react";
import { Button, Card, CardBody, CardHeader, Link, Spinner, Textarea } from "@heroui/react";
import { PlaylistRecommendation } from "@/lib/types";

type ApiResponse = {
  recommendation: PlaylistRecommendation;
  error?: string;
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaylistRecommendation | null>(null);

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
        <Card className="max-w-xl w-full">
          <CardBody className="gap-3 items-center py-12">
            <Spinner size="lg" />
            <p>Building your playlist and matching songs on YouTube...</p>
          </CardBody>
        </Card>
      </main>
    );
  }

  if (!result) {
    return (
      <main style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <Card className="max-w-2xl w-full">
          <CardHeader className="flex-col items-start gap-2">
            <h1 style={{ margin: 0, fontSize: "2rem" }}>AI Playlist Builder</h1>
            <p style={{ margin: 0, opacity: 0.8 }}>
              Describe your mood, activity, or music taste. The app will generate and match songs.
            </p>
          </CardHeader>
          <CardBody className="gap-4">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              minRows={6}
              placeholder="Example: Make me a high-energy indie workout playlist with modern female vocals"
            />
            <Button color="primary" onPress={onSubmit} isDisabled={!prompt.trim()}>
              Create Playlist
            </Button>
            {error ? <p style={{ color: "#ff9f9f", margin: 0 }}>{error}</p> : null}
          </CardBody>
        </Card>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
      <Card>
        <CardHeader className="flex-col items-start gap-2">
          <h2 style={{ margin: 0, fontSize: "1.8rem" }}>{result.title}</h2>
          <p style={{ margin: 0, opacity: 0.9 }}>{result.description}</p>
        </CardHeader>
        <CardBody className="gap-4">
          {result.picks.map((pick, index) => (
            <Card key={`${pick.youtubeUrl}-${index}`}>
              <CardBody className="gap-2">
                <strong>{pick.title}</strong>
                <p style={{ margin: 0, opacity: 0.85 }}>{pick.why}</p>
                <Link href={pick.youtubeUrl} target="_blank" rel="noreferrer">
                  Open on YouTube
                </Link>
              </CardBody>
            </Card>
          ))}
          <Button variant="flat" onPress={() => setResult(null)}>
            Create Another Playlist
          </Button>
        </CardBody>
      </Card>
    </main>
  );
}
