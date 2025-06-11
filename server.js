const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const app = express();
app.use(express.static('public'));
app.use(bodyParser.json());

const csvPath = path.join(__dirname, 'game.csv');
const csvWriter = createCsvWriter({
  path: csvPath,
  header: [
    { id: 'timestamp', title: 'Timestamp' },
    { id: 'event', title: 'Event' },
    { id: 'details', title: 'Details' }
  ],
  append: fs.existsSync(csvPath)
});

let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function parseWithAI(text) {
  if (!openai) {
    // fallback simple parser
    return [{ event: 'raw', details: text }];
  }
  const prompt = `From the sentence below identify any ultimate frisbee statistics. ` +
    `Return only a JSON array of objects each with \"player\" and \"stat\" (` +
    `score, assist, block or turnover). If no stats are present return [].\n` +
    `Sentence: ${text}`;
  const resp = await openai.completions.create({
    model: 'text-davinci-003',
    prompt,
    max_tokens: 100,
    temperature: 0
  });
  const resultText = resp.choices[0].text.trim();
  try {
    const items = JSON.parse(resultText);
    if (Array.isArray(items)) {
      return items.map(it => ({ event: it.stat, details: it.player }));
    }
  } catch (err) {
    console.error('AI parse error', err);
  }
  return [{ event: 'ai', details: resultText }];
}

app.post('/api/process', async (req, res) => {
  try {
    const { text } = req.body;
    const events = await parseWithAI(text);
    const rows = events.map(e => ({ timestamp: new Date().toISOString(), event: e.event, details: e.details }));
    await csvWriter.writeRecords(rows);
    res.json({ status: 'ok', events: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'processing failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
