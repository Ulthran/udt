# UDT - Ultimate Frisbee Stats Prototype

This is a minimal prototype for recording ultimate frisbee stats using a voice or text interface that sends input to an AI endpoint. Parsed events are stored in a CSV file.

## Setup

1. Install dependencies:

```bash
npm install
```

2. (Optional) Set an OpenAI API key in your environment to enable AI parsing:

```bash
export OPENAI_API_KEY=yourkey
```

The server now uses a LangChain conversation memory to keep a short history of
recent snippets. This helps the model maintain context as it updates the game
state one sentence at a time.

3. Edit `team.json` to list your full roster and any nicknames.

4. Start the server:

```bash
node server.js
```

5. Open your browser to `http://localhost:3000`.

## Usage

* Click **Start Voice** to begin recording using the browser's speech recognition (Web Speech API). Once you're done speaking, click **Stop Voice**.
* You can also type directly into the text area.
* Click **Send** to send the text to the server. The server will attempt to parse events with OpenAI if an API key is provided. If parsing fails for any reason, the text is stored as a raw event instead.
* Parsed events are appended to `public/game.csv` so they can be viewed in the browser.
* Each point's lineup is stored in `public/players.csv` with a column per point.
* The browser parses this CSV to build a table showing stats per player.
* Every piece of text you submit is also recorded in `transcript.txt` so you can keep a full log of the game.

### Glossary

A small glossary of common ultimate frisbee terms is provided in `glossary.json`.
When the server processes a sentence it scans the text for any glossary terms
and only includes matching definitions in prompts sent to the language model.
This keeps prompts concise while still improving parsing accuracy.
