# NEWSFORGE AI

NEWSFORGE AI is an editorial intelligence command center for discovering news, researching claims, generating platform-specific content, applying a human approval gate, and preparing approved stories for distribution.

## Pipeline

`Discovery → Research → Content → Approval → Publish → Schedule → Analytics`

## Current structure

- `index.html` — single-page command center UI
- `api/news.js` — news discovery and AI ranking
- `api/research.js` — research and verification
- `api/content.js` — editorial content generation
- `api/approval.js` — human approval gate
- `api/publish.js` — publishing authorization/adapters
- `api/schedule.js` — publishing schedule management
- `api/analytics.js` — analytics/reporting layer

The API files are designed for Vercel Serverless Functions.

## Required environment variables

- `NEWS_API_KEY`
- `GEMINI_API_KEY`

See `.env.example` for the complete template.

## Local development

This project is intentionally dependency-light. For Vercel, the root `index.html` is the frontend and files under `api/` are serverless functions.

1. Install the Vercel CLI if needed.
2. Link the project to your Vercel account.
3. Add the variables from `.env.example` to the local/Vercel environment.
4. Run the project with Vercel's local development server.

Never commit real API keys, access tokens, cookies, or provider secrets.

## Editorial safety

Research is not approval. High attention is not proof. Publishing must remain behind the explicit human approval gate and the backend must validate approval state rather than trusting the browser.

## Status

The repository contains the core command-center architecture and API boundaries. Provider-specific publishing credentials and production persistence can be connected without redesigning the pipeline.
