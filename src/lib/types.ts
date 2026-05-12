export type SongCandidate = {
  title: string;
  artist?: string;
  reason?: string;
};

export type SpotifyMatch = {
  query: string;
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  url: string;
};

export type PlaylistRecommendation = {
  title: string;
  description: string;
  picks: Array<{
    title: string;
    why: string;
    songUrl: string;
  }>;
};
