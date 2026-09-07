from scraper import get_all_jobs, jobs_to_dataframe

jobs = get_all_jobs()

df = jobs_to_dataframe(jobs)

print(df.shape)
print(df.head())