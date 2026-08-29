// const NPT_OFFSET = "+05:45";
// const BIG_SALE_THRESHOLD = 1000;

// export default {
//   async fetch(request, env) {
//     const url = new URL(request.url);

//     if (request.method === "GET" && url.pathname === "/") {
//       return new Response(renderDashboard(), {
//         headers: { "content-type": "text/html; charset=UTF-8" }
//       });
//     }

//     if (request.method === "GET" && url.pathname === "/health") {
//       return Response.json({ ok: true, service: "sales-processor" });
//     }

//     if (request.method === "GET" && url.pathname === "/api/sales") {
//       const limit = Math.min(
//         Math.max(Number(url.searchParams.get("limit") || 10), 1),
//         100
//       );

//       const result = await env.DB.prepare(`
//         SELECT purchase_token, buyer, item_name, asset_id, amount, created
//         FROM sales
//         ORDER BY created DESC
//         LIMIT ?
//       `).bind(limit).all();

//       return Response.json(result.results);
//     }

//     if (request.method === "GET" && url.pathname === "/api/stats") {
//       const period = url.searchParams.get("period") || "today";
//       return Response.json(await getStats(env.DB, period));
//     }

//     if (request.method === "POST" && url.pathname === "/discord/interactions") {
//       return handleDiscordInteraction(request, env);
//     }

//     return new Response("Not Found", { status: 404 });
//   },

//   async queue(batch, env) {
//     for (const message of batch.messages) {
//       await processSale(env, message.body);
//     }
//   }
// };

// async function processSale(env, sale) {
//   const insert = await env.DB.prepare(`
//     INSERT OR IGNORE INTO sales
//       (purchase_token, buyer, item_name, asset_id, amount, created)
//     VALUES (?, ?, ?, ?, ?, ?)
//   `).bind(
//     sale.purchaseToken,
//     sale.buyer,
//     sale.itemName,
//     sale.assetId,
//     sale.amount,
//     sale.created
//   ).run();

//   // If this sale already exists, don't process it again.
//   if ((insert.meta?.changes ?? 0) === 0) {
//     return;
//   }

//   // Historical backfill:
//   // Save the sale to D1, but DO NOT send a Discord notification.
//   if (sale.historical === true) {
//     console.log(
//       `Imported historical sale ${sale.purchaseToken}`
//     );
//     return;
//   }

//   // Normal live sale:
//   // Send Discord notification.
//   await sendDiscordSaleNotification(env, sale);

//   await env.DB.prepare(`
//     UPDATE sales
//     SET notified_at = ?
//     WHERE purchase_token = ?
//   `).bind(
//     new Date().toISOString(),
//     sale.purchaseToken
//   ).run();

//   console.log(
//     `Processed live sale ${sale.purchaseToken}`
//   );
// }

// async function sendDiscordSaleNotification(env, sale) {
//   const isBig = sale.amount >= BIG_SALE_THRESHOLD;
//   const content = isBig
//     ? `🚨 BIG SALE! <@${env.DISCORD_MENTION_USER_ID}> Sold **${sale.itemName}** for **${sale.amount} Robux**`
//     : `NEW SALE 🎉 Sold **${sale.itemName}** for **${sale.amount} Robux**`;

//   const embed = {
//     title: isBig ? "🚨 BIG SALE!" : "🛒 New Group Sale",
//     description:
//       `Buyer: **${sale.buyer}**\n` +
//       `Item: **${sale.itemName}**\n` +
//       `Amount: **${sale.amount} Robux**\n` +
//       `Time: ${formatNPT(sale.created)}`,
//     color: isBig ? 0xffd700 : 0x00ff00,
//     timestamp: new Date().toISOString()
//   };

//   if (sale.assetId) {
//     embed.thumbnail = {
//       url:
//         `https://www.roblox.com/asset-thumbnail/image?` +
//         `assetId=${encodeURIComponent(sale.assetId)}&width=420&height=420&format=png`
//     };
//   }

//   const response = await fetch(`${env.DISCORD_WEBHOOK_URL}?wait=true`, {
//     method: "POST",
//     headers: { "content-type": "application/json" },
//     body: JSON.stringify({
//       content,
//       embeds: [embed],
//       allowed_mentions: env.DISCORD_MENTION_USER_ID
//         ? { users: [env.DISCORD_MENTION_USER_ID] }
//         : { parse: [] }
//     })
//   });

//   if (!response.ok) {
//     throw new Error(`Discord webhook returned ${response.status}`);
//   }
// }

// async function handleDiscordInteraction(request, env) {
//   const body = await request.text();

