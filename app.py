import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from scraper import (
    get_all_jobs,
    jobs_to_dataframe,
    search_jobs,
)

st.set_page_config(
    page_title="JobVision Market Analysis",
    page_icon="💼",
    layout="wide",
)






if "df" not in st.session_state:

    with st.spinner("Loading JobVision data..."):

        jobs = get_all_jobs()

        st.session_state.df = jobs_to_dataframe(jobs)


df = st.session_state.df






if "search_results" not in st.session_state:
    st.session_state.search_results = None

if "search_query" not in st.session_state:
    st.session_state.search_query = None






col1, col2 = st.columns([5, 1])

with col1:

    job_title = st.text_input(
        "Job title or company...",
        placeholder="e.g. Python Developer",
    )

with col2:

    st.write("")
    st.write("")

    search_clicked = st.button(
        "🔍 Search",
        use_container_width=True,
    )


if search_clicked:

    if not job_title.strip():

        st.warning(
            "Please enter job title or company name"
        )

    else:

        with st.spinner(
            f"Searching for {job_title}..."
        ):

            jobs = search_jobs(job_title)

            st.session_state.search_results = (
                jobs_to_dataframe(jobs)
            )

            st.session_state.search_query = job_title

        st.rerun()






if st.session_state.search_results is not None:

    if st.button("← Back to Market Overview"):

        st.session_state.search_results = None
        st.session_state.search_query = None

        st.rerun()






