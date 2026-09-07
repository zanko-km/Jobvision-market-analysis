import json
import math
from datetime import datetime, timezone
from pathlib import Path

from scraper import get_all_jobs, jobs_to_dataframe


def clean_value(v):
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def main():
    jobs = get_all_jobs()
    df = jobs_to_dataframe(jobs)

    records = df.to_dict(orient="records")
    records = [
        {k: clean_value(v) for k, v in row.items()}
        for row in records
    ]

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(records),
        "jobs": records,
    }

    out_path = Path("docs/data/jobs.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {len(records)} jobs to {out_path}")


if __name__ == "__main__":
    main()