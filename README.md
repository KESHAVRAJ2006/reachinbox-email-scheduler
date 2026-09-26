# Email Job Scheduler

Schedule email campaigns that send at the right time, survive server restarts, never send
the same email twice, and respect per-sender hourly limits. Built for the ReachInbox
take-home assignment.

> Work in progress. Full setup, architecture and design notes are added in the final phase.

## Repository layout

```
backend/    Express API + separate BullMQ worker process (TypeScript)
frontend/   React + Vite + Tailwind dashboard
docker-compose.yml   Postgres, Redis, Elasticsearch for local development
```

## Local infrastructure

Requires Docker Desktop.

```powershell
docker compose up -d     # start Postgres, Redis and Elasticsearch
docker compose ps        # wait until all three show "(healthy)"
docker compose down      # stop; data is kept in Docker volumes
```

| Service         | Address                 | Role                                        |
| --------------- | ----------------------- | ------------------------------------------- |
| Postgres 17     | `127.0.0.1:5432`        | Source of truth for users, senders, emails  |
| Redis 7.4 (AOF) | `127.0.0.1:6379`        | BullMQ delayed jobs and rate-limit counters |
| Elasticsearch 8 | `http://127.0.0.1:9200` | Full-text search over scheduled/sent emails |