//   const verified = await verifyDiscordSignature(request, body, env.DISCORD_PUBLIC_KEY);
//   if (!verified) {
//     return new Response("invalid request signature", { status: 401 });
//   }

//   const interaction = JSON.parse(body);

//   // Discord sends type 1 when validating the endpoint.
//   if (interaction.type === 1) {
//     return Response.json({ type: 1 });
//   }

//   if (interaction.type !== 2) {
//     return Response.json({
//       type: 4,
//       data: { content: "Unsupported interaction." }
//     });
//   }

//   const command = interaction.data?.name;
//   const responseData = await commandResponse(env.DB, command);

//   return Response.json({
//     type: 4,
//     data: responseData
//   });
// }

// async function commandResponse(db, command) {
//   switch (command) {
//     case "ping":
//       return {
//         content: "🏓 Pong! Cloudflare Worker is online and processing sales."
//       };

//     case "latest": {
//       const row = await db.prepare(`
//         SELECT buyer, item_name, amount, created, asset_id
//         FROM sales
//         ORDER BY created DESC
//         LIMIT 1
//       `).first();

//       return row
//         ? { embeds: [saleEmbed(row, "🛒 Latest Sale")] }
//         : { content: "No sales have been recorded yet." };
//     }

//     case "today":
//       return { embeds: [await periodEmbed(db, "today", "📊 Today's Sales")] };

//     case "hourly":
//       return { embeds: [await periodEmbed(db, "hourly", "📊 Last Hour")] };

//     case "weekly":
//       return { embeds: [await periodEmbed(db, "weekly", "📊 Weekly Sales")] };

//     case "summary":
//       return { embeds: [await periodEmbed(db, "latest", "📊 Sales Summary")] };

//     default:
//       return { content: `Unknown command: ${command}` };
//   }
// }

// async function periodEmbed(db, period, title) {
//   let where = "";
//   let previousWhere = "";

//   if (period === "hourly") {
//     where = "created >= datetime('now', '-1 hour')";
//   } else if (period === "today") {
//     where = "date(created, '+05:45') = date('now', '+05:45')";
//   } else if (period === "weekly") {
//     where = "created >= datetime('now', '-7 days')";
//     previousWhere =
//       "created >= datetime('now', '-14 days') AND created < datetime('now', '-7 days')";
//   } else if (period === "latest") {
//     where = "1 = 1";
//   }

//   const stats = await db.prepare(`
//     SELECT
//       COALESCE(SUM(amount), 0) AS total,
//       COUNT(*) AS count
//     FROM sales
//     WHERE ${where}
//   `).first();

//   const top = await db.prepare(`
//     SELECT item_name, COUNT(*) AS count, SUM(amount) AS total
//     FROM sales
//     WHERE ${where}
//     GROUP BY item_name
//     ORDER BY count DESC, total DESC
//     LIMIT 1
//   `).first();

//   const latest = await db.prepare(`
//     SELECT buyer, item_name, amount, created
//     FROM sales
//     WHERE ${where}
//     ORDER BY created DESC
//     LIMIT 10
//   `).all();

//   let description =
//     `**Total Earnings:** 💰 **${Number(stats?.total || 0).toLocaleString()} Robux**\n` +
//     `**Total Sales:** 🧾 **${Number(stats?.count || 0)}**\n` +
//     `**Top Item:** ${top ? `${top.item_name} (${top.count} sold)` : "N/A"}\n`;

//   if (previousWhere) {
//     const previous = await db.prepare(`
//       SELECT COALESCE(SUM(amount), 0) AS total
//       FROM sales
//       WHERE ${previousWhere}
//     `).first();

//     const currentTotal = Number(stats?.total || 0);
//     const previousTotal = Number(previous?.total || 0);

//     if (previousTotal > 0) {
//       const change = ((currentTotal - previousTotal) / previousTotal) * 100;
//       description += `**vs previous 7 days:** ${change >= 0 ? "📈 +" : "📉 "}${change.toFixed(1)}%\n`;
//     }
//   }

//   description += "\n**Latest Sales:**\n";

//   for (const sale of latest.results) {
//     description +=
//       `${formatNPT(sale.created, true)} — ${sale.buyer} — ` +
//       `${sale.item_name} — ${sale.amount} Robux\n`;
//   }

//   if (!latest.results.length) {
//     description += "No sales.";
//   }

//   return {
//     title,
//     description: description.slice(0, 3900),
//     color: 0x0099ff,
//     timestamp: new Date().toISOString()
//   };
// }

// async function getStats(db, period) {
//   if (!["today", "hourly", "weekly"].includes(period)) {
//     period = "today";
//   }

//   let where;

