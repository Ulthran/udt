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

### Glossary

A small glossary of common ultimate frisbee terms is provided in `glossary.json`.
When the server processes a sentence it scans the text for any glossary terms
and only includes matching definitions in prompts sent to the language model.
This keeps prompts concise while still improving parsing accuracy.

## Yahoo Price Lookup

The repository also includes a small helper module `yahoo_prices.py` for
retrieving historical prices from Yahoo Finance. It expects a dictionary mapping
`datetime.date` objects to sets of tickers and returns a nested dictionary of
closing prices for each requested date. Prices are fetched with
`yfinance` using one request per day that includes all tickers needed on that
date.

Example usage:

```python
import datetime
from yahoo_prices import fetch_prices

dates = {datetime.date(2023, 1, 3): {"AAPL", "MSFT"}}
prices = fetch_prices(dates)
print(prices)
```

Install `yfinance` if needed:

```bash
pip install yfinance
```
