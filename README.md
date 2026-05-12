# AI Playlist Builder

Next.js app that builds playlist recommendations from a user prompt by combining OpenAI and YouTube Data API results.

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
- `YOUTUBE_API_KEY`

4. Start development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Flow

1. User enters a playlist prompt.
2. OpenAI returns structured JSON candidates (songs + vibe).
3. Server searches YouTube per song.
4. OpenAI receives full context (original candidates + YouTube responses) and generates final playlist recommendations.
5. UI shows title, description, and YouTube links.