//   if (period === "hourly") {
//     where = "created >= datetime('now', '-1 hour')";
//   } else if (period === "weekly") {
//     where = "created >= datetime('now', '-7 days')";
//   } else {
//     where = "date(created, '+05:45') = date('now', '+05:45')";
//   }

//   const stats = await db.prepare(`
//     SELECT
//       COALESCE(SUM(amount), 0) AS total,
//       COUNT(*) AS count
//     FROM sales
//     WHERE ${where}
//   `).first();

//   const top = await db.prepare(`
//     SELECT item_name, COUNT(*) AS count
//     FROM sales
//     WHERE ${where}
//     GROUP BY item_name
//     ORDER BY count DESC
//     LIMIT 1
//   `).first();

//   return {
//     period,
//     total: Number(stats?.total || 0),
//     count: Number(stats?.count || 0),
//     topItem: top?.item_name ?? null
//   };
// }

// function saleEmbed(row, title) {
//   const embed = {
//     title,
//     description:
//       `Buyer: **${row.buyer}**\n` +
//       `Item: **${row.item_name}**\n` +
//       `Amount: **${row.amount} Robux**\n` +
//       `Time: ${formatNPT(row.created)}`,
//     color: 0x0099ff
//   };

//   if (row.asset_id) {
//     embed.thumbnail = {
//       url:
//         `https://www.roblox.com/asset-thumbnail/image?` +
//         `assetId=${encodeURIComponent(row.asset_id)}&width=420&height=420&format=png`
//     };
//   }

//   return embed;
// }

// function formatNPT(value, short = false) {
//   const date = new Date(value);
//   return new Intl.DateTimeFormat("en-GB", {
//     timeZone: "Asia/Kathmandu",
//     year: short ? undefined : "numeric",
//     month: short ? undefined : "2-digit",
//     day: short ? undefined : "2-digit",
//     hour: "2-digit",
//     minute: "2-digit",
//     second: short ? undefined : "2-digit",
//     hour12: false
//   }).format(date) + " NPT";
// }

// async function verifyDiscordSignature(request, body, publicKeyHex) {
//   const signatureHex = request.headers.get("X-Signature-Ed25519");
//   const timestamp = request.headers.get("X-Signature-Timestamp");

//   if (!signatureHex || !timestamp || !publicKeyHex) return false;

//   try {
//     const publicKey = await crypto.subtle.importKey(
//       "raw",
//       hexToBytes(publicKeyHex),
//       { name: "Ed25519" },
//       false,
//       ["verify"]
//     );

//     return await crypto.subtle.verify(
//       "Ed25519",
//       publicKey,
//       hexToBytes(signatureHex),
//       new TextEncoder().encode(timestamp + body)
//     );
//   } catch {
//     return false;
//   }
// }

// function hexToBytes(hex) {
//   if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
//     throw new Error("Invalid hex");
//   }

//   const bytes = new Uint8Array(hex.length / 2);

//   for (let i = 0; i < bytes.length; i++) {
//     bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
//   }

//   return bytes;
// }

// function renderDashboard() {
//   return `<!doctype html>
// <html lang="en">
// <head>
// <meta charset="utf-8">
// <meta name="viewport" content="width=device-width,initial-scale=1">
// <title>Roblox Sales Monitor</title>
// <style>
// body{font-family:system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;background:#0f172a;color:#e2e8f0}
// .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
// .card{background:#1e293b;padding:20px;border-radius:16px}
// .value{font-size:28px;font-weight:700;margin-top:8px}
// table{width:100%;margin-top:24px;border-collapse:collapse;background:#1e293b;border-radius:16px;overflow:hidden}
// th,td{text-align:left;padding:12px;border-bottom:1px solid #334155}
// small{color:#94a3b8}
// @media(max-width:700px){.grid{grid-template-columns:1fr}}
// </style>
// </head>
// <body>
// <h1>Roblox Sales Monitor</h1>
// <p><small>Cloudflare Workers + Queues + D1</small></p>
// <div class="grid">
//   <div class="card"><small>Today's earnings</small><div class="value" id="total">—</div></div>
//   <div class="card"><small>Today's sales</small><div class="value" id="count">—</div></div>
//   <div class="card"><small>Top item</small><div class="value" id="top">—</div></div>
// </div>
// <table>
// <thead><tr><th>Time</th><th>Buyer</th><th>Item</th><th>Amount</th></tr></thead>
// <tbody id="sales"><tr><td colspan="4">Loading...</td></tr></tbody>
// </table>
// <script>
// async function load(){
//   const stats = await fetch('/api/stats?period=today').then(r=>r.json());
//   document.getElementById('total').textContent =
//     Number(stats.total).toLocaleString() + ' Robux';
//   document.getElementById('count').textContent = stats.count;
//   document.getElementById('top').textContent = stats.topItem || 'N/A';

