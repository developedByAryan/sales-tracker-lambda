# Roblox Sales Tracker

A Cloudflare-based system for tracking Roblox sales, storing them reliably, and making the data available through an API and dashboard. The system supports both real-time sales collection and historical data backfilling while preventing duplicate records.

## Overview

The project is divided into two main parts: **live sales ingestion** and **historical backfilling**.

For live sales, the `roblox-sales-ingestor` Worker runs every minute using a Cloudflare Cron Trigger. It communicates with the Roblox API, identifies sales that need to be recorded, and sends them to a Cloudflare Queue named `roblox-sales`.

The Queue separates the process of collecting sales from processing them. This means the ingestor does not have to wait for database operations to finish, while temporary spikes in sales can be handled without putting unnecessary load on the ingestor.

The `roblox-sales-processor` Worker consumes messages from the Queue and stores the sales in the `roblox-sales-db` Cloudflare D1 database. Failed messages can be routed to the `roblox-sales-dlq` dead-letter queue for further investigation.

The overall live-data flow is:

```text
Roblox API → Ingestor → Queue → Processor → D1 → API / Dashboard
```

## Live API

The sales processor is deployed on Cloudflare Workers and provides the following endpoints.

**Base URL:**  
https://roblox-sales-processor.rnshahi34.workers.dev/

| Endpoint | Purpose |
|---|---|
| `/` | Basic Worker/API response |
| `/api/sales?limit=10` | Returns the 10 most recent sales |
| `/api/stats?period=today` | Returns sales statistics for today |
| `/api/stats?period=weekly` | Returns sales statistics for the current week |

### Quick Links

- [API](https://roblox-sales-processor.rnshahi34.workers.dev/)
- [Recent Sales](https://roblox-sales-processor.rnshahi34.workers.dev/api/sales?limit=10)
- [Today's Statistics](https://roblox-sales-processor.rnshahi34.workers.dev/api/stats?period=today)
- [Weekly Statistics](https://roblox-sales-processor.rnshahi34.workers.dev/api/stats?period=weekly)

These endpoints can be used to verify that the Worker is running, check whether sales are reaching the database, and test the statistics used by the dashboard.

## Why Cloudflare Queues?

The Queue acts as a buffer between the ingestor and processor. The ingestor's main responsibility is to collect data quickly, while the processor handles validation, duplicate prevention, and database operations.

This separation makes the system more reliable and allows the processor to work through sales independently of when they were collected.

The Queue is not intended to permanently store sales. Messages are normally consumed shortly after being added, so an empty Queue does **not** mean that sales are missing. D1 is the permanent storage layer and should be used to verify whether sales were successfully recorded.

## Sales Ingestor

`roblox-sales-ingestor` is responsible for collecting new Roblox sales. It runs automatically every minute and sends newly discovered sales to the `roblox-sales` Queue.

Keeping database processing out of the ingestor makes the collection process lightweight and allows the processor to handle storage separately.

The Worker also provides a `/backfill` endpoint for importing historical sales.

## Historical Backfill

Historical sales use a slightly different path from live sales. Instead of sending potentially thousands of historical records through the Queue, the backfill process writes them directly into D1.

```text
Backfill → D1
```

This avoids unnecessarily consuming Queue operations and prevents a large historical import from interfering with normal live-sales processing.

Backfilling is useful when initially populating the database, recovering missing historical data, or importing sales from an earlier period.

```http
POST /backfill
```

## Sales Processor

`roblox-sales-processor` is responsible for processing live Queue messages and storing them in D1.

It validates incoming sales and uses the Roblox `saleId` as the unique identifier. This prevents the same sale from being inserted multiple times if it is received again due to overlapping API requests, retries, or backfills.

D1 therefore acts as the **source of truth** for the entire application.

## Database

The project uses Cloudflare D1 through the `roblox-sales-db` database.

The database stores the collected sales and provides the data used by the API and dashboard. Because the dashboard reads from D1 rather than directly from Roblox, it can efficiently calculate historical statistics, recent sales, daily totals, and other analytics.

The initial database schema is defined in the project's migration files.

## Timezone Handling

The dashboard uses **Nepal Time (`Asia/Kathmandu`, UTC+5:45)** when determining daily sales.

This is important because Cloudflare and JavaScript commonly work with UTC timestamps. If the application simply compares UTC dates, sales around midnight in Nepal can appear under the wrong day.

The same timezone logic needs to be applied consistently to the **Today** statistics, daily graphs, and date filtering.

For example, the 7-day graph can contain the correct sales while the "Today" section is missing some sales if the start-of-day calculation is based on UTC instead of Nepal time.

## Troubleshooting

When new sales are not appearing, the live pipeline should be checked from ingestion through storage. First verify that the ingestor is successfully receiving new sales from Roblox. Then check whether the sales are being added to the Queue and consumed by the processor.

If the Queue is empty, that is not automatically a problem. A healthy processor can consume messages almost immediately after they are added. The more reliable checks are the processor logs, D1 records, and the API response.

If historical backfill works but new live sales do not appear, the two paths should be debugged separately. Backfill writes directly to D1, while live sales depend on the ingestor, Queue, and processor all working correctly.

If sales exist in D1 but are missing from the dashboard, the problem is likely in the API query or dashboard's date/time filtering rather than the ingestion system.

## Deployment

The Workers are deployed using Wrangler:

```bash
npx wrangler deploy
```

Secrets are configured through Wrangler:

```bash
npx wrangler secret put <SECRET_NAME>
```

The project uses Cloudflare Workers, Cron Triggers, Queues, a Dead-Letter Queue, and D1.

## Project Principle

The system follows a simple separation of responsibilities: **the ingestor collects live data, the Queue handles asynchronous communication, the processor stores and validates the data, and D1 provides persistent storage for the API and dashboard.**

Historical imports bypass the Queue when appropriate, while live sales continue through the Queue to keep the ingestion process fast and reliable.