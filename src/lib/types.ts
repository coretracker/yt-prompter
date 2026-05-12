export type SongCandidate = {
  title: string;
  artist?: string;
  reason?: string;
};

export type YouTubeMatch = {
  query: string;
  videoId: string;
  title: string;
  channelTitle: string;
  url: string;
  description?: string;
};

export type PlaylistRecommendation = {
  title: string;
  description: string;
  picks: Array<{
    title: string;
    why: string;
    youtubeUrl: string;
  }>;
};
