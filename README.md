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

3. Start the server:

```bash
node server.js
```

4. Open your browser to `http://localhost:3000`.

## Usage

* Click **Start Voice** to begin recording using the browser's speech recognition (Web Speech API). Once you're done speaking, click **Stop Voice**.
* You can also type directly into the text area.
* Click **Send** to send the text to the server. The server will attempt to parse events with OpenAI if an API key is provided, falling back to storing the raw text otherwise.
* Parsed events are appended to `game.csv` in the project root.