//   const sales = await fetch('/api/sales?limit=20').then(r=>r.json());
//   document.getElementById('sales').innerHTML = sales.map(s =>
//     '<tr><td>' + new Date(s.created).toLocaleString() +
//     '</td><td>' + escapeHtml(s.buyer) +
//     '</td><td>' + escapeHtml(s.item_name) +
//     '</td><td>' + Number(s.amount).toLocaleString() +
//     ' Robux</td></tr>'
//   ).join('') || '<tr><td colspan="4">No sales yet.</td></tr>';
// }
// function escapeHtml(value){
//   return String(value).replace(/[&<>"']/g, c =>
//     ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
//   );
// }
// load();
// setInterval(load, 60000);
// </script>
// </body>
// </html>`;
// }


const NPT_TIME_ZONE = "Asia/Kathmandu";
const BIG_SALE_THRESHOLD = 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(renderDashboard(), {
        headers: {
          "content-type": "text/html; charset=UTF-8"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "sales-processor"
      });
    }

    if (request.method === "GET" && url.pathname === "/api/sales") {
      return handleSalesApi(url, env.DB);
    }

    if (request.method === "GET" && url.pathname === "/api/stats") {
      return handleStatsApi(url, env.DB);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/discord/interactions"
    ) {
      return handleDiscordInteraction(request, env);
    }

    return new Response("Not Found", {
      status: 404
    });
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      await processSale(env, message.body);
    }
  }
};

async function handleSalesApi(url, db) {
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") || 50), 1),
    100
  );

  const { where, bindings } = buildDateRangeWhere(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );

  const query = `
    SELECT
      purchase_token,
      buyer,
      item_name,
      asset_id,
      amount,
      created
    FROM sales
    ${where}
    ORDER BY datetime(created) DESC
    LIMIT ?
  `;

  const result = await db
    .prepare(query)
    .bind(...bindings, limit)
    .all();

  return Response.json(result.results);
}

async function handleStatsApi(url, db) {
  const { where, bindings } = buildDateRangeWhere(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );

  const stats = await db
    .prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS total,
        COUNT(*) AS count
      FROM sales
      ${where}
    `)
    .bind(...bindings)
    .first();

  const top = await db
    .prepare(`
      SELECT
        item_name,
        COUNT(*) AS count,
        COALESCE(SUM(amount), 0) AS total
      FROM sales
      ${where}
      GROUP BY item_name
      ORDER BY count DESC, total DESC
      LIMIT 1
    `)
    .bind(...bindings)
    .first();

  return Response.json({
    total: Number(stats?.total || 0),
    count: Number(stats?.count || 0),
    topItem: top?.item_name ?? null,
    topItemSales: Number(top?.count || 0),
    topItemEarnings: Number(top?.total || 0)
  });
}

function buildDateRangeWhere(from, to) {
  const conditions = [];
  const bindings = [];

  if (from && isValidDateString(from)) {
    conditions.push("datetime(created) >= datetime(?)");
    bindings.push(`${from}T00:00:00.000Z`);
  }

  if (to && isValidDateString(to)) {
    conditions.push("datetime(created) < datetime(?)");
    bindings.push(`${addOneDay(to)}T00:00:00.000Z`);
  }

  if (!conditions.length) {
    return {
      where: "",
      bindings
    };
  }

  return {
    where: `WHERE ${conditions.join(" AND ")}`,
    bindings
  };
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addOneDay(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);

  return date.toISOString().slice(0, 10);
}

async function processSale(env, sale) {
  const insert = await env.DB.prepare(`
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

  // Historical backfill sales should be stored,
  // but should not spam Discord notifications.
  if (sale.historical) {
    console.log(
      `Stored historical sale ${sale.purchaseToken}; inserted=${insert.meta?.changes ?? 0
      }`
    );

    return;
  }

  const row = await env.DB.prepare(`
    SELECT notified_at
    FROM sales
    WHERE purchase_token = ?
  `)
    .bind(sale.purchaseToken)
    .first();

  if (!row || row.notified_at) {
    return;
  }

  await sendDiscordSaleNotification(env, sale);

  await env.DB.prepare(`
    UPDATE sales
    SET notified_at = ?
    WHERE purchase_token = ?
  `)
    .bind(
      new Date().toISOString(),
      sale.purchaseToken
    )
    .run();

  console.log(
    `Processed sale ${sale.purchaseToken}; inserted=${insert.meta?.changes ?? 0
    }`
  );
}

