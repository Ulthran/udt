const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Load team roster with nickname mapping
const teamPath = path.join(__dirname, 'team.json');
let canonicalNames = [];
const nameLookup = {};
if (fs.existsSync(teamPath)) {
  try {
    const rawTeam = JSON.parse(fs.readFileSync(teamPath, 'utf8'));
    canonicalNames = Object.keys(rawTeam);
    for (const [canon, nicks] of Object.entries(rawTeam)) {
      nameLookup[canon.toLowerCase()] = canon;
      if (Array.isArray(nicks)) {
        for (const nick of nicks) {
          nameLookup[nick.toLowerCase()] = canon;
        }
      }
    }
    console.log(`Loaded team roster from ${teamPath} with ${canonicalNames.length} players`);
  } catch (err) {
    console.error('Failed to parse team.json', err);
  }
} else {
  console.warn('team.json not found; name normalization disabled');
}

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

// Store the CSV inside the public folder so it can be fetched by the browser
const csvPath = path.join(__dirname, 'public', 'game.csv');
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
// CSV tracking which players were on which points
const playersCsvPath = path.join(__dirname, 'public', 'players.csv');
let pointNumber = 0;

function initPlayersCsv() {
  let headers = ['Player'];
  const rows = {};
  if (fs.existsSync(playersCsvPath)) {
    const lines = fs.readFileSync(playersCsvPath, 'utf8').trim().split('\n');
    if (lines.length) {
      headers = lines[0].split(',');
      pointNumber = headers.length - 1;
      for (const line of lines.slice(1)) {
        const parts = line.split(',');
        rows[parts[0]] = parts.slice(1);
      }
    }
  }

  canonicalNames.forEach(name => {
    if (!rows[name]) rows[name] = new Array(pointNumber).fill('');
  });

  const outLines = [headers.join(',')];
  for (const p of canonicalNames) {
    outLines.push([p, ...(rows[p] || [])].join(','));
  }
  fs.writeFileSync(playersCsvPath, outLines.join('\n'));
}

function recordLineup(names) {
  pointNumber += 1;
  const lines = fs.readFileSync(playersCsvPath, 'utf8').trim().split('\n');
  const headers = lines[0].split(',');
  headers.push(pointNumber.toString());
  const roster = new Set(names.map(normalizeName));
  const newLines = [headers.join(',')];
  for (const line of lines.slice(1)) {
    const parts = line.split(',');
    const player = parts[0];
    const cols = parts.slice(1);
    cols.push(roster.has(player) ? '1' : '');
    newLines.push([player, ...cols].join(','));
  }
  fs.writeFileSync(playersCsvPath, newLines.join('\n'));
}

function normalizeName(name) {
  if (!name) return name;
  const key = name.toLowerCase().trim();
  return nameLookup[key] || name;
}

// initialise players.csv on startup
initPlayersCsv();

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
    ` If a sentence lists the lineup for a point, return one object with "stat" set to "line" and` +
    ` "player" containing a comma separated list of the player names.` +
    ` Return only a JSON array of objects each with "player" and "stat" (` +
    `score, assist, block, turnover, or line). If no stats are present return [].\n` +
    glossaryText +
    `Return only the JSON array without any extra text.\n` +
    `Dictation: ${text}`;
  console.log('Sending prompt to OpenAI:', prompt);

  const resp = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 100,
    temperature: 0
  });
  console.log('OpenAI raw response:', resp);
  const resultText = resp.choices[0].message.content.trim();
  try {
    let jsonText = resultText;
    // Strip Markdown code fences like ```json ... ``` if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/i, '')
        .replace(/```\s*$/s, '')
        .trim();
    }
    // Extract the first JSON array
    const start = jsonText.indexOf('[');
    const end = jsonText.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      jsonText = jsonText.slice(start, end + 1);
    }
    const items = JSON.parse(jsonText);
    if (Array.isArray(items)) {
      console.log('Parsed events from OpenAI:', items);
      return items.map(it => ({ event: String(it.stat).toLowerCase(), details: it.player }));
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
    const rows = [];
    for (const e of events) {
      if (e.event === 'line') {
        const names = String(e.details)
          .split(/[,;]+/)
          .map(n => n.trim())
          .filter(Boolean);
        recordLineup(names);
        rows.push({
          timestamp: new Date().toISOString(),
          event: 'line',
          details: names.map(normalizeName).join('; ')
        });
      } else {
        rows.push({
          timestamp: new Date().toISOString(),
          event: e.event,
          details: normalizeName(e.details)
        });
      }
    }
    console.log('Writing rows to CSV:', rows);
    if (rows.length) {
      await csvWriter.writeRecords(rows);
    }
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
