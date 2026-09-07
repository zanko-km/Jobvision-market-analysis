import json
from datetime import datetime, timezone
from pathlib import Path

from scraper import get_all_jobs, jobs_to_dataframe


def main():
    jobs = get_all_jobs()
    df = jobs_to_dataframe(jobs)

    df = df.where(df.notnull(), None)

    records = df.to_dict(orient="records")

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
