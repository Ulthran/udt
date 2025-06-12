const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Load glossary of common ultimate frisbee terms if available
const glossaryPath = path.join(__dirname, 'glossary.json');
let glossaryEntries = [];
if (fs.existsSync(glossaryPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
    glossaryEntries = Object.entries(raw).map(([term, def]) => ({
      term: term.toLowerCase(),
      line: `${term} - ${def}`
    }));
    console.log(`Loaded glossary from ${glossaryPath} with ${glossaryEntries.length} entries`);
  } catch (err) {
    console.error('Failed to parse glossary.json', err);
  }
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

// Path for storing a plain text transcript of all submitted statements
const transcriptPath = path.join(__dirname, 'transcript.txt');

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
  let glossaryText = '';
  if (glossaryEntries.length) {
    const t = text.toLowerCase();
    const matched = glossaryEntries.filter(e => new RegExp(`\\b${e.term}\\b`, 'i').test(t)).map(e => e.line);
    if (matched.length) {
      glossaryText = `Glossary:\n${matched.join('\n')}\n`;
    }
  }

  const prompt = `From the paragraph below dictating an ultimate frisbee game, extract scores, assists, blocks, and turns.` +
    ` Return only a JSON array of objects each with "player" and "stat" (` +
    `score, assist, block or turnover). If no stats are present return [].\n` +
    glossaryText +
    `Return only the JSON array without any extra text.\n` +
    `Dictation: ${text}`;
  console.log('Sending prompt to OpenAI:', prompt);

  const resp = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 100,
    temperature: 0
  });
  console.log('OpenAI raw response:', resp);
  const resultText = resp.choices[0].message.content.trim();
  try {
    const items = JSON.parse(resultText);
    if (Array.isArray(items)) {
      console.log('Parsed events from OpenAI:', items);
      return items.map(it => ({ event: it.stat, details: it.player }));
    }
  } catch (err) {
    console.error('AI parse error', err);
    // fall through to returning raw event
  }
  // If parsing fails, keep the original text as a raw event
  return [{ event: 'raw', details: text }];
}

app.post('/api/process', async (req, res) => {
  try {
    const { text } = req.body;
    console.log('Received /api/process request with text:', text);
    await fs.promises.appendFile(
      transcriptPath,
      `${new Date().toISOString()} ${text}\n`
    );
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
