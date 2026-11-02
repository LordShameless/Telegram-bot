const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// --- Redis-backed state helpers ---

const REDIS_PREFIX = "bot:";

async function rGet(key) {
  const { getRedis } = require("./lib/store");
  const redis = getRedis();
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function rSet(key, value, ttlSeconds = null) {
  const { getRedis } = require("./lib/store");
  const redis = getRedis();
  const str = JSON.stringify(value);
  if (ttlSeconds) {
    return redis.setex(key, ttlSeconds, str);
  }
  return redis.set(key, str);
}

async function rDel(key) {
  const { getRedis } = require("./lib/store");
  const redis = getRedis();
  return redis.del(key);
}

// --- Helpers ---

function getChatId(update) {
  return update.message?.chat?.id;
}

function getUserId(update) {
  return update.message?.from?.id;
}

function getUsername(update) {
  return update.message?.from?.username || "unknown";
}

function isAdmin(update) {
  const adminUsernames = (process.env.ADMIN_USERS || "TheDevilOfAntarctica").split(",");
  return adminUsernames.includes(getUsername(update));
}

async function sendMessage(chatId, text, parseMode = "HTML", replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const resp = await axios.post(`${API_BASE}/sendMessage`, body);
  return resp.data;
}

async function editMessageText(chatId, messageId, text, replyMarkup = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await axios.post(`${API_BASE}/editMessageText`, body);
}

async function answerCallbackQuery(callbackQueryId, text = null) {
  const body = { callback_query_id: callbackQueryId };
  if (text) body.text = text;
  await axios.post(`${API_BASE}/answerCallbackQuery`, body);
}

function parseCommand(text) {
  if (!text || !text.startsWith("/")) return { command: "", args: [] };
  const parts = text.split(/\s+/);
  return { command: parts[0].toLowerCase(), args: parts.slice(1) };
}

function makeDoneKeyboard() {
  return { inline_keyboard: [[{ text: "✅ Done", callback_data: "done" }]] };
}

function makeRegisterKeyboard(queueName) {
  return {
    inline_keyboard: [[{ text: `📝 Register for ${queueName}`, callback_data: `reg:${queueName}` }]],
  };
}

function makeQueueSelectorKeyboard(queues) {
  const rows = queues.map(q => [{ text: `🚀 Start "${q}"`, callback_data: `start:${q}` }]);
  return { inline_keyboard: rows };
}

function userLink(userId, name) {
  return `<a href="tg://user?id=${userId}">${name}</a>`;
}

// --- Queue state management via Redis ---

async function getQueueState(queueName) {
  const key = `${REDIS_PREFIX}queue:${queueName}`;
  const state = await rGet(key);
  if (!state) {
    return { name: queueName, createdAt: Date.now(), enrolled: [], active: [], started: false, messageId: null };
  }
  return state;
}

async function saveQueueState(queueName, state) {
  const key = `${REDIS_PREFIX}queue:${queueName}`;
  await rSet(key, state);
}

async function deleteQueueFromRedis(queueName) {
  await rDel(`${REDIS_PREFIX}queue:${queueName}`);
}

async function getAllQueueNames() {
  const { getRedis } = require("./lib/store");
  const redis = getRedis();
  const keys = await redis.keys(`${REDIS_PREFIX}queue:*`);
  return keys.map(k => k.replace(`${REDIS_PREFIX}queue:`, ""));
}

// --- Daily picks ---

async function getDailyEligible() {
  const key = `${REDIS_PREFIX}daily:eligible`;
  const arr = await rGet(key);
  return arr || [];
}

async function addDailyEligible(userId) {
  const key = `${REDIS_PREFIX}daily:eligible`;
  const arr = await getDailyEligible();
  if (!arr.includes(userId)) {
    arr.push(userId);
    await rSet(key, arr);
  }
}

async function removeDailyEligible(userId) {
  const key = `${REDIS_PREFIX}daily:eligible`;
  const arr = await getDailyEligible();
  const filtered = arr.filter(id => id !== userId);
  await rSet(key, filtered);
}

async function isDailyEligible(userId) {
  return (await getDailyEligible()).includes(userId);
}

async function alreadyPickedToday(type) {
  const today = new Date().toISOString().split("T")[0];
  const key = `${REDIS_PREFIX}${type}:${today}`;
  const val = await rGet(key);
  return val !== null;
}

async function setPickedToday(type, userId) {
  const today = new Date().toISOString().split("T")[0];
  const key = `${REDIS_PREFIX}${type}:${today}`;
  await rSet(key, userId, 86400 * 3); // 3 days
}

// --- Webhook handler ---

app.post("/webhook", async (req, res) => {
  const update = req.body;

  try {
    if (update.callback_query) {
      const cb = update.callback_query;
      const msg = cb.message;
      const chatId = msg.chat.id;
      const messageId = msg.message_id;
      const data = cb.data;
      const userId = cb.from.id;

      await answerCallbackQuery(cb.id);

      if (data.startsWith("reg:")) {
        const queueName = data.slice(4);
        const state = await getQueueState(queueName);
        if (!state.enrolled.includes(userId)) {
          state.enrolled.push(userId);
          await saveQueueState(queueName, state);
        }
        await sendMessage(chatId, `✅ Registered for "<b>${queueName}</b>" queue!`, "HTML");
        if (state.started && state.active.length > 0) {
          await presentQueue(queueName, chatId, state);
        }
      } else if (data === "done") {
        const queueName = await getCurrentQueueName(chatId);
        if (queueName) {
          const state = await getQueueState(queueName);
          state.enrolled = state.enrolled.filter(id => id !== userId);
          state.active = state.active.filter(id => id !== userId);
          await popAndAppend(queueName, chatId);
          await saveQueueState(queueName, state);
          await presentQueue(queueName, chatId, await getQueueState(queueName));
        }
      } else if (data.startsWith("start:")) {
        const queueName = data.slice(6);
        const state = await getQueueState(queueName);
        state.started = true;
        await pickNextThree(queueName, chatId);
        await saveQueueState(queueName, state);
      }

      res.sendStatus(200);
      return;
    }

    if (update.message && update.message.text) {
      const chatId = getChatId(update);
      const userId = getUserId(update);
      const text = update.message.text;
      const { command, args } = parseCommand(text);

      // --- Daily picks commands ---

      if (command === "/pidor") {
        await handleDailyPick(chatId, "pidor");
      } else if (command === "/beauty") {
        await handleDailyPick(chatId, "beauty");
      } else if (command === "/daily_pidor") {
        if (!isAdmin(update)) {
          await sendMessage(chatId, "❌ Admin only.");
        } else {
          await handleDailyPick(chatId, "pidor");
        }
      } else if (command === "/daily_beauty") {
        if (!isAdmin(update)) {
          await sendMessage(chatId, "❌ Admin only.");
        } else {
          await handleDailyPick(chatId, "beauty");
        }
      } else if (command === "/enroll_daily") {
        await addDailyEligible(userId);
        await sendMessage(chatId, "✅ You're enrolled in daily picks!");
      } else if (command === "/unenroll_daily") {
        await removeDailyEligible(userId);
        await sendMessage(chatId, "✅ Removed from daily picks.");
      }

      // --- Queue commands ---

      else if (command === "/queue") {
        if (args.length === 0) {
          const queues = await getAllQueueNames();
          if (queues.length === 0) {
            await sendMessage(chatId, "No queues exist yet. Use /queue start <name> to create one.");
          } else {
            await sendMessage(
              chatId,
              `Existing queues:\n${queues.map((q, i) => `${i + 1}. ${q}`).join("\n")}\nUse /queue start <name> to start one.`,
              "HTML",
              makeQueueSelectorKeyboard(queues)
            );
          }
        } else if (args[0] === "start") {
          // /queue start <name>
          if (!args[1]) {
            await sendMessage(chatId, "Usage: /queue start <name>");
          } else {
            const queueName = args[1];
            const state = await getQueueState(queueName);
            state.started = true;
            await pickNextThree(queueName, chatId);
            await saveQueueState(queueName, state);
          }
        } else if (args[0] === "delete") {
          // /queue delete <name>
          if (!args[1]) {
            await sendMessage(chatId, "Usage: /queue delete <name>");
          } else {
            const queueName = args[1];
            await deleteQueueFromRedis(queueName);
            await sendMessage(chatId, `🗑️ Queue "${queueName}" deleted.`);
          }
        } else {
          // /queue <name> - create if not exists
          const queueName = args[0];
          const state = await getQueueState(queueName);
          if (!state.name) {
            state.name = queueName;
            await saveQueueState(queueName, state);
          }
          await sendMessage(
            chatId,
            `Queue "<b>${queueName}</b>" created/selected. Use the button below to register.`,
            "HTML",
            makeRegisterKeyboard(queueName)
          );
        }
      } else if (command === "/done") {
        const state = await getQueueState("default"); // fallback
        const queueName = state.name || "default";
        const q = await getQueueState(queueName);
        if (q.active.includes(userId)) {
          q.enrolled = q.enrolled.filter(id => id !== userId);
          q.active = q.active.filter(id => id !== userId);
          await popAndAppend(queueName, chatId);
          await saveQueueState(queueName, q);
          await presentQueue(queueName, chatId, await getQueueState(queueName));
        } else {
          await sendMessage(chatId, "You're not currently in the active queue.");
        }
      }
    }
  } catch (err) {
    console.error("Webhook error:", err);
    try {
      const chatId = update.message?.chat?.id;
      if (chatId) {
        await sendMessage(chatId, "❌ An error occurred. Please try again.");
      }
    } catch (_) {}
  }

  res.sendStatus(200);
});

async function handleDailyPick(chatId, type) {
  const today = new Date().toISOString().split("T")[0];
  const key = `${REDIS_PREFIX}${type}:${today}`;
  const existing = await rGet(key);
  if (existing) {
    await sendMessage(chatId, `${type} of the day was already picked today!`);
    return;
  }

  const eligible = await getDailyEligible();
  if (eligible.length === 0) {
    await sendMessage(chatId, `No one is enrolled for ${type} of the day yet.`);
    return;
  }

  // Suspense messages
  const suspense = [
    "Выясним, кто тут главный pidor 😏",
    "Проверим, все ли пишут тесты 🤔",
    "Смотрим наличие костылей в коде 🩼",
    "Ищем, у кого есть кружка Peder 🍺",
    "Изучаем фото с ЛГБТ-митингов 🌈",
  ];

  for (const msg of suspense) {
    await sendMessage(chatId, msg, "HTML");
    await new Promise(r => setTimeout(r, 1500));
  }

  const randomIdx = Math.floor(Math.random() * eligible.length);
  const chosen = eligible[randomIdx];
  await setPickedToday(type, chosen);

  const label = type === "pidor" ? "Pidor" : "Beauty";
  await sendMessage(
    chatId,
    `${label} of the day: ${userLink(chosen, chosen.toString())}`,
    "HTML"
  );
}

async function getCurrentQueueName(chatId) {
  const state = await rGet(`${REDIS_PREFIX}active_queue:${chatId}`);
  return state ? state.queueName : null;
}

async function setCurrentQueueName(chatId, queueName) {
  await rSet(`${REDIS_PREFIX}active_queue:${chatId}`, { queueName }, 86400 * 7);
}

async function pickNextThree(queueName, chatId) {
  const state = await getQueueState(queueName);
  const eligible = state.enrolled.filter(id => !state.active.includes(id));

  if (eligible.length < 3) {
    await sendMessage(chatId, `⚠️ Need at least 3 enrolled users for "${queueName}". Only ${eligible.length} registered.`);
    return;
  }

  const shuffled = eligible.sort(() => 0.5 - Math.random());
  const three = shuffled.slice(0, 3);
  state.active = three;
  await saveQueueState(queueName, state);
  await presentQueue(queueName, chatId, state);
}

async function popAndAppend(queueName, chatId) {
  const state = await getQueueState(queueName);
  if (state.active.length === 0) return;

  // Pop first
  state.active.shift();

  // Append new random if available
  const enrolled = state.enrolled.filter(id => !state.active.includes(id));
  if (enrolled.length > 0) {
    const random = enrolled[Math.floor(Math.random() * enrolled.length)];
    state.active.push(random);
  }

  await saveQueueState(queueName, state);
}

async function presentQueue(queueName, chatId, state) {
  const active = state.active;
  if (!active || active.length === 0) {
    await sendMessage(chatId, `Queue "${queueName}" is empty or finished.`);
    return;
  }

  const text = `
<b>Queue: ${queueName}</b>
Current presenters:
${active.map((uid, i) => `${i + 1}. ${userLink(uid, uid.toString())}`).join("\n")}
  `.trim();

  if (state.messageId) {
    try {
      await editMessageText(chatId, state.messageId, text, makeDoneKeyboard());
    } catch (_) {
      const msg = await sendMessage(chatId, text, "HTML", makeDoneKeyboard());
      state.messageId = msg.message_id;
      await saveQueueState(queueName, state);
    }
  } else {
    const msg = await sendMessage(chatId, text, "HTML", makeDoneKeyboard());
    state.messageId = msg.message_id;
    await saveQueueState(queueName, state);
  }
}

// Auto-delete: queues older than 48h that were never started
async function cleanupOldQueues() {
  const queues = await getAllQueueNames();
  const now = Date.now();
  const twoDays = 48 * 60 * 60 * 1000;
  for (const q of queues) {
    const state = await getQueueState(q);
    if (!state.started && now - state.createdAt > twoDays) {
      await deleteQueueFromRedis(q);
    }
  }
}

// Root route
app.get("/", (req, res) => res.send("Bot is running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot listening on port ${PORT}`);
});

module.exports = app;