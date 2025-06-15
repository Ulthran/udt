const express = require('express');
const bodyParser = require('body-parser');
const { ChatOpenAI } = require('@langchain/openai');
const { LLMChain } = require('langchain/chains');
const { BufferWindowMemory } = require('langchain/memory');
const { PromptTemplate } = require('@langchain/core/prompts');
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

let parserChain;
if (process.env.OPENAI_API_KEY) {
  const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: 'gpt-4.1-mini',
    temperature: 0
  });
  const memory = new BufferWindowMemory({ k: 8, returnMessages: true, memoryKey: 'history' });
  const template = `You are keeping stats for an ultimate frisbee game one snippet at a time. ` +
    `Use the prior context to resolve names or actions. ` +
    `Return JSON with players mentioned and events (player and type). ` +
    `Valid event types are score, assist, block, turn, pull, line.` +
    ` If no events are present return {"players":[],"events":[]}.` +
    `\n{glossary}\n{history}\nSnippet: "{input}"`;
  const prompt = new PromptTemplate({ template, inputVariables: ['history', 'input', 'glossary'] });
  parserChain = new LLMChain({ llm, memory, prompt });
  console.log('LangChain parser initialized');
} else {
  console.log('No OpenAI API key provided; using fallback parser');
}

if (process.env.MOCK_OPENAI === '1') {
  console.log('Using mock OpenAI implementation for testing');
  parserChain = {
    call: async () => ({ text: JSON.stringify({ players: ["Jason"], events: [{ player: "Jason", type: "turn" }] }) })
  };
}

async function parseWithAI(text) {
  console.log('parseWithAI called with:', text);
  if (!parserChain) {
    console.log('LLM chain not configured, returning raw event');
    // fallback simple parser
    return { players: [], events: [{ player: text, type: 'raw' }] };
  }
  let glossaryText = '';
  if (glossaryEntries.length) {
    const t = text.toLowerCase();
    const matched = glossaryEntries.filter(e => new RegExp(`\\b${e.term}\\b`, 'i').test(t)).map(e => e.line);
    if (matched.length) {
      glossaryText = `Glossary:\n${matched.join('\n')}\n`;
    }
  }

  const resp = await parserChain.call({ input: text, glossary: glossaryText });
  const resultText = (resp.text || '').trim();
  try {
    let jsonText = resultText;
    // Strip Markdown code fences like ```json ... ``` if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/i, '')
        .replace(/```\s*$/s, '')
        .trim();
    }
    const obj = JSON.parse(jsonText);
    if (obj && Array.isArray(obj.events) && Array.isArray(obj.players)) {
      console.log('Parsed events from OpenAI:', obj);
      return {
        players: obj.players,
        events: obj.events.map(it => ({ player: it.player, type: String(it.type).toLowerCase() }))
      };
    }
  } catch (err) {
    console.error('AI parse error', err);
    // fall through to returning raw event
  }
  // If parsing fails, keep the original text as a raw event
  return { players: [], events: [{ player: text, type: 'raw' }] };
}

app.post('/api/process', async (req, res) => {
  try {
    const { text } = req.body;
    console.log('Received /api/process request with text:', text);
    await fs.promises.appendFile(
      transcriptPath,
      `${new Date().toISOString()} ${text}\n`
    );
    const parsed = await parseWithAI(text);
    const rows = [];
    const playerSet = new Set(parsed.players.map(normalizeName));
    for (const e of parsed.events) {
      if (e.type === 'line') {
        const names = String(e.player)
          .split(/[,;]+/)
          .map(n => n.trim())
          .filter(Boolean);
        names.forEach(n => playerSet.add(normalizeName(n)));
        recordLineup(names);
        rows.push({
          timestamp: new Date().toISOString(),
          event: 'line',
          details: names.map(normalizeName).join('; ')
        });
      } else {
        playerSet.add(normalizeName(e.player));
        rows.push({
          timestamp: new Date().toISOString(),
          event: e.type,
          details: normalizeName(e.player)
        });
      }
    }
    console.log('Writing rows to CSV:', rows);
    if (rows.length) {
      await csvWriter.writeRecords(rows);
    }
    res.json({ players: Array.from(playerSet), events: parsed.events.map(e => ({ player: normalizeName(e.player), type: e.type })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'processing failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