async function sendDiscordSaleNotification(env, sale) {
  const isBig = sale.amount >= BIG_SALE_THRESHOLD;

  const content = isBig
    ? `🚨 BIG SALE! <@${env.DISCORD_MENTION_USER_ID}> Sold **${sale.itemName}** for **${sale.amount} Robux**`
    : `NEW SALE 🎉 Sold **${sale.itemName}** for **${sale.amount} Robux**`;

  const embed = {
    title: isBig
      ? "🚨 BIG SALE!"
      : "🛒 New Group Sale",

    description:
      `Buyer: **${sale.buyer}**\n` +
      `Item: **${sale.itemName}**\n` +
      `Amount: **${sale.amount} Robux**\n` +
      `Time: ${formatNPT(sale.created)}`,

    color: isBig
      ? 0xffd700
      : 0x00ff00,

    timestamp: new Date().toISOString()
  };

  if (sale.assetId) {
    embed.thumbnail = {
      url:
        `https://www.roblox.com/asset-thumbnail/image?` +
        `assetId=${encodeURIComponent(
          sale.assetId
        )}&width=420&height=420&format=png`
    };
  }

  const response = await fetch(
    `${env.DISCORD_WEBHOOK_URL}?wait=true`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        content,
        embeds: [embed],
        allowed_mentions:
          env.DISCORD_MENTION_USER_ID
            ? {
              users: [
                env.DISCORD_MENTION_USER_ID
              ]
            }
            : {
              parse: []
            }
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Discord webhook returned ${response.status}`
    );
  }
}

async function handleDiscordInteraction(request, env) {
  const body = await request.text();

  const verified = await verifyDiscordSignature(
    request,
    body,
    env.DISCORD_PUBLIC_KEY
  );

  if (!verified) {
    return new Response(
      "invalid request signature",
      { status: 401 }
    );
  }

  const interaction = JSON.parse(body);

  if (interaction.type === 1) {
    return Response.json({
      type: 1
    });
  }

  if (interaction.type !== 2) {
    return Response.json({
      type: 4,
      data: {
        content: "Unsupported interaction."
      }
    });
  }

  const command = interaction.data?.name;

  const responseData = await commandResponse(
    env.DB,
    command
  );

  return Response.json({
    type: 4,
    data: responseData
  });
}

async function commandResponse(db, command) {
  switch (command) {
    case "ping":
      return {
        content:
          "🏓 Pong! Cloudflare Worker is online and processing sales."
      };

    case "latest": {
      const row = await db.prepare(`
        SELECT
          buyer,
          item_name,
          amount,
          created,
          asset_id
        FROM sales
        ORDER BY datetime(created) DESC
        LIMIT 1
      `).first();

      return row
        ? {
          embeds: [
            saleEmbed(
              row,
              "🛒 Latest Sale"
            )
          ]
        }
        : {
          content:
            "No sales have been recorded yet."
        };
    }

    case "today":
      return {
        embeds: [
          await periodEmbed(
            db,
            "today",
            "📊 Today's Sales"
          )
        ]
      };

    case "hourly":
      return {
        embeds: [
          await periodEmbed(
            db,
            "hourly",
            "📊 Last Hour"
          )
        ]
      };

    case "weekly":
      return {
        embeds: [
          await periodEmbed(
            db,
            "weekly",
            "📊 Weekly Sales"
          )
        ]
      };

    case "summary":
      return {
        embeds: [
          await periodEmbed(
            db,
            "latest",
            "📊 Sales Summary"
          )
        ]
      };

    default:
      return {
        content:
          `Unknown command: ${command}`
      };
  }
}

async function periodEmbed(db, period, title) {
  let where = "";
  let previousWhere = "";

  if (period === "hourly") {
    where =
      "WHERE datetime(created) >= datetime('now', '-1 hour')";
  }

  if (period === "today") {
    where = `
      WHERE date(
        datetime(created),
        '+05:45'
      ) = date(
        datetime('now'),
        '+05:45'
      )
    `;
  }

  if (period === "weekly") {
    where =
      "WHERE datetime(created) >= datetime('now', '-7 days')";

    previousWhere =
      "WHERE datetime(created) >= datetime('now', '-14 days') AND datetime(created) < datetime('now', '-7 days')";
  }

  if (period === "latest") {
    where = "";
  }

  const stats = await db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS total,
      COUNT(*) AS count
    FROM sales
    ${where}
  `).first();

  const top = await db.prepare(`
    SELECT
      item_name,
      COUNT(*) AS count,
      SUM(amount) AS total
    FROM sales
    ${where}
    GROUP BY item_name
    ORDER BY count DESC, total DESC
    LIMIT 1
  `).first();

  const latest = await db.prepare(`
    SELECT
      buyer,
      item_name,
      amount,
      created
    FROM sales
    ${where}
    ORDER BY datetime(created) DESC
    LIMIT 10
  `).all();

  let description =
    `**Total Earnings:** 💰 **${Number(
      stats?.total || 0
    ).toLocaleString()} Robux**\n` +

    `**Total Sales:** 🧾 **${Number(
      stats?.count || 0
    )}**\n` +

    `**Top Item:** ${top
      ? `${top.item_name} (${top.count} sold)`
      : "N/A"
    }\n`;

  if (previousWhere) {
    const previous = await db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS total
      FROM sales
      ${previousWhere}
    `).first();

    const currentTotal =
      Number(stats?.total || 0);

    const previousTotal =
      Number(previous?.total || 0);

    if (previousTotal > 0) {
      const change =
        (
          (currentTotal - previousTotal) /
          previousTotal
        ) * 100;

      description +=
        `**vs previous 7 days:** ${change >= 0
          ? "📈 +"
          : "📉 "
        }${change.toFixed(1)}%\n`;
    }
  }

  description += "\n**Latest Sales:**\n";

  for (const sale of latest.results) {
    description +=
      `${formatNPT(
        sale.created,
        true
      )} — ${sale.buyer} — ` +

      `${sale.item_name} — ` +
      `${sale.amount} Robux\n`;
  }

  if (!latest.results.length) {
    description += "No sales.";
  }

  return {
    title,
    description:
      description.slice(0, 3900),
    color: 0x0099ff,
    timestamp:
      new Date().toISOString()
  };
}

function saleEmbed(row, title) {
  const embed = {
    title,

    description:
      `Buyer: **${row.buyer}**\n` +
      `Item: **${row.item_name}**\n` +
      `Amount: **${row.amount} Robux**\n` +
      `Time: ${formatNPT(row.created)}`,

    color: 0x0099ff
  };

  if (row.asset_id) {
    embed.thumbnail = {
      url:
        `https://www.roblox.com/asset-thumbnail/image?` +
        `assetId=${encodeURIComponent(
          row.asset_id
        )}&width=420&height=420&format=png`
    };
  }

  return embed;
}

