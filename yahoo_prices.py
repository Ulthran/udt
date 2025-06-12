import datetime
from typing import Dict, Iterable
import yfinance as yf


def fetch_prices(date_to_tickers: Dict[datetime.date, Iterable[str]]) -> Dict[datetime.date, Dict[str, float]]:
    """Return closing prices for each ticker on each date.

    Yahoo requests are grouped per date with all tickers for that date so the
    input structure is respected. Each request downloads one day of data for all
    tickers scheduled on that date.
    """
    if not date_to_tickers:
        return {}

    results: Dict[datetime.date, Dict[str, float]] = {}

    for day, tickers in date_to_tickers.items():
        tickers = sorted(set(tickers))
        if not tickers:
            continue

        try:
            data = yf.download(
                tickers,
                start=day,
                end=day + datetime.timedelta(days=1),
                group_by="ticker",
                progress=False,
                threads=False,
            )
        except Exception as e:
            logging.error(f"Failed to fetch data for {day} and tickers {tickers}: {e}")
            continue

        prices: Dict[str, float] = {}

        if len(tickers) == 1:
            # Single ticker: DataFrame columns are not MultiIndexed
            row = data.iloc[0] if not data.empty else None
            if row is not None:
                price = row.get("Adj Close", row.get("Close"))
                if price is not None:
                    prices[tickers[0]] = float(price)
        else:
            for t in tickers:
                if t in data:
                    row = data[t].iloc[0] if not data[t].empty else None
                    if row is not None:
                        price = row.get("Adj Close", row.get("Close"))
                        if price is not None:
                            prices[t] = float(price)

        if prices:
            results[day] = prices

    return results


if __name__ == "__main__":
    import pprint
    example = {
        datetime.date(2023, 1, 3): {"AAPL", "MSFT"},
        datetime.date(2023, 1, 4): {"AAPL"},
    }
    pprint.pprint(fetch_prices(example))
