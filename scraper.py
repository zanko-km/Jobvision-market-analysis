from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests

URL = "https://candidateapi.jobvision.ir/api/v1/JobPost/List"
PAGE_SIZE = 30


def get_page(session, page, category = None, keyword = None, location = None):
    payload = {
        "jobCategoryUrlTitle": category,
        "keyword": keyword,
        "locationWrapper": location,
        "pageSize": PAGE_SIZE,
        "requestedPage": page,
        "sortBy": 1,
        "searchId": None
    }

    response = session.post(URL, json=payload, timeout=30)
    response.raise_for_status()

    data = response.json()["data"]

    return data["jobPosts"], data["jobPostCount"]




def get_all_jobs():
    session = requests.Session()

    _, total_jobs = get_page(session, 1)

    total_pages = (total_jobs + PAGE_SIZE - 1) // PAGE_SIZE

    print(f"Total jobs: {total_jobs}")
    print(f"Total pages: {total_pages}")

    all_jobs = []

    MAX_WORKERS = 15

    def fetch_page(page):
        try:
            jobs, _ = get_page(session, page)
            return page, jobs
        except Exception as e:
            print(f"Error on page {page}: {e}")
            return page, []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:

        futures = [
            executor.submit(fetch_page, page)
            for page in range(1, total_pages + 1)
        ]

        results = []

        for future in as_completed(futures):
            page, jobs = future.result()

            results.append((page, jobs))

            print(f"Page {page}/{total_pages}")

    results.sort(key=lambda x: x[0])

    for _, jobs in results:
        all_jobs.extend(jobs)

    return all_jobs


def jobs_to_dataframe(jobs):
    rows = []

    for job in jobs:
        properties = job.get("properties") or {}
        company = job.get("company") or {}
        location = job.get("location") or {}

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
                x.get("titleFa", "")
                for x in job.get("jobCategories", [])
            ),

            "benefits": ", ".join(
                x.get("titleFa", "")
                for x in job.get("benefits", [])
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

            "salary": (
                job.get("salary") or {}
            ).get("titleFa"),

            "activation_date":
                (job.get("activationTime") or {}).get("date"),

            "expire_date":
                (job.get("expireTime") or {}).get("date"),
        })

    return pd.DataFrame(rows)

def search_jobs(keyword):
    session = requests.Session()
    
    _, total_jobs = get_page(session, 1, keyword=keyword)
    total_pages = (total_jobs + PAGE_SIZE - 1) // PAGE_SIZE

    print(f"Total jobs: {total_jobs}")
    print(f"Total pages: {total_pages}")

    all_jobs = []

    MAX_WORKERS = 15

    def fetch_page(page):
        try:
            jobs, _ = get_page(session, page, keyword=keyword)
            return page, jobs
        except Exception as e:
            print(f"Error on page {page}: {e}")
            return page, []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:

        futures = [
            executor.submit(fetch_page, page)
            for page in range(1, total_pages + 1)
        ]

        results = []

        for future in as_completed(futures):
            page, jobs = future.result()

            results.append((page, jobs))

            print(f"Page {page}/{total_pages}")

    results.sort(key=lambda x: x[0])

    for _, jobs in results:
        all_jobs.extend(jobs)

    return all_jobs
    