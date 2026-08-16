import streamlit as st
from scraper import get_all_jobs, jobs_to_dataframe

st.set_page_config(
    page_title="JobVision Market Analysis",
    page_icon="💼",
    layout="wide"
)

st.title("💼 JobVision Job Market Dashboard")
st.caption("Live job market data from JobVision")

@st.cache_data(ttl=300)
def load_data():
    jobs = get_all_jobs()
    return jobs_to_dataframe(jobs)

with st.spinner("در حال دریافت آگهی‌ها..."):
    df = load_data()

st.success(f"{len(df):,} آگهی دریافت شد.")

col1, col2, col3, col4 = st.columns(4)

col1.metric("Total Jobs", f"{len(df):,}")
col2.metric("Companies", df["company"].nunique())
col3.metric("Provinces", df["province"].nunique())
col4.metric("Remote Jobs", int(df["is_remote"].sum()))

st.divider()

st.subheader("📍 Jobs by Province")

province_counts = (
    df["province"]
    .value_counts()
    .head(10)
)

st.bar_chart(province_counts)

st.subheader("💼 Job Categories")

category_counts = (
    df["categories"]
    .value_counts()
    .head(10)
)

st.bar_chart(category_counts)