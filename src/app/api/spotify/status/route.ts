import { NextRequest, NextResponse } from "next/server";
import { getCookieTokenData } from "@/lib/spotify-oauth";

export async function GET(req: NextRequest) {
  const { accessToken, refreshToken } = getCookieTokenData(req);
  const connected = Boolean(accessToken || refreshToken);
  return NextResponse.json({ connected });
}
