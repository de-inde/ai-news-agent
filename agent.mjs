// agent.mjs
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CUSTOM_QUERY = (process.env.CUSTOM_QUERY || '').trim();

const AI_RSS_FEEDS = [
  // Офіційні лабораторії та тех-гіганти
  { name: "Google AI", url: "https://blog.google/technology/ai/rss/" },
  { name: "OpenAI", url: "https://openai.com/news/rss.xml" },
  { name: "Anthropic", url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml" },
  { name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml" },
  { name: "Microsoft AI", url: "https://blogs.microsoft.com/ai/feed/" },
  { name: "NVIDIA AI", url: "https://blogs.nvidia.com/feed/" },
  // Профільні світові медіа про ШІ
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "Ars Technica AI", url: "https://arstechnica.com/ai/feed/" },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed" },
  { name: "The Decoder", url: "https://the-decoder.com/feed/" },
  { name: "Wired AI", url: "https://www.wired.com/feed/tag/ai/latest/rss" },
  { name: "MarkTechPost", url: "https://www.marktechpost.com/feed/" },
  // Українські ІТ-медіа
  { name: "DEV.ua", url: "https://dev.ua/rss" },
  { name: "AIN.ua", url: "https://ain.ua/feed/" }
];

async function fetchRssItems(feeds, hoursBack = 48) {
  let allItems = [];
  const cutoffTime = Date.now() - hoursBack * 60 * 60 * 1000;

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AINewsAgent/1.0)' }
      });
      if (!res.ok) continue;
      const xml = await res.text();

      const itemRegex = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
      let match;
      let count = 0;

      while ((match = itemRegex.exec(xml)) !== null && count < 20) {
        const itemXml = match[1];
        const title = (itemXml.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/))?.[1]?.trim();
        const link = (itemXml.match(/<link>([\s\S]*?)<\/link>/) || itemXml.match(/<link[^>]*href=["']([^"']+)["']/))?.[1]?.trim();
        const pubDateStr = (itemXml.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/) )?.[1]?.trim();

        if (pubDateStr) {
          const pubTime = Date.parse(pubDateStr);
          if (!isNaN(pubTime) && pubTime < cutoffTime) continue;
        }

        if (title && link) {
          const cleanTitle = title
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#039;/g, "'")
            .replace(/&#8217;/g, "'")
            .replace(/<[^>]+>/g, '');
          allItems.push(`[${feed.name}] ${cleanTitle} (${link})`);
          count++;
        }
      }
    } catch (e) {
      console.warn(`Не вдалося прочитати RSS ${feed.name}:`, e.message);
    }
  }
  return allItems.join('\n');
}

