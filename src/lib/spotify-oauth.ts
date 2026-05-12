import { NextRequest } from "next/server";

export const SPOTIFY_SCOPES = ["playlist-modify-public", "playlist-modify-private"];

export type SpotifyTokenPayload = {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  refresh_token?: string;
};

export function getSpotifyEnv() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, or SPOTIFY_REDIRECT_URI");
  }

  return { clientId, clientSecret, redirectUri };
}

export function getCookieTokenData(req: NextRequest) {
  const accessToken = req.cookies.get("spotify_access_token")?.value;
  const refreshToken = req.cookies.get("spotify_refresh_token")?.value;
  const expiresAtRaw = req.cookies.get("spotify_token_expires_at")?.value;
  const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : 0;

  return { accessToken, refreshToken, expiresAt };
}

function basicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(params.clientId, params.clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Spotify auth code exchange failed with status ${res.status}`);
  }

  return (await res.json()) as SpotifyTokenPayload;
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(params.clientId, params.clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Spotify refresh token exchange failed with status ${res.status}`);
  }

  return (await res.json()) as SpotifyTokenPayload;
}

export function isAccessTokenExpired(expiresAt: number) {
  return !expiresAt || Date.now() >= expiresAt - 30_000;
}

export function extractSpotifyTrackUri(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const trackIdx = parts.indexOf("track");
    if (trackIdx < 0 || !parts[trackIdx + 1]) return null;

    const trackId = parts[trackIdx + 1];
    return `spotify:track:${trackId}`;
  } catch {
    return null;
  }
}