def render_market_overview(df):

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

    st.caption(
        "Browse the latest 20 job offers"
    )


    carousel_size = min(20, len(df))


    if "created_at" in df.columns:

        carousel_df = (

            df.assign(

                created_at_parsed=pd.to_datetime(
                    df["created_at"],
                    errors="coerce",
                )

            )

            .sort_values(
                "created_at_parsed",
                ascending=False,
            )

            .head(carousel_size)

        )

    else:

        carousel_df = df.head(carousel_size)


    cards = []


    for _, job in carousel_df.iterrows():

        title = str(
            job.get(
                "title",
                "Untitled Position",
            )
        )

        company = str(
            job.get(
                "company",
                "Unknown Company",
            )
        )

        province = str(
            job.get(
                "province",
                "Unknown Location",
            )
        )

        seniority = str(
            job.get(
                "seniority",
                "",
            )
        )

        work_type = str(
            job.get(
                "work_type",
                "",
            )
        )

        is_remote = job.get(
            "is_remote",
            False,
        )


        metadata = []


        if province and province != "nan":

            metadata.append(
                f"📍 {province}"
            )


        if work_type and work_type != "nan":

            metadata.append(
                f"💼 {work_type}"
            )


        if seniority and seniority != "nan":

            metadata.append(
                f"🎯 {seniority}"
            )


        if is_remote:

            metadata.append(
                "🌐 Remote"
            )


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

            background: 

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

        scrolling=False,

    )


    st.divider()


    
    
    

    if "province" in df.columns:

        col1, col2 = st.columns(2)


        with col1:

            st.subheader(
                "📍 Jobs by Province"
            )

            province_counts = (

                df["province"]

                .value_counts()

                .head(15)

            )

            st.bar_chart(
                province_counts
            )


        with col2:

            st.subheader(
                "💼 Top Job Categories"
            )

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

            st.subheader(
                "🏢 Top Employers"
            )

            company_counts = (

                df["company"]

                .value_counts()

                .head(15)

            )

            st.bar_chart(
                company_counts
            )


        with col2:

            st.subheader(
                "🎯 Seniority Distribution"
            )

            if "seniority" in df.columns:

                seniority_counts = (

                    df["seniority"]

                    .value_counts(
                        dropna=False
                    )

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

            st.subheader(
                "📋 Work Type"
            )

            work_type_counts = (

                df["work_type"]

                .value_counts(
                    dropna=False
                )

            )

            st.bar_chart(
                work_type_counts
            )


        with col2:

            st.subheader(
                "🌐 Remote vs On-site"
            )

            if "is_remote" in df.columns:

                remote_data = pd.Series({

                    "Remote": remote_jobs,

                    "Non-Remote":
                        total_jobs - remote_jobs,

                })

                st.bar_chart(
                    remote_data
                )

            else:

                st.info(
                    "Remote information is not available."
                )


        st.divider()


    
    
    

    with st.expander(
        "ℹ️ Dataset Information"
    ):

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


        st.write(
            "Available columns:"
        )


        st.code(
            ", ".join(df.columns)
        )






def render_search_analysis(df, query):

    st.title(
        f"🔍 Search Analysis: {query}"
    )

    st.caption(
        f"Analysis based on {len(df)} matching job offers"
    )

    st.divider()


    if df.empty:

        st.warning(
            "No job offers found for this search."
        )

        return


    
    
    

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
        "💼 Matching Jobs",
        f"{total_jobs:,}"
    )


    col2.metric(
        "🏢 Hiring Companies",
        f"{unique_companies:,}"
    )


    col3.metric(
        "📍 Locations",
        f"{unique_provinces:,}"
    )


    col4.metric(
        "🌐 Remote Jobs",
        f"{remote_jobs:,}"
    )


    st.divider()

    if "salary" in df.columns:

        salary_df = df.copy()

        def parse_salary(value):
            if pd.isna(value):
                return None

            value = str(value)

            numbers = pd.Series(
                pd.to_numeric(
                    pd.Series(
                        value.replace(",", " ")
                        .replace("،", " ")
                        .split()
                    ),
                    errors="coerce",
                )
            ).dropna()

            if len(numbers) >= 2:
                return (numbers.iloc[0] + numbers.iloc[1]) / 2

            elif len(numbers) == 1:
                return numbers.iloc[0]

            return None

        salary_df["salary_average"] = (
            salary_df["salary"]
            .apply(parse_salary)
        )

        salary_df = salary_df.dropna(
            subset=["salary_average"]
        )

        if not salary_df.empty:

            
            
            

            overall_average_salary = (
                salary_df["salary_average"].mean()
            )

            st.subheader("💰 Salary Analysis")

            col1, col2 = st.columns(2)

            col1.metric(
                "💰 Overall Average Salary",
                f"{overall_average_salary:.1f} Million Toman",
            )

            col2.metric(
                "📄 Jobs With Salary Data",
                f"{len(salary_df):,}",
            )

            st.divider()

            
            
            

            if "seniority" in salary_df.columns:

                salary_by_seniority = (
                    salary_df
                    .dropna(subset=["seniority"])
                    .groupby("seniority")["salary_average"]
                    .mean()
                    .sort_values()
                )

                if not salary_by_seniority.empty:

                    st.subheader(
                        "📊 Average Salary by Seniority"
                    )

                    st.bar_chart(
                        salary_by_seniority
                    )

                    salary_table = (
                        salary_by_seniority
                        .reset_index()
                    )

                    salary_table.columns = [
                        "Seniority",
                        "Average Salary (Million Toman)",
                    ]

                    salary_table[
                        "Average Salary (Million Toman)"
                    ] = (
                        salary_table[
                            "Average Salary (Million Toman)"
                        ]
                        .round(1)
                    )

                    st.dataframe(
                        salary_table,
                        use_container_width=True,
                        hide_index=True,
                    )

        else:

            st.info(
                "No salary information is available for these job offers."
            )
    
    
    

    col1, col2 = st.columns(2)


    with col1:

        st.subheader(
            "🏢 Top Hiring Companies"
        )

        if "company" in df.columns:

            company_counts = (

                df["company"]

                .value_counts()

                .head(10)

            )

            st.bar_chart(
                company_counts
            )

        else:

            st.info(
                "Company data is not available."
            )


    with col2:

        st.subheader(
            "📍 Job Locations"
        )

        if "province" in df.columns:

            province_counts = (

                df["province"]

                .value_counts()

                .head(10)

            )

            st.bar_chart(
                province_counts
            )

        else:

            st.info(
                "Location data is not available."
            )


    st.divider()


    
    
    

    col1, col2 = st.columns(2)


    with col1:

        st.subheader(
            "🎯 Experience Level"
        )

        if "seniority" in df.columns:

            seniority_counts = (

                df["seniority"]

                .value_counts(
                    dropna=False
                )

            )

            st.bar_chart(
                seniority_counts
            )

        else:

            st.info(
                "Seniority data is not available."
            )


    with col2:

        st.subheader(
            "📋 Work Type"
        )

        if "work_type" in df.columns:

            work_type_counts = (

                df["work_type"]

                .value_counts(
                    dropna=False
                )

            )

            st.bar_chart(
                work_type_counts
            )

        else:

            st.info(
                "Work type data is not available."
            )


    st.divider()


    
    
    

    st.subheader(
        "📄 Matching Job Offers"
    )

    st.dataframe(
        df,
        use_container_width=True,
    )






if st.session_state.search_results is not None:

    render_search_analysis(
        st.session_state.search_results,
        st.session_state.search_query,
    )

else:

    render_market_overview(df)