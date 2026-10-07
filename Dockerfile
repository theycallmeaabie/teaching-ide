# One image, one process: the API serves the built app, so there is no second
# origin, no CORS to get right and no proxy to configure.
#
#   docker build -t teaching-ide \
#     --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... .
#   docker run -p 8000:8000 --env-file .env teaching-ide
#
# The two VITE_ values are baked into the browser bundle at BUILD time (they are
# public by design — row-level security is what protects the data). Everything
# else, including the model key, is read at RUN time and never enters the image.

# ---- build the app ---------------------------------------------------------
FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY scripts ./scripts
COPY public ./public
COPY src ./src
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

# ---- serve it --------------------------------------------------------------
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY --from=web /app/dist ./dist

# Not root: the process only needs to read the app and write the response cache.
RUN useradd --system --no-create-home app && mkdir -p server/.cache && chown -R app server/.cache
USER app

ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health')" || exit 1

# Single process on purpose: the rate limits live in memory (see server/quota.py).
CMD ["sh", "-c", "exec uvicorn server.main:app --host 0.0.0.0 --port ${PORT}"]
