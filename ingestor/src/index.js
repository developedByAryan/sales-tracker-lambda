const LOOKBACK_MINUTES = 3;

const BACKFILL_START = new Date("2025-01-01T00:00:00.000Z");
const BACKFILL_PAGES_PER_RUN = 5;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "sales-ingestor"
      });
    }

    // Test live-sale ingestion.
    if (url.pathname === "/test" && request.method === "POST") {
      const sales = await fetchSales(
        env,
        new Date(Date.now() - LOOKBACK_MINUTES * 60_000)
      );

      await enqueueSales(env, sales, false);

      return Response.json({
        queued: sales.length
      });
    }

    // Historical backfill.
    //
    // The cursor is stored in D1, so simply call:
    //
    // POST /backfill
    //
    // repeatedly until "done": true.
    if (url.pathname === "/backfill" && request.method === "POST") {
      const result = await runBackfill(env);

      return Response.json(result);
    }

    return new Response("Roblox Sales Ingestor");
  },

  // Live ingestion is disabled while historical backfill is running.
  async scheduled() {
    console.log(
      "Live ingestion temporarily disabled while historical backfill is running."
    );
  }
};

async function runBackfill(env) {
  const state = await env.DB.prepare(`
    SELECT cursor, completed
    FROM backfill_state
    WHERE id = 1
  `).first();

  if (!state) {
    throw new Error("Backfill state has not been initialized.");
  }

  if (state.completed) {
    return {
      queued: 0,
      pagesProcessed: 0,
      done: true,
      message: "Historical backfill is already complete."
    };
  }

  let cursor = state.cursor || null;
  let totalQueued = 0;
  let pagesProcessed = 0;

  const baseUrl =
    `https://economy.roblox.com/v2/groups/${env.ROBLOX_GROUP_ID}/transactions`;

  for (
    let pageNumber = 0;
    pageNumber < BACKFILL_PAGES_PER_RUN;
    pageNumber++
  ) {
    const params = new URLSearchParams({
      transactionType: "Sale",
      limit: "100",
      sortOrder: "Desc"
    });

    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetchRoblox(
      env,
      `${baseUrl}?${params}`
    );

    const payload = await response.json();
    const page = payload.data ?? [];

    pagesProcessed++;

    if (page.length === 0) {
      await markBackfillComplete(env);

      return {
        queued: totalQueued,
        pagesProcessed,
        done: true,
        message: "No more Roblox sales were found."
      };
    }

    const sales = [];

    for (const sale of page) {
      const created = new Date(sale.created);

      // Roblox returns transactions newest -> oldest.
      //
      // Once we reach before January 1, 2025,
      // the historical import is complete.
      if (created < BACKFILL_START) {
        if (sales.length > 0) {
          await enqueueSales(env, sales, true);
          totalQueued += sales.length;
        }

        await markBackfillComplete(env);

        return {
          queued: totalQueued,
          pagesProcessed,
          done: true,
          message: "Reached January 1, 2025."
        };
      }

      sales.push(normalizeSale(sale));
    }

    if (sales.length > 0) {
      await enqueueSales(env, sales, true);
      totalQueued += sales.length;
    }

    const nextCursor = payload.nextPageCursor;

    if (!nextCursor) {
      await markBackfillComplete(env);

      return {
        queued: totalQueued,
        pagesProcessed,
        done: true,
        message: "Roblox returned no next page."
      };
    }

    cursor = nextCursor;

    // Save the cursor after successfully processing the page.
    await env.DB.prepare(`
      UPDATE backfill_state
      SET cursor = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(cursor).run();
  }

  return {
    queued: totalQueued,
    pagesProcessed,
    done: false,
    message: "More historical sales remain. Call /backfill again."
  };
}

async function markBackfillComplete(env) {
  await env.DB.prepare(`
    UPDATE backfill_state
    SET completed = 1,
        cursor = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run();
}

async function fetchSales(env, cutoff) {
  const baseUrl =
    `https://economy.roblox.com/v2/groups/${env.ROBLOX_GROUP_ID}/transactions`;

  const allSales = [];
  let cursor = null;

  while (true) {
    const params = new URLSearchParams({
      transactionType: "Sale",
      limit: "100",
      sortOrder: "Desc"
    });

    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetchRoblox(
      env,
      `${baseUrl}?${params}`
    );

    const payload = await response.json();
    const page = payload.data ?? [];

    let reachedCutoff = false;

    for (const sale of page) {
      const created = new Date(sale.created);

      if (created < cutoff) {
        reachedCutoff = true;
        break;
      }

      allSales.push(normalizeSale(sale));
    }

    if (
      reachedCutoff ||
      !payload.nextPageCursor ||
      page.length === 0
    ) {
      break;
    }

    cursor = payload.nextPageCursor;
  }

  return allSales;
}

async function fetchRoblox(env, url) {
  const response = await fetch(url, {
    headers: {
      Cookie: `.ROBLOSECURITY=${env.ROBLOX_COOKIE}`,
      Accept: "application/json"
    }
  });

  if (response.status === 429) {
    throw new Error("Roblox API rate limit reached");
  }

  if (!response.ok) {
    const errorBody = await response.text();

    console.error(
      `Roblox API returned ${response.status}: ${errorBody}`
    );

    throw new Error(
      `Roblox API returned ${response.status}`
    );
  }

  return response;
}

function normalizeSale(sale) {
  return {
    purchaseToken: sale.purchaseToken,
    buyer: sale.agent?.name ?? "Unknown",
    itemName: sale.details?.name ?? "Unknown Item",
    assetId: sale.details?.id ?? null,
    amount: sale.currency?.amount ?? 0,
    created: sale.created
  };
}

async function enqueueSales(env, sales, historical = false) {
  if (!sales.length) return;

  // Historical backfill:
  // Write directly to D1 instead of Cloudflare Queues.
  // This avoids Queue free-tier write limits.
  if (historical) {
    for (const sale of sales) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO sales
          (
            purchase_token,
            buyer,
            item_name,
            asset_id,
            amount,
            created
          )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
        .bind(
          sale.purchaseToken,
          sale.buyer,
          sale.itemName,
          sale.assetId,
          sale.amount,
          sale.created
        )
        .run();
    }

    console.log(
      `Stored ${sales.length} historical sales directly in D1.`
    );

    return;
  }

  // Live sales continue through the Queue.
  const messages = sales.map((sale) => ({
    body: {
      ...sale,
      historical: false
    }
  }));

  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);

    await env.SALES_QUEUE.sendBatch(batch);

    console.log(
      `Queued ${batch.length} live sales (${i + batch.length}/${messages.length})`
    );
  }
}