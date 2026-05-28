# Tasklist Railway Deployment

This repo is ready to deploy to Railway as one web service from a fork.

## Railway setup

1. Create a new Railway project from your forked GitHub repo.
2. Add a MongoDB service in the same Railway project.
3. In the web service, set these variables:

```text
MONGODB_URI=${{MongoDB.MONGO_URL}}
FIRST_ADMIN=your-admin-email@example.com
```

Do not set `VITE_API_URL` for a single Railway service. The built frontend will call the API on the same Railway domain.

For Microsoft sign-in, set the frontend build variables before Railway builds:

```text
VITE_APP_ID=your-microsoft-app-id
VITE_DIRECT_ID=your-entra-tenant-id
VITE_REDIRECT_URI=https://your-railway-domain.up.railway.app
```

Also add the same Railway domain as a redirect URI in Microsoft Entra.

## Local development

Install dependencies in each app:

```bash
npm ci --prefix server
npm ci --prefix tasklist
```

Start the API:

```bash
npm run dev --prefix server
```

Start the Vite app:

```bash
npm run dev --prefix tasklist
```

Import seed tasks into MongoDB:

```bash
npm run import:tasks
```

## How Railway runs it

Railway uses `railway.json` at the repo root:

```bash
npm run railway:build
npm start
```

The build installs both subprojects from their lockfiles, builds `tasklist/dist`, and the Express server serves that static frontend plus the API routes.
