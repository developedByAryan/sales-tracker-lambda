const {
  DISCORD_APPLICATION_ID,
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID
} = process.env;

if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
  throw new Error(
    "Set DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID"
  );
}

const commands = [
  {
    name: "ping",
    description: "Check whether the serverless bot is online"
  },
  {
    name: "latest",
    description: "Show the most recent group sale"
  },
  {
    name: "today",
    description: "Show today's earnings and sales"
  },
  {
    name: "hourly",
    description: "Show the last hour's earnings and sales"
  },
  {
    name: "weekly",
    description: "Show the last seven days of sales"
  },
  {
    name: "summary",
    description: "Show a recent sales summary"
  }
];

const url =
  `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}` +
  `/guilds/${DISCORD_GUILD_ID}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(commands)
});

if (!response.ok) {
  throw new Error(`${response.status}: ${await response.text()}`);
}

console.log("Registered commands:");
console.log(await response.json());
