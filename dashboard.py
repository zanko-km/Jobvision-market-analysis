import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
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


with st.spinner("Loading JobVision data..."):
    df = load_data()



st.title("💼 JobVision Job Market Overview")
st.caption(
    "Live overview of the Iranian job market based on JobVision listings"
)

st.divider()



total_jobs = len(df)

unique_companies = (
    df["company"].nunique()
    if "company" in df.columns
    else 0
)

unique_provinces = (
    df["province"].nunique()
    if "province" in df.columns
    else 0
)

if "is_remote" in df.columns:
    remote_jobs = int(
        df["is_remote"]
        .fillna(False)
        .astype(bool)
        .sum()
    )
else:
    remote_jobs = 0



col1, col2, col3, col4 = st.columns(4)

col1.metric(
    "💼 Total Jobs",
    f"{total_jobs:,}"
)

col2.metric(
    "🏢 Employers",
    f"{unique_companies:,}"
)

col3.metric(
    "📍 Provinces",
    f"{unique_provinces:,}"
)

col4.metric(
    "🌐 Remote Jobs",
    f"{remote_jobs:,}"
)


st.divider()



st.subheader("🔥 Latest Job Offers")
st.caption("Browse the latest 20 job offers")

carousel_size = min(20, len(df))

if "created_at" in df.columns:

    carousel_df = (
        df.assign(
            created_at_parsed=pd.to_datetime(
                df["created_at"],
                errors="coerce"
            )
        )
        .sort_values(
            "created_at_parsed",
            ascending=False
        )
        .head(carousel_size)
    )

else:

    carousel_df = df.head(carousel_size)


cards = []

for _, job in carousel_df.iterrows():

    title = str(
        job.get("title", "Untitled Position")
    )

    company = str(
        job.get("company", "Unknown Company")
    )

    province = str(
        job.get("province", "Unknown Location")
    )

    seniority = str(
        job.get("seniority", "")
    )

    work_type = str(
        job.get("work_type", "")
    )

    is_remote = job.get(
        "is_remote",
        False
    )

    metadata = []

    if province and province != "nan":
        metadata.append(f"📍 {province}")

    if work_type and work_type != "nan":
        metadata.append(f"💼 {work_type}")

    if seniority and seniority != "nan":
        metadata.append(f"🎯 {seniority}")

    if is_remote:
        metadata.append("🌐 Remote")

    metadata_html = "".join(
        f'<div class="job-meta">{item}</div>'
        for item in metadata
    )

    cards.append(
        f"""
        <div class="job-card">

            <div class="job-title">
                {title}
            </div>

            <div class="job-company">
                🏢 {company}
            </div>

            {metadata_html}

        </div>
        """
    )


cards_html = "".join(cards)



carousel_html = f"""
<style>

    .job-carousel {{
        display: flex;
        flex-direction: row;

        gap: 16px;

        width: 100%;

        overflow-x: auto;
        overflow-y: hidden;

        padding: 8px 4px 18px 4px;

        white-space: nowrap;

        scrollbar-width: auto;
    }}

    .job-carousel::-webkit-scrollbar {{
        height: 12px;
    }}

    .job-carousel::-webkit-scrollbar-track {{
        background: #eeeeee;
        border-radius: 10px;
    }}

    .job-carousel::-webkit-scrollbar-thumb {{
        background: #888888;
        border-radius: 10px;
    }}

    .job-card {{
        flex: 0 0 280px;

        width: 280px;
        min-width: 280px;

        height: 190px;

        padding: 20px;

        border: 1px solid #dddddd;
        border-radius: 14px;

        background: white;

        box-shadow:
            0 2px 8px rgba(0, 0, 0, 0.06);

        overflow: hidden;

        white-space: normal;

        transition:
            transform 0.2s ease,
            box-shadow 0.2s ease;
    }}

    .job-card:hover {{
        transform: translateY(-3px);

        box-shadow:
            0 8px 20px rgba(0, 0, 0, 0.12);
    }}

    .job-title {{
        font-size: 17px;
        font-weight: 700;

        line-height: 1.5;

        margin-bottom: 12px;

        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;

        overflow: hidden;
    }}

    .job-company {{
        font-size: 14px;
        font-weight: 600;

        margin-bottom: 14px;

        white-space: nowrap;

        overflow: hidden;

        text-overflow: ellipsis;
    }}

    .job-meta {{
        font-size: 13px;

        margin-top: 7px;

        color: #666666;
    }}

</style>

<div class="job-carousel">

    {cards_html}

</div>
"""


components.html(
    carousel_html,
    height=280,
    scrolling=False
)


st.divider()



if "province" in df.columns:

    col1, col2 = st.columns(2)

    with col1:

        st.subheader("📍 Jobs by Province")

        province_counts = (
            df["province"]
            .value_counts()
            .head(15)
        )

        st.bar_chart(
            province_counts
        )



    with col2:

        st.subheader("💼 Top Job Categories")

        if "categories" in df.columns:

            category_counts = (
                df["categories"]
                .value_counts()
                .head(15)
            )

            st.bar_chart(
                category_counts
            )

        else:

            st.info(
                "Category data is not available."
            )


    st.divider()



if "company" in df.columns:

    col1, col2 = st.columns(2)

    with col1:

        st.subheader("🏢 Top Employers")

        company_counts = (
            df["company"]
            .value_counts()
            .head(15)
        )

        st.bar_chart(
            company_counts
        )



    with col2:

        st.subheader("🎯 Seniority Distribution")

        if "seniority" in df.columns:

            seniority_counts = (
                df["seniority"]
                .value_counts(dropna=False)
            )

            st.bar_chart(
                seniority_counts
            )

        else:

            st.info(
                "Seniority data is not available."
            )


    st.divider()



if "work_type" in df.columns:

    col1, col2 = st.columns(2)

    with col1:

        st.subheader("📋 Work Type")

        work_type_counts = (
            df["work_type"]
            .value_counts(dropna=False)
        )

        st.bar_chart(
            work_type_counts
        )



    with col2:

        st.subheader("🌐 Remote vs On-site")

        if "is_remote" in df.columns:

            remote_data = pd.Series({
                "Remote": remote_jobs,
                "Non-Remote": total_jobs - remote_jobs
            })

            st.bar_chart(
                remote_data
            )

        else:

            st.info(
                "Remote information is not available."
            )


    st.divider()



with st.expander("ℹ️ Dataset Information"):

    col1, col2, col3 = st.columns(3)

    col1.metric(
        "Rows",
        f"{df.shape[0]:,}"
    )

    col2.metric(
        "Columns",
        f"{df.shape[1]:,}"
    )

    col3.metric(
        "Unique Employers",
        f"{unique_companies:,}"
    )

    st.write("Available columns:")

    st.code(
        ", ".join(df.columns)
    )