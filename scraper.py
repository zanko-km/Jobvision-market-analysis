import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

URL = "https://candidateapi.jobvision.ir/api/v1/JobPost/List"
PAGE_SIZE = 30
MAX_WORKERS = 5
REQUEST_TIMEOUT = 60
PAGE_RETRIES = 3


def make_session():
    session = requests.Session()

    retry = Retry(
        total=3,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["POST", "GET"],
    )

    adapter = HTTPAdapter(max_retries=retry, pool_connections=MAX_WORKERS, pool_maxsize=MAX_WORKERS)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    return session


def get_page(session, page, category=None, keyword=None, location=None):
    payload = {
        "jobCategoryUrlTitle": category,
        "keyword": keyword,
        "locationWrapper": location,
        "pageSize": PAGE_SIZE,
        "requestedPage": page,
        "sortBy": 1,
        "searchId": None
    }

    response = session.post(URL, json=payload, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    data = response.json()["data"]

    return data["jobPosts"], data["jobPostCount"]


def fetch_page_with_retry(session, page, keyword=None):
    last_error = None

    for attempt in range(1, PAGE_RETRIES + 1):
        try:
            jobs, _ = get_page(session, page, keyword=keyword)
            return page, jobs
        except Exception as e:
            last_error = e
            if attempt < PAGE_RETRIES:
                sleep_for = 2 * attempt
                print(f"Page {page} failed (attempt {attempt}/{PAGE_RETRIES}): {e} - retrying in {sleep_for}s")
                time.sleep(sleep_for)

    print(f"Page {page} failed after {PAGE_RETRIES} attempts: {last_error}")
    return page, []


def _fetch_all_pages(keyword=None):
    session = make_session()

    _, total_jobs = get_page(session, 1, keyword=keyword)
    total_pages = (total_jobs + PAGE_SIZE - 1) // PAGE_SIZE

    print(f"Total jobs: {total_jobs}")
    print(f"Total pages: {total_pages}")

    results = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:

        futures = [
            executor.submit(fetch_page_with_retry, session, page, keyword)
            for page in range(1, total_pages + 1)
        ]

        for future in as_completed(futures):
            page, jobs = future.result()
            results.append((page, jobs))
            print(f"Page {page}/{total_pages}")

    results.sort(key=lambda x: x[0])

    all_jobs = []
    for _, jobs in results:
        all_jobs.extend(jobs)

    return all_jobs


def get_all_jobs():
    return _fetch_all_pages()


def search_jobs(keyword):
    return _fetch_all_pages(keyword=keyword)


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