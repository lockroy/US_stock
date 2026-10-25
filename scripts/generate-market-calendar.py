"""Regenerate the bundled, bounded XNYS reference; not a live exchange feed.

Use Python 3.12 with exchange-calendars==4.13.2 and tzdata==2026.5.
Runtime Workers do not require Python or these packages.
"""
import json
from importlib.metadata import version
from pathlib import Path

import exchange_calendars

assert version("exchange-calendars") == "4.13.2"
assert version("tzdata") == "2026.5"
calendar = exchange_calendars.get_calendar("XNYS", start="2024-01-01", end="2028-12-31")
sessions = {
    str(label.date()): row["close"].tz_convert("America/New_York").strftime("%H:%M")
    for label, row in calendar.schedule.iterrows()
}
payload = {
    "coverageStart": "2024-01-01",
    "coverageEnd": "2028-12-31",
    "timezone": "America/New_York",
    "source": "exchange-calendars",
    "version": version("exchange-calendars"),
    "tzdataVersion": version("tzdata"),
    "sourceUrl": "https://pypi.org/project/exchange-calendars/4.13.2/",
    "wheelSha256": "fc5a2ad0d61b5c3a6539a3061cd4cbb55c59f4a903455cec7926e4b798919996",
    "verification": "third-party-reference; official exchange page not independently retrieved",
    "sessions": sessions,
}
output = Path(__file__).resolve().parents[1] / "lib" / "market" / "xnys-sessions.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
print(f"Wrote {len(sessions)} sessions to {output.name}")
