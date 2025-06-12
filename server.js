const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Load glossary of common ultimate frisbee terms if available
const glossaryPath = path.join(__dirname, 'glossary.txt');
let glossary = '';
if (fs.existsSync(glossaryPath)) {
  glossary = fs.readFileSync(glossaryPath, 'utf8').trim();
  console.log(`Loaded glossary from ${glossaryPath}`);
}

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

console.log(`CSV output path: ${csvPath}`);

let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('OpenAI client initialized');
} else {
  console.log('No OpenAI API key provided; using fallback parser');
}

if (process.env.MOCK_OPENAI === '1') {
  console.log('Using mock OpenAI implementation for testing');
  openai = {
    completions: {
      create: async (opts) => {
        console.log('Mock OpenAI received prompt:', opts.prompt);
        return { choices: [{ text: '[{"player":"Jason","stat":"turn"}]' }] };
      }
    }
  };
}

async function parseWithAI(text) {
  console.log('parseWithAI called with:', text);
  if (!openai) {
    console.log('OpenAI client not configured, returning raw event');
    // fallback simple parser
    return [{ event: 'raw', details: text }];
  }
  const prompt = `From the sentence below identify any ultimate frisbee statistics.` +
    ` Return only a JSON array of objects each with "player" and "stat" (` +
    `score, assist, block or turnover). If no stats are present return [].\n` +
    (glossary ? `Glossary:\n${glossary}\n` : '') +
    `Sentence: ${text}`;
  console.log('Sending prompt to OpenAI:', prompt);
  const resp = await openai.completions.create({
    model: 'text-davinci-003',
    prompt,
    max_tokens: 100,
    temperature: 0
  });
  console.log('OpenAI raw response:', resp);
  const resultText = resp.choices[0].text.trim();
  try {
    const items = JSON.parse(resultText);
    if (Array.isArray(items)) {
      console.log('Parsed events from OpenAI:', items);
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
    console.log('Received /api/process request with text:', text);
    const events = await parseWithAI(text);
    const rows = events.map(e => ({ timestamp: new Date().toISOString(), event: e.event, details: e.details }));
    console.log('Writing rows to CSV:', rows);
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