async function generateWithGemini(prompt) {
  const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
  const modelsData = await modelsRes.json();
  const flashModel = modelsData.models?.find(m => 
    m.name.includes('flash') && 
    !m.name.includes('2.5') && 
    !m.name.includes('2.0') && 
    !m.name.includes('1.5') &&
    m.supportedGenerationMethods?.includes('generateContent')
  )?.name || 'models/gemini-3.0-flash';

  console.log('Використовую модель:', flashModel);
  const url = `https://generativelanguage.googleapis.com/v1beta/${flashModel}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Помилка Gemini API: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  let text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || 'Новин не знайдено.';

  // 1. Прибираємо пошукові виноски типу [1], [4], [2, 5]
  text = text.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '');

  // 2. Перетворюємо можливий Markdown на HTML
  text = text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // 3. Гарантовано робимо весь жирний текст КАПСЛОКОМ
  text = text.replace(/<b>([\s\S]*?)<\/b>/g, (_, content) => `<b>${content.toUpperCase()}</b>`);

  // 4. Гарантовано додаємо порожній рядок (абзац) між заголовком (🔹/🔸) та основним текстом
  text = text.replace(/^([🔸🔹]\s*<b>[^\n]+<\/b>)\n(?!\n)/gm, '$1\n\n');

  // 5. Гарантовано робимо рядки "Що це дає:" та "Деталі:" повністю курсивом
  text = text.replace(
    /▫️\s*(?:<i>)?(Що це дає:|Деталі:)(?:<\/i>)?\s*([\s\S]*?)(?=\s*<a\s+href=|\n|$)/g,
    (_, label, rest) => `▫️ <i>${label} ${rest.replace(/<\/?i>/g, '').trim()}</i>`
  );

  return text;
}

async function fetchAiDigest(today) {
  const rssText = await fetchRssItems(AI_RSS_FEEDS, 48);
  const prompt = `Сьогодні ${today}. Ти — шеф-редактор профільного щоденного Telegram-дайджесту про Штучний Інтелект та технології.
Твоє завдання — відібрати ДО 15 найважливіших та найцікавіших свіжих новин ШІ за останню добу (мінімум 12, максимум 15 новин) і розбити їх на ТРИ тематичні повідомлення (по 4–5 новин у кожному), розділені маркером ===SPLIT===:

Частина 1: 🧠 <b>МОДЕЛІ, ЛАБОРАТОРІЇ ТА ДОСЛІДЖЕННЯ | ${today}</b> (релізи LLM, OpenAI, Google, Anthropic, Hugging Face, мультимодальність, відкритий код).
Частина 2: 🛠 <b>ПРАКТИЧНІ ІНСТРУМЕНТИ, АГЕНТИ ТА РОЗРОБКА | ${today}</b> (нові AI-сервіси, автоматизація, API, інструменти для коду, генерації відео/аудіо/тексту).
Частина 3: 🌐 <b>ІНДУСТРІЯ, БІЗНЕС, МЕДІА ТА УКРАЇНА | ${today}</b> (впровадження ШІ в індустріях, кіно та креативному секторі, великі угоди, регулювання, українські AI-новини з DEV.ua та AIN.ua).

ГОЛОВНІ ПРАВИЛА ОФОРМЛЕННЯ:
1. ВЕСЬ ЖИРНИЙ ТЕКСТ (заголовки новин) МАЄ БУТИ НАПИСАНИЙ КАПСЛОКОМ (ВЕЛИКИМИ ЛІТЕРАМИ): <b>ОСЬ ТАК</b>.
2. МІЖ ЗАГОЛОВКОМ (🔹) ТА ОСНОВНИМ ТЕКСТОМ НОВИНИ ОБОВ'ЯЗКОВО РОБИ ПОРОЖНІЙ РЯДОК (АБЗАЦ)!
3. КАТЕГОРИЧНО ЗАБОРОНЕНО ставити цифрові виноски або індекси джерел у квадратних дужках на кшталт [1], [4]!
4. Рядок "▫️ Що це дає: ..." має бути ПОВНІСТЮ КУРСИВОМ до самого посилання.
5. Усе перекладай чистою, живою українською мовою без води. Не дублюй одну й ту саму новину з різних джерел!

Кожну новину оформлюй СТРОГО за таким шаблоном (використовуй ТІЛЬКИ HTML-теги <b>, <i>, <a href="...">):

🔹 <b>ЧІТКИЙ ЗАГОЛОВОК НОВИНИ В ОДИН РЯДОК КАПСОМ</b>

Одне-два змістовні речення з суттю анонсу, релізу чи події (яка компанія і що саме представила чи змінила).
▫️ <i>Що це дає: одне речення про практичну користь, функціонал або важливі деталі повністю курсивом.</i> <a href="URL">Назва джерела</a>

(Між кожною новиною — обов'язково порожній рядок! Між трьома частинами дайджесту — обов'язково окремий рядок із маркером ===SPLIT===).

Свіжі матеріали з 16 RSS-стрічок для аналізу (додатково використай Google Search за останню добу, зокрема перевір anthropic.com/news):
${rssText}`;

  return generateWithGemini(prompt);
}

async function fetchCustomQueryDigest(today, query) {
  const prompt = `Сьогодні ${today}. Ти — AI-аналітик та шеф-редактор.
Користувач замовив спеціальну тематичну підбірку у сфері ШІ за запитом: "${query}".

Знайди через Google Search найсвіжіші матеріали, інструменти чи релізи за цією темою і зверстай змістовну підбірку з 6–8 пунктів за нашим стандартом (ТІЛЬКИ HTML-теги <b>, <i>, <a href="...">, без виносок [1]):

🔎 <b>AI-СПЕЦПІДБІРКА: ${query.toUpperCase()} | ${today}</b>


🔹 <b>ЧІТКИЙ ЗАГОЛОВОК КАПСОМ В ОДИН РЯДОК</b>

Два змістовні речення з головною суттю та контекстом.
▫️ <i>Що це дає: ключові можливості, деталі або практична користь одним реченням курсивом.</i> <a href="URL">Джерело</a>`;

  return generateWithGemini(prompt);
}

function getVisibleLength(htmlText) {
  return htmlText.replace(/<[^>]+>/g, '').length;
}

async function sendSingleMessageBlock(blockText) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const maxVisibleLength = 3950;
  const chunks = [];
  
  let currentChunk = '';
  for (const paragraph of blockText.trim().split('\n\n')) {
    const candidate = currentChunk ? (currentChunk + '\n\n' + paragraph) : paragraph;
    if (getVisibleLength(candidate) > maxVisibleLength) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = paragraph;
    } else {
      currentChunk = candidate;
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  for (const chunk of chunks) {
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    if (!res.ok) {
      console.warn('HTML парсинг не пройшов, відправляю очищеним текстом:', await res.text());
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: chunk.replace(/<[^>]+>/g, ''),
          disable_web_page_preview: true
        })
      });
    }
  }
}

async function sendToTelegram(fullText) {
  const parts = fullText.split('===SPLIT===').map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    await sendSingleMessageBlock(part);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function main() {
  const today = new Date().toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).toUpperCase();

  let digest;
  if (CUSTOM_QUERY) {
    console.log(`Готую AI-спецпідбірку за запитом: "${CUSTOM_QUERY}"...`);
    digest = await fetchCustomQueryDigest(today, CUSTOM_QUERY);
  } else {
    console.log('Збираю великий ШІ-дайджест (до 15 новин)...');
    digest = await fetchAiDigest(today);
  }

  console.log('Відправляю в Telegram...');
  await sendToTelegram(digest);
  console.log('Готово!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