function formatNPT(value, short = false) {
  const date = new Date(value);

  return (
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: NPT_TIME_ZONE,
        year: short
          ? undefined
          : "numeric",
        month: short
          ? undefined
          : "2-digit",
        day: short
          ? undefined
          : "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: short
          ? undefined
          : "2-digit",
        hour12: false
      }
    ).format(date) + " NPT"
  );
}

async function verifyDiscordSignature(
  request,
  body,
  publicKeyHex
) {
  const signatureHex =
    request.headers.get(
      "X-Signature-Ed25519"
    );

  const timestamp =
    request.headers.get(
      "X-Signature-Timestamp"
    );

  if (
    !signatureHex ||
    !timestamp ||
    !publicKeyHex
  ) {
    return false;
  }

  try {
    const publicKey =
      await crypto.subtle.importKey(
        "raw",
        hexToBytes(publicKeyHex),
        {
          name: "Ed25519"
        },
        false,
        ["verify"]
      );

    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      hexToBytes(signatureHex),
      new TextEncoder().encode(
        timestamp + body
      )
    );
  } catch {
    return false;
  }
}

function hexToBytes(hex) {
  if (
    !/^[0-9a-f]+$/i.test(hex) ||
    hex.length % 2 !== 0
  ) {
    throw new Error("Invalid hex");
  }

  const bytes =
    new Uint8Array(hex.length / 2);

  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {
    bytes[i] = Number.parseInt(
      hex.slice(
        i * 2,
        i * 2 + 2
      ),
      16
    );
  }

  return bytes;
}

function renderDashboard() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>
<title>Roblox Sales Monitor</title>

<style>
*{
  box-sizing:border-box;
}

body{
  margin:0;
  font-family:
    Inter,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  background:#0f172a;
  color:#e2e8f0;
}

.container{
  max-width:1200px;
  margin:0 auto;
  padding:32px 20px;
}

h1{
  margin:0;
  font-size:32px;
}

.subtitle{
  color:#94a3b8;
  margin-top:6px;
}

.filters{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  align-items:end;
  margin:28px 0;
  padding:18px;
  background:#1e293b;
  border-radius:16px;
}

.filter-group{
  display:flex;
  flex-direction:column;
  gap:6px;
}

label{
  color:#94a3b8;
  font-size:13px;
}

input,
select,
button{
  font:inherit;
}

input,
select{
  background:#0f172a;
  color:#e2e8f0;
  border:1px solid #334155;
  padding:10px 12px;
  border-radius:8px;
}

