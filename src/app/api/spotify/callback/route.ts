import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode, getSpotifyEnv } from "@/lib/spotify-oauth";
import { writeApiLogFile } from "@/lib/request-log";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const storedState = req.cookies.get("spotify_oauth_state")?.value;
    const { clientId, clientSecret, redirectUri } = getSpotifyEnv();
    const appOrigin = new URL(redirectUri).origin;

    if (!code || !state || !storedState || state !== storedState) {
      await writeApiLogFile({
        route: "/api/spotify/callback",
        level: "warn",
        event: "STATE_VALIDATION_FAILED",
        context: {
          hasCode: Boolean(code),
          hasState: Boolean(state),
          hasStoredState: Boolean(storedState),
          stateMatches: Boolean(state && storedState && state === storedState),
          query: Object.fromEntries(req.nextUrl.searchParams.entries()),
        },
      });
      return NextResponse.redirect(new URL("/?spotify_auth=failed", appOrigin));
    }

    const tokenPayload = await exchangeAuthorizationCode({
      code,
      clientId,
      clientSecret,
      redirectUri,
    });

    const response = NextResponse.redirect(new URL("/?spotify_auth=connected", appOrigin));
    const expiresAt = Date.now() + tokenPayload.expires_in * 1000;

    response.cookies.set("spotify_access_token", tokenPayload.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: tokenPayload.expires_in,
      path: "/",
    });

    if (tokenPayload.refresh_token) {
      response.cookies.set("spotify_refresh_token", tokenPayload.refresh_token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }

    response.cookies.set("spotify_token_expires_at", String(expiresAt), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: tokenPayload.expires_in,
      path: "/",
    });

    response.cookies.set("spotify_oauth_state", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (error) {
    await writeApiLogFile({
      route: "/api/spotify/callback",
      level: "error",
      event: "CALLBACK_ERROR",
      error,
      context: {
        query: Object.fromEntries(req.nextUrl.searchParams.entries()),
      },
    });
    try {
      const { redirectUri } = getSpotifyEnv();
      return NextResponse.redirect(new URL("/?spotify_auth=failed", new URL(redirectUri).origin));
    } catch {
      return NextResponse.redirect(new URL("/?spotify_auth=failed", req.url));
    }
  }
}
