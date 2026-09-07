import json

import pandas as pd

with open("jobvision_jobs.jsonl", "r", encoding="utf-8") as f:
    jobs = [json.loads(line) for line in f]


def get_title(obj):
    return obj.get("titleFa") or obj.get("title") or ""


def parse_salary(salary):
    if not salary:
        return None, None

    text = salary.get("titleFa") or ""

    import re

    numbers = re.findall(r"\d+(?:\.\d+)?", text)

    if len(numbers) >= 2:
        return float(numbers[0]), float(numbers[1])

    if len(numbers) == 1:
        return float(numbers[0]), float(numbers[0])

    return None, None

rows = []

for job in jobs:
    properties = job.get("properties") or {}
    company = job.get("company") or {}
    location = job.get("location") or {}
    salary_min, salary_max = parse_salary(job.get("salary"))
    province = location.get("province") or {}
    city = location.get("city") or {}

    work_type = job.get("workType") or {}
    seniority = job.get("seniorityLevel") or {}
    industry = job.get("industry") or {}
    gender = job.get("gender") or {}

    rows.append({
        "id": job.get("id"),
        "title": job.get("title"),

        "company": company.get("nameFa"),

        "province": province.get("titleFa"),
        "city": city.get("titleFa"),

        "categories": ", ".join(
            get_title(x) for x in job.get("jobCategories", [])
        ),

        "benefits": ", ".join(
            get_title(x) for x in job.get("benefits", [])
        ),

        "work_type": work_type.get("titleFa"),
        "seniority": seniority.get("titleFa"),
        "industry": industry.get("titleFa"),
        "gender": gender.get("titleFa"),

        "is_remote": properties.get("isRemote"),
        "is_internship": properties.get("isInternship"),
        "is_urgent": properties.get("isUrgent"),

        "experience_years":
            properties.get("requiredRelatedExperienceYears"),

        "salary_min": salary_min,
        "salary_max": salary_max,

        "activation_date":
            (job.get("activationTime") or {}).get("date"),

        "expire_date":
            (job.get("expireTime") or {}).get("date"),
    })


df = pd.DataFrame(rows)

print(df.shape)
print(df.columns.tolist())
print()
print(df.head())
print("\nMissing values:")
print(df.isna().sum())

print("\nUnique values:")
print(df.nunique())

print("\nWork types:")
print(df["work_type"].value_counts())

print("\nSeniority:")
print(df["seniority"].value_counts())

print("\nRemote:")
print(df["is_remote"].value_counts())

print("\nTop categories:")
print(df["categories"].value_counts().head(10))

print("\nTop provinces:")
print(df["province"].value_counts())