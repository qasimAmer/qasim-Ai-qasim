// server.js — Node.js 18+ (fetch مبني داخل)
const http = require("http");
const fs = require("fs");
const path = require("path");

// === تحميل .env يدوياً (بدون dotenv) ===
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

// === الإعدادات ===
const PORT           = process.env.PORT || 3000;
const OLLAMA_URL     = "https://ollama.com/api/chat";
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || "gemma4:31b";

// المفتاح: من البيئة أولاً، وإلا المضمّن (بدّله لو روتيت المفتاح)
const OLLAMA_API_KEY =
  process.env.OLLAMA_API_KEY ||
  "47c1d5951ae1483fb62deb6aea147642.7KingVSTcJMQ8L28Pn5JhWN7";

if (!OLLAMA_API_KEY) {
  console.error("✗  OLLAMA_API_KEY مفقود. ضعه في .env أو في server.js");
  process.exit(1);
}

// === السيرفر ===
const server = http.createServer(async (req, res) => {
  // تقديم الواجهة
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = fs.readFileSync(path.join(__dirname, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // نقطة الـ chat
  if (req.method === "POST" && req.url === "/api/chat") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      let messages;
      try {
        ({ messages } = JSON.parse(raw || "{}"));
        if (!Array.isArray(messages) || messages.length === 0) {
          throw new Error("messages لازم تكون مصفوفة غير فارغة");
        }
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "طلب غير صالح: " + e.message }));
        return;
      }

      try {
        const r = await fetch(OLLAMA_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OLLAMA_API_KEY}`,
          },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages,
            stream: false,
          }),
        });

        const text = await r.text();
        res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });

        // معالجة أخطاء شائعة
        if (r.status === 401) return res.end(JSON.stringify({ error: "401 — المفتاح غلط أو منتهي." }));
        if (r.status === 402) return res.end(JSON.stringify({ error: "402 — الموديل مو ضمن خطتك." }));
        if (r.status === 404) return res.end(JSON.stringify({ error: "404 — اسم الموديل غلط." }));
        if (r.status === 429) return res.end(JSON.stringify({ error: "429 — تجاوزت حد الاستخدام." }));

        res.end(text);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "خطأ بالسيرفر: " + e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`✓ شغّال على http://localhost:${PORT}`);
  console.log(`  الموديل: ${OLLAMA_MODEL}`);
  console.log(`  المفتاح محمّل: ${OLLAMA_API_KEY.slice(0, 8)}…`);
});
