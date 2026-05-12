import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSpotifyEnv, SPOTIFY_SCOPES } from "@/lib/spotify-oauth";

export async function GET() {
  try {
    const { clientId, redirectUri } = getSpotifyEnv();
    const state = randomUUID();

    const authUrl = new URL("https://accounts.spotify.com/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("show_dialog", "true");

    const response = NextResponse.redirect(authUrl);
    response.cookies.set("spotify_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start Spotify login";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