button{
  border:0;
  border-radius:8px;
  padding:10px 16px;
  cursor:pointer;
  font-weight:600;
  background:#38bdf8;
  color:#082f49;
}

button:hover{
  opacity:.9;
}

.secondary{
  background:#334155;
  color:#e2e8f0;
}

.grid{
  display:grid;
  grid-template-columns:
    repeat(3,minmax(0,1fr));
  gap:16px;
}

.card{
  background:#1e293b;
  padding:20px;
  border-radius:16px;
}

.card small{
  color:#94a3b8;
}

.value{
  font-size:28px;
  font-weight:700;
  margin-top:8px;
  word-break:break-word;
}

.table-wrapper{
  overflow-x:auto;
  margin-top:24px;
  border-radius:16px;
  background:#1e293b;
}

table{
  width:100%;
  border-collapse:collapse;
  min-width:700px;
}

th,
td{
  text-align:left;
  padding:14px;
  border-bottom:
    1px solid #334155;
}

th{
  color:#94a3b8;
  font-size:13px;
}

.status{
  color:#94a3b8;
  margin-top:14px;
}

@media(max-width:700px){
  .grid{
    grid-template-columns:1fr;
  }

  .filters{
    flex-direction:column;
    align-items:stretch;
  }

  .filter-group{
    width:100%;
  }
}
</style>
</head>

<body>
<div class="container">

  <h1>Roblox Sales Monitor</h1>

  <p class="subtitle">
    Cloudflare Workers + Queues + D1
  </p>

  <div class="filters">

    <div class="filter-group">
      <label for="preset">
        Quick Range
      </label>

      <select id="preset">
        <option value="today">
          Today
        </option>

        <option value="7days">
          Last 7 Days
        </option>

        <option value="thisMonth">
          This Month
        </option>

        <option value="lastMonth">
          Last Month
        </option>

        <option value="all">
          All Time
        </option>

        <option value="custom">
          Custom Range
        </option>
      </select>
    </div>

    <div class="filter-group">
      <label for="from">
        From
      </label>

      <input
        id="from"
        type="date"
      >
    </div>

    <div class="filter-group">
      <label for="to">
        To
      </label>

      <input
        id="to"
        type="date"
      >
    </div>

    <button id="apply">
      Apply Range
    </button>

    <button
      id="reset"
      class="secondary"
    >
      Reset
    </button>

  </div>

  <div class="grid">

    <div class="card">
      <small>Total Earnings</small>

      <div
        class="value"
        id="total"
      >
        —
      </div>
    </div>

    <div class="card">
      <small>Total Sales</small>

      <div
        class="value"
        id="count"
      >
        —
      </div>
    </div>

    <div class="card">
      <small>Top Item</small>

      <div
        class="value"
        id="top"
      >
        —
      </div>
    </div>

  </div>

  <div class="status" id="status">
    Loading sales...
  </div>

  <div class="table-wrapper">

    <table>
      <thead>
        <tr>
          <th>Time (NPT)</th>
          <th>Buyer</th>
          <th>Item</th>
          <th>Amount</th>
        </tr>
      </thead>

      <tbody id="sales">
        <tr>
          <td colspan="4">
            Loading...
          </td>
        </tr>
      </tbody>
    </table>

  </div>

</div>

<script>
const preset =
  document.getElementById("preset");

const fromInput =
  document.getElementById("from");

const toInput =
  document.getElementById("to");

const applyButton =
  document.getElementById("apply");

const resetButton =
  document.getElementById("reset");

const status =
  document.getElementById("status");

function pad(value){
  return String(value).padStart(2,"0");
}

function formatDateInput(date){
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth()+1) +
    "-" +
    pad(date.getDate())
  );
}

function getToday(){
  return formatDateInput(new Date());
}

function getPresetRange(value){
  const now = new Date();

  if(value === "today"){
    const today = getToday();

    return {
      from:today,
      to:today
    };
  }

  if(value === "7days"){
    const from = new Date();

    from.setDate(
      now.getDate()-6
    );

    return {
      from:formatDateInput(from),
      to:formatDateInput(now)
    };
  }

  if(value === "thisMonth"){
    const from =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        1
      );

    return {
      from:formatDateInput(from),
      to:formatDateInput(now)
    };
  }

  if(value === "lastMonth"){
    const from =
      new Date(
        now.getFullYear(),
        now.getMonth()-1,
        1
      );

    const to =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        0
      );

    return {
      from:formatDateInput(from),
      to:formatDateInput(to)
    };
  }

  if(value === "all"){
    return {
      from:"",
      to:""
    };
  }

  return {
    from:fromInput.value,
    to:toInput.value
  };
}

