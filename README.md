# AI Playlist Builder

Next.js app that builds playlist recommendations from a user prompt by combining OpenAI and Spotify API results.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Add keys:

- `OPENAI_API_KEY`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

4. Start development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Flow

1. User enters a playlist prompt.
2. OpenAI returns structured JSON candidates (songs + vibe).
3. Server searches Spotify per song.
4. OpenAI receives full context (original candidates + Spotify responses) and generates final playlist recommendations.
5. UI shows title, description, and Spotify links.
