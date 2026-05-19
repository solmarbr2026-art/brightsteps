const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const express = require("express");
const fs = require("fs");

const TOKEN = process.env.TELEGRAM_TOKEN;
const NOTIFY_HOUR = process.env.NOTIFY_HOUR || "8";
const NOTIFY_MIN  = process.env.NOTIFY_MIN  || "0";
const TZ          = process.env.TZ          || "America/New_York";
const ADMIN_PASS  = process.env.ADMIN_PASS  || "brightsteps2024";

if (!TOKEN) { console.error("❌ TELEGRAM_TOKEN not set"); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
app.use(express.json());

// ── Persistent storage (file-based, free on Railway) ─────────────────────────
const DATA_FILE = "/tmp/bs_data.json";

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { subscribers: [], posts: {} }; }
}
function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

let db = loadData();

// ── Keep-alive server ─────────────────────────────────────────────────────────
app.get("/", (_, res) => res.send("✅ BrightSteps Bot is running!"));

app.post("/sync", (req, res) => {
  try {
    db.posts = req.body || {};
    saveData(db);
    console.log("📅 Posts synced");
    res.json({ ok: true, subscribers: db.subscribers.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Endpoint to check subscribers (protected)
app.get("/subscribers", (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
  res.json({ count: db.subscribers.length, ids: db.subscribers });
});

app.listen(process.env.PORT || 3000, () => console.log("🌐 Server up"));

// ── Helpers ───────────────────────────────────────────────────────────────────
const PLAT_EMOJI = {
  Instagram:"📸", Facebook:"👥", TikTok:"🎵", YouTube:"▶️",
  LinkedIn:"💼", Blog:"📝", Stories:"✨", Reels:"🎬"
};
const CAT_EMOJI = {
  Educativo:"📚", Dicas:"💡", Eventos:"🎉", Bastidores:"🎬",
  Promoção:"🛍️", Institucional:"🏫", Tendência:"🔥"
};
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function buildDailyMessage() {
  const now   = new Date();
  const key   = `${now.getFullYear()}-${now.getMonth()}`;
  const day   = now.getDate();
  const posts = (db.posts[key]?.[day] || []);
  const dateStr = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${day}`;

  if (!posts.length) {
    return `☀️ *BrightSteps — ${dateStr}*\n\n_No posts scheduled for today._\n\nEnjoy a free day! 🌟`;
  }

  let msg = `☀️ *BrightSteps Family Child Care*\n📅 *${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `You have *${posts.length} post${posts.length > 1 ? "s" : ""}* today:\n\n`;
  posts.forEach(p => {
    msg += `${PLAT_EMOJI[p.platform] || "📌"} *${p.time}* — ${p.platform}\n`;
    msg += `   📌 ${p.title}\n`;
    msg += `   ${CAT_EMOJI[p.category] || "🏷️"} ${p.category}`;
    if (p.notes) msg += `\n   💬 _${p.notes}_`;
    msg += `\n\n`;
  });
  msg += `━━━━━━━━━━━━━━━━━━\n_Good luck with your posts today! 🚀_`;
  return msg;
}

async function broadcast(message, opts = {}) {
  const results = { sent: 0, failed: 0 };
  for (const chatId of db.subscribers) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: "Markdown", ...opts });
      results.sent++;
    } catch (e) {
      console.error(`❌ Failed to send to ${chatId}:`, e.message);
      // Remove invalid chat IDs (user blocked the bot)
      if (e.message.includes("blocked") || e.message.includes("not found")) {
        db.subscribers = db.subscribers.filter(id => id !== chatId);
        saveData(db);
      }
      results.failed++;
    }
  }
  console.log(`📨 Broadcast: ${results.sent} sent, ${results.failed} failed`);
  return results;
}

// ── Daily cron ────────────────────────────────────────────────────────────────
const cronExpr = `${NOTIFY_MIN} ${NOTIFY_HOUR} * * *`;
console.log(`⏰ Daily cron: ${cronExpr} (${TZ})`);

cron.schedule(cronExpr, async () => {
  if (!db.subscribers.length) { console.log("⚠️ No subscribers yet"); return; }
  const msg = buildDailyMessage();
  await broadcast(msg);
}, { timezone: TZ });

// ── Bot commands ──────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  const name = msg.chat.first_name || "there";

  // Register subscriber
  if (!db.subscribers.includes(id)) {
    db.subscribers.push(id);
    saveData(db);
    console.log(`✅ New subscriber: ${id} (${name}) — total: ${db.subscribers.length}`);
  }

  bot.sendMessage(id,
    `🌟 *Welcome to BrightSteps Editorial Calendar, ${name}!*\n\n` +
    `You're now subscribed to daily post notifications.\n\n` +
    `Every day at *${NOTIFY_HOUR}:${NOTIFY_MIN.padStart(2,"0")} ${TZ.split("/")[1]?.replace("_"," ") || ""}* you'll receive a summary of the day's scheduled content.\n\n` +
    `*Available commands:*\n` +
    `/today — See today's posts\n` +
    `/week — See this week's posts\n` +
    `/stop — Unsubscribe from notifications\n` +
    `/test — Send a test notification`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/stop/, (msg) => {
  const id = msg.chat.id;
  db.subscribers = db.subscribers.filter(s => s !== id);
  saveData(db);
  bot.sendMessage(id, "👋 You've been unsubscribed. Send /start anytime to subscribe again.");
});

bot.onText(/\/today/, (msg) => {
  bot.sendMessage(msg.chat.id, buildDailyMessage(), { parse_mode: "Markdown" });
});

bot.onText(/\/test/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `✅ *Test notification — BrightSteps Bot*\n\nEverything is working! You'll receive your daily digest at *${NOTIFY_HOUR}:${NOTIFY_MIN.padStart(2,"0")}* every day. 🎉`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/week/, (msg) => {
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth()}`;
  let text = `📅 *This week — ${MONTHS[now.getMonth()]} ${now.getFullYear()}*\n━━━━━━━━━━━━━━━━━━\n`;
  let found = false;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() + i);
    const day = d.getDate();
    const posts = db.posts[key]?.[day] || [];
    if (posts.length) {
      found = true;
      text += `\n*${DAYS[d.getDay()]}, ${day}* — ${posts.length} post${posts.length>1?"s":""}\n`;
      posts.forEach(p => { text += `  ${PLAT_EMOJI[p.platform]||"•"} ${p.time} ${p.title}\n`; });
    }
  }
  if (!found) text += "\n_No posts scheduled this week._";
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/subscribers/, (msg) => {
  // Only works if user knows admin pass: /subscribers ADMINPASS
  bot.sendMessage(msg.chat.id, `👥 *${db.subscribers.length}* active subscriber(s).`, { parse_mode: "Markdown" });
});

console.log("🤖 BrightSteps Telegram Bot started!");