function setRangeFromPreset(){
  const range =
    getPresetRange(preset.value);

  if(preset.value !== "custom"){
    fromInput.value = range.from;
    toInput.value = range.to;
  }
}

preset.addEventListener(
  "change",
  () => {
    setRangeFromPreset();

    if(
      preset.value !== "custom"
    ){
      load();
    }
  }
);

fromInput.addEventListener(
  "change",
  () => {
    preset.value = "custom";
  }
);

toInput.addEventListener(
  "change",
  () => {
    preset.value = "custom";
  }
);

applyButton.addEventListener(
  "click",
  () => {
    load();
  }
);

resetButton.addEventListener(
  "click",
  () => {
    preset.value = "today";

    setRangeFromPreset();

    load();
  }
);

function getQueryString(){
  const params =
    new URLSearchParams();

  if(fromInput.value){
    params.set(
      "from",
      fromInput.value
    );
  }

  if(toInput.value){
    params.set(
      "to",
      toInput.value
    );
  }

  return params.toString();
}

function updateBrowserUrl(){
  const params =
    new URLSearchParams();

  params.set(
    "preset",
    preset.value
  );

  if(fromInput.value){
    params.set(
      "from",
      fromInput.value
    );
  }

  if(toInput.value){
    params.set(
      "to",
      toInput.value
    );
  }

  history.replaceState(
    null,
    "",
    "?" + params.toString()
  );
}

function restoreRangeFromUrl(){
  const params =
    new URLSearchParams(
      window.location.search
    );

  const savedPreset =
    params.get("preset");

  const savedFrom =
    params.get("from");

  const savedTo =
    params.get("to");

  if(savedPreset){
    preset.value = savedPreset;
  }

  if(savedFrom){
    fromInput.value = savedFrom;
  }

  if(savedTo){
    toInput.value = savedTo;
  }

  if(
    !savedFrom &&
    !savedTo &&
    preset.value !== "custom"
  ){
    setRangeFromPreset();
  }
}

function escapeHtml(value){
  return String(value).replace(
    /[&<>"']/g,
    character =>
      ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#39;"
      }[character])
  );
}

function formatNPT(value){
  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:"Asia/Kathmandu",
      year:"numeric",
      month:"2-digit",
      day:"2-digit",
      hour:"2-digit",
      minute:"2-digit",
      second:"2-digit",
      hour12:false
    }
  ).format(
    new Date(value)
  );
}

async function load(){
  const query =
    getQueryString();

  updateBrowserUrl();

  status.textContent =
    "Loading sales...";

  try{
    const querySuffix =
      query
        ? "?" + query
        : "";

    const [
      statsResponse,
      salesResponse
    ] =
      await Promise.all([
        fetch(
          "/api/stats" +
          querySuffix
        ),

        fetch(
          "/api/sales?limit=100" +
          (
            query
              ? "&" + query
              : ""
          )
        )
      ]);

    if(
      !statsResponse.ok ||
      !salesResponse.ok
    ){
      throw new Error(
        "Failed to load data"
      );
    }

    const stats =
      await statsResponse.json();

    const sales =
      await salesResponse.json();

    document
      .getElementById("total")
      .textContent =
        Number(
          stats.total
        ).toLocaleString() +
        " Robux";

    document
      .getElementById("count")
      .textContent =
        Number(
          stats.count
        ).toLocaleString();

    document
      .getElementById("top")
      .textContent =
        stats.topItem ||
        "N/A";

    const tbody =
      document.getElementById(
        "sales"
      );

    if(!sales.length){
      tbody.innerHTML =
        '<tr><td colspan="4">' +
        'No sales found for this range.' +
        '</td></tr>';
    }else{
      tbody.innerHTML =
        sales.map(
          sale =>
            "<tr>" +

            "<td>" +
            formatNPT(
              sale.created
            ) +
            "</td>" +

            "<td>" +
            escapeHtml(
              sale.buyer
            ) +
            "</td>" +

            "<td>" +
            escapeHtml(
              sale.item_name
            ) +
            "</td>" +

            "<td>" +
            Number(
              sale.amount
            ).toLocaleString() +
            " Robux" +
            "</td>" +

            "</tr>"
        ).join("");
    }

    status.textContent =
      "Showing " +
      sales.length +
      " of " +
      Number(
        stats.count
      ).toLocaleString() +
      " sale(s).";
  }catch(error){
    console.error(error);

    status.textContent =
      "Failed to load sales.";

    document
      .getElementById("sales")
      .innerHTML =
        '<tr><td colspan="4">' +
        'Error loading sales.' +
        '</td></tr>';
  }
}

restoreRangeFromUrl();
load();

setInterval(
  load,
  60000
);
</script>

</body>
</html>`;
}