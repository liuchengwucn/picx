# PicX

[Nano Banana 2](https://blog.google/innovation-and-ai/technology/ai/nano-banana-2/) excels at whiteboard generation, [Emergent Mind](https://www.emergentmind.com/) excels at paper summarization—it would be even better if there was an open-source solution accessible to the research community.

A modern web application for PDF processing and visualization, built with TanStack Start and Cloudflare Workers.

If you find this project helpful, please consider giving it a star ⭐

English | [简体中文](README.zh-CN.md)

## Demo

![Paper Analysis Example](public/paper-example.webp)

![Whiteboard Example](public/whiteboard-example.webp)

## Features

- **PDF Processing**: Upload and process PDF documents with advanced parsing capabilities
- **Intuitive Whiteboard**: Visualize and organize ideas with an intuitive whiteboard interface
- **Authentication**: Secure user authentication powered by Better Auth
- **Internationalization**: Full support for English and Simplified Chinese
- **Modern UI**: Responsive design with Tailwind CSS and Shadcn components
- **Real-time Updates**: Optimistic UI updates with TanStack Query
- **Type-safe API**: End-to-end type safety with tRPC

## Tech Stack

### Frontend
- **Framework**: TanStack Start
- **UI Components**: Shadcn UI
- **Styling**: Tailwind CSS v4
- **State Management**: TanStack Store
- **Data Fetching**: TanStack Query
- **Forms**: TanStack Form
- **Tables**: TanStack Table
- **Routing**: TanStack Router

### Backend
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **ORM**: Drizzle ORM
- **API**: tRPC
- **Authentication**: Better Auth & GitHub OAuth

### Development
- **Language**: TypeScript
- **Build Tool**: Vite
- **Linting & Formatting**: Biome
- **Testing**: Vitest
- **Internationalization**: Paraglide JS

## Local Development

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account (for deployment)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/liuchengwucn/picx.git
cd picx
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and configure the following:

**Required for local development:**
- `BETTER_AUTH_SECRET`: Generate with `npx -y @better-auth/cli secret`
- `BETTER_AUTH_URL`: Set to `http://localhost:3000` for local development

**Required for OAuth (if using GitHub login):**
- `GITHUB_CLIENT_ID`: Your GitHub OAuth app client ID
- `GITHUB_CLIENT_SECRET`: Your GitHub OAuth app client secret

**Required for AI features:**
- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_BASE_URL`: OpenAI API endpoint (default: `https://api.openai.com/v1`)
- `OPENAI_MODEL`: Model to use (e.g., `gpt-4o-mini`)
- `GEMINI_API_KEY`: Your Google Gemini API key
- `GEMINI_BASE_URL`: Gemini API endpoint
- `GEMINI_MODEL`: Model to use (e.g., `gemini-3.1-flash-image-preview`)

**Required for production deployment:**
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID
- `CLOUDFLARE_D1_DATABASE_ID`: Your D1 database ID
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with D1 permissions

**Optional:**
- `CF_API_TOKEN`: For using Cloudflare AI Gateway

4. Set up the database:
```bash
# Generate migration files
npm run db:generate

# Apply migrations locally
npx wrangler d1 migrations apply <DATABASE_NAME> --local
```

### Running the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

### Building for Production

```bash
npm run build
```

### Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

Make sure you have configured `wrangler.toml` with your Cloudflare account details and bindings.

### Testing

Run tests:
```bash
npm run test
```

### Code Quality

```bash
# Lint code
npm run lint

# Format code
npm run format

# Check both linting and formatting
npm run check
```

## Project Structure

```
picx/
├── src/
│   ├── routes/          # File-based routing
│   ├── components/      # React components
│   ├── lib/            # Utilities and configurations
│   ├── server/         # Server-side code
│   └── paraglide/      # Generated i18n files
├── drizzle/            # Database migrations
├── public/             # Static assets
└── wrangler.toml       # Cloudflare Workers configuration
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
