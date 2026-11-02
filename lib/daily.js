const { getDailyEligible } = require("./store");
const redis = require("redis"); // Use the redis client instance

// Helper to get all known users (for daily picks, we need a way to see all users)
async function getKnownUsers() {
  return getRedis.keys("user:*") || [];
}

/**
 * Run the daily pick sequence (Pidor or Beauty)
 */
async function runDailyPick(botToken, type = "pidor", suspenseMessages = null) {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const key = type === "pidor" ? `pidor:${today}` : `beauty:${today}`;

  const existed = await getRedis.get(key);
  if (existed) {
    return `The ${type} of the day has already been picked for today! It was <a href="tg://user?id=${existed}">${existed}</a>.`;
  }

  // Get eligible users (enrolled in daily picks)
  const eligible = await getDailyEligible();

  if (eligible.length === 0) {
    return `No one is enrolled for ${type} of the day today. Ask someone to register!`;
  }

  // Pick a random user
  const randomIndex = Math.floor(Math.random() * eligible.length);
  const chosen = eligible[randomIndex];

  // Send suspense messages before revealing
  if (suspenseMessages) {
    const messages = [
      "Выясним, кто тут главный pidor 😏",
      "Проверим, все ли пишут тесты 🤔",
      "Смотрим наличие костылей в коде 🩼",
      "Ищем, у кого есть кружка Peder 🍺",
      "Изучаем фото с ЛГБТ-митингов 🌈",
    ];

    for (const msg of messages) {
      // You would send these via telegram here
      // For now, just log
      console.log("Suspense:", msg);
    }
  }

  // Set the result for today
  await getRedis.set(key, chosen, "EX", 86400 * 3); // 3 days
  // Format the result
  return `The ${type} of the day is: <a href="tg://user?id=${chosen}">${chosen}</a>`;
}

/**
 * Enroll a user in daily picks
 */
async function enrollInDailyPicks(chatId) {
  const key = "daily-eligible";
  const enrolled = await getRedis.get(key) || [];
  if (!enrolled.includes(chatId)) {
    enrolled.push(chatId);
    await getRedis.set(key, JSON.stringify(enrolled));
  }
}

/**
 * Remove a user from daily picks
 */
async function unenrollFromDailyPicks(chatId) {
  const key = "daily-eligible";
  const enrolled = await getRedis.get(key) || [];
  const newEnrolled = enrolled.filter(id => id !== chatId);
  await getRedis.set(key, JSON.stringify(newEnrolled));
}

/**
 * Check if a user is eligible for daily picks
 */
async function isDailyEligible(chatId) {
  const eligible = await getDailyEligible();
  return eligible.includes(chatId);
}

module.exports = {
  runDailyPick,
  enrollInDailyPicks,
  unenrollFromDailyPicks,
  isDailyEligible,
};
