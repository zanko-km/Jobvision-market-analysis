const JOBVISION_API =
  "https://late-recipe-0638.zankokarimy.workers.dev";

const PAGE_SIZE = 30;
const MAX_LIVE_PAGES = 10;
const DETAIL_CONCURRENCY = 5;

const DATA_URL = "data/jobs.json";

let ALL_JOBS = [];
let OVERVIEW_JOBS = [];
let currentSearchResults = [];

const jobDetailCache = new Map();


// ============================================================
// Utility
// ============================================================

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function normalizeSkillName(name) {
  return String(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeSkillKey(name) {
  return normalizeSkillName(name).toLowerCase();
}


// ============================================================
// JobVision Search
// ============================================================

async function fetchLivePage(keyword, page) {
  const response = await fetch(JOBVISION_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobCategoryUrlTitle: null,
      keyword: keyword,
      locationWrapper: null,
      pageSize: PAGE_SIZE,
      requestedPage: page,
      sortBy: 1,
      searchId: null,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `JobVision API returned ${response.status}`
    );
  }

  const json = await response.json();

  return json.data;
}

function rawJobToRecord(job) {
  const properties = job.properties || {};
  const company = job.company || {};
  const location = job.location || {};
  const province = location.province || {};
  const city = location.city || {};
  const workType = job.workType || {};
  const seniority = job.seniorityLevel || {};

  return {
    id: job.id,

    title: job.title || "",

    company: company.nameFa || "",

    province: province.titleFa || "",

    city: city.titleFa || "",

    categories: (job.jobCategories || [])
      .map((x) => x.titleFa)
      .filter(Boolean)
      .join(", "),

    work_type: workType.titleFa || "",

    seniority: seniority.titleFa || "",

    is_remote: properties.isRemote || false,

    salary: (job.salary || {}).titleFa || "",

    activation_date:
      (job.activationTime || {}).date || "",
  };
}


async function liveSearch(keyword) {
  const first = await fetchLivePage(keyword, 1);

  const total = first?.jobPostCount || 0;

  const totalPages = Math.ceil(
    total / PAGE_SIZE
  );

  const pagesToFetch = Math.min(
    totalPages,
    MAX_LIVE_PAGES
  );

  let jobs = [
    ...(first?.jobPosts || [])
  ];

  const pagePromises = [];

  for (
    let page = 2;
    page <= pagesToFetch;
    page++
  ) {
    pagePromises.push(
      fetchLivePage(keyword, page)
    );
  }

  const rest =
    await Promise.all(pagePromises);

  for (const pageData of rest) {
    jobs.push(
      ...(pageData?.jobPosts || [])
    );
  }

  /*
   * Remove duplicate jobs.
   */
  const unique = [];
  const seen = new Set();

  for (const job of jobs) {
    if (!job.id || seen.has(job.id)) {
      continue;
    }

    seen.add(job.id);
    unique.push(job);
  }

  return unique.map(rawJobToRecord);
}


// ============================================================
// Job Detail / Skills
// ============================================================

async function fetchJobDetail(jobId) {
  if (jobDetailCache.has(jobId)) {
    return jobDetailCache.get(jobId);
  }

  try {
    const response = await fetch(
      `${JOBVISION_API}/job-detail?id=${encodeURIComponent(jobId)}`
    );

    if (!response.ok) {
      throw new Error(
        `Detail API returned ${response.status}`
      );
    }

    const data = await response.json();

    const result = {
      id: jobId,
      skills: Array.isArray(data.skills)
        ? data.skills
        : [],
    };

    jobDetailCache.set(jobId, result);

    return result;
  } catch (error) {
    console.warn(
      `Failed to fetch job ${jobId}:`,
      error
    );

    /*
     * Cache failures too, so we don't repeatedly
     * request a broken job.
     */
    const result = {
      id: jobId,
      skills: [],
      failed: true,
    };

    jobDetailCache.set(jobId, result);

    return result;
  }
}


async function fetchJobDetails(jobIds) {
  const results = [];

  let currentIndex = 0;

  async function worker() {
    while (true) {
      const index = currentIndex++;

      if (index >= jobIds.length) {
        return;
      }

      const jobId = jobIds[index];

      const detail =
        await fetchJobDetail(jobId);

      results[index] = detail;

      updateSkillLoadingProgress(
        Math.min(index + 1, jobIds.length),
        jobIds.length
      );
    }
  }

  const workerCount = Math.min(
    DETAIL_CONCURRENCY,
    jobIds.length
  );

  const workers = [];

  for (
    let i = 0;
    i < workerCount;
    i++
  ) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return results.filter(Boolean);
}


// ============================================================
// Skill Analysis
// ============================================================

function aggregateSkills(details) {
  const skillCounts = new Map();

  let analyzedJobs = 0;

  for (const detail of details) {
    if (
      !detail ||
      detail.failed ||
      !Array.isArray(detail.skills)
    ) {
      continue;
    }

    analyzedJobs++;

    /*
     * A skill counts only once per job.
     */
    const skillsInThisJob = new Set();

    for (const skill of detail.skills) {
      const name =
        normalizeSkillName(skill?.name);

      if (!name) {
        continue;
      }

      const key =
        normalizeSkillKey(name);

      if (skillsInThisJob.has(key)) {
        continue;
      }

      skillsInThisJob.add(key);

      if (!skillCounts.has(key)) {
        skillCounts.set(key, {
          name,
          count: 0,
        });
      }

      skillCounts.get(key).count++;
    }
  }

  const skills = [...skillCounts.values()]
    .map((skill) => ({
      ...skill,
      percentage:
        analyzedJobs > 0
          ? (skill.count / analyzedJobs) * 100
          : 0,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.name.localeCompare(
        b.name
      );
    });

  return {
    skills,
    analyzedJobs,
  };
}


// ============================================================
// Skill Loading UI
// ============================================================

function updateSkillLoadingProgress(
  current,
  total
) {
  const element =
    document.getElementById(
      "skills-loading"
    );

  if (!element) {
    return;
  }

  element.textContent =
    `در حال تحلیل مهارت‌های ${current} از ${total} آگهی...`;
}


function showSkillLoading(total) {
  const container =
    document.getElementById(
      "skills-analysis"
    );

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="skills-loading-box">
      <div
        id="skills-loading"
        class="skills-loading"
      >
        در حال تحلیل مهارت‌های ${total} آگهی...
      </div>
    </div>
  `;
}


function renderSkillAnalysis(
  analysis,
  totalJobs
) {
  const container =
    document.getElementById(
      "skills-analysis"
    );

  if (!container) {
    return;
  }

  const {
    skills,
    analyzedJobs,
  } = analysis;

  if (
    analyzedJobs === 0 ||
    skills.length === 0
  ) {
    container.innerHTML = `
      <div class="skills-empty">
        اطلاعات مهارت برای آگهی‌های این جستجو پیدا نشد.
      </div>
    `;

    return;
  }

  const topSkills =
    skills.slice(0, 15);

  const rows = topSkills
    .map((skill) => {
      const percentage =
        skill.percentage.toFixed(1);

      return `
        <div class="skill-row">
          <div class="skill-row-header">
            <span class="skill-name">
              ${escapeHtml(skill.name)}
            </span>

            <span class="skill-percentage">
              ${skill.count} آگهی
              (${percentage}%)
            </span>
          </div>

          <div class="skill-bar-background">
            <div
              class="skill-bar"
              style="width: ${Math.min(
                skill.percentage,
                100
              )}%"
            ></div>
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="skills-summary">
      <strong>
        ${analyzedJobs} از ${totalJobs} آگهی
      </strong>
      برای تحلیل مهارت بررسی شدند.
    </div>

    <div class="skills-list">
      ${rows}
    </div>
  `;
}


// ============================================================
// Search
// ============================================================

async function doSearch(keyword) {
  const normalizedKeyword =
    String(keyword ?? "").trim();

  if (!normalizedKeyword) {
    return;
  }

  const resultsContainer =
    document.getElementById(
      "search-results"
    );

  if (resultsContainer) {
    resultsContainer.innerHTML = `
      <div class="loading">
        در حال دریافت آگهی‌ها...
      </div>
    `;
  }

  try {
    const jobs =
      await liveSearch(
        normalizedKeyword
      );

    currentSearchResults = jobs;
    ALL_JOBS = jobs;

    renderSearchResults(jobs);

    /*
     * Start skill analysis after the main
     * search results are available.
     */
    analyzeSearchSkills(jobs);
  } catch (error) {
    console.error(error);

    /*
     * Fallback to cached data.
     */
    const lowerKeyword =
      normalizedKeyword.toLowerCase();

    const cached =
      ALL_JOBS.filter((job) => {
        const title =
          String(job.title ?? "")
            .toLowerCase();

        const company =
          String(job.company ?? "")
            .toLowerCase();

        return (
          title.includes(lowerKeyword) ||
          company.includes(lowerKeyword)
        );
      });

    currentSearchResults = cached;

    renderSearchResults(cached);

    analyzeSearchSkills(cached);
  }
}


// ============================================================
// Skill Analysis Pipeline
// ============================================================

async function analyzeSearchSkills(
  jobs
) {
  const validJobs =
    jobs.filter((job) => job.id);

  if (!validJobs.length) {
    renderSkillAnalysis(
      {
        skills: [],
        analyzedJobs: 0,
      },
      0
    );

    return;
  }

  showSkillLoading(
    validJobs.length
  );

  const jobIds =
    validJobs.map(
      (job) => job.id
    );

  const details =
    await fetchJobDetails(jobIds);

  const analysis =
    aggregateSkills(details);

  renderSkillAnalysis(
    analysis,
    validJobs.length
  );
}


// ============================================================
// Search Results
// ============================================================

function renderSearchResults(jobs) {
  const container =
    document.getElementById(
      "search-results"
    );

  if (!container) {
    return;
  }

  if (!jobs.length) {
    container.innerHTML = `
      <div class="empty">
        آگهی‌ای پیدا نشد.
      </div>
    `;

    return;
  }

  const rows = jobs
    .map((j) => {
      const jobUrl =
        `https://jobvision.ir/jobs/${encodeURIComponent(
          j.id
        )}?utm_source=github&utm_medium=jobvision_market_analysis&utm_campaign=zanko`;

      return `
        <tr>
          <td>
            <a
              href="${jobUrl}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${escapeHtml(j.title)}
            </a>
          </td>

          <td>
            ${escapeHtml(j.company)}
          </td>

          <td>
            ${escapeHtml(j.city)}
          </td>

          <td>
            ${escapeHtml(j.seniority)}
          </td>

          <td>
            ${escapeHtml(j.work_type)}
          </td>

          <td>
            ${escapeHtml(j.salary)}
          </td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="results-count">
      ${jobs.length} آگهی
    </div>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>عنوان شغلی</th>
            <th>شرکت</th>
            <th>شهر</th>
            <th>سطح</th>
            <th>نوع همکاری</th>
            <th>حقوق</th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}


// ============================================================
// Overview: Metrics
// ============================================================

function renderMetrics(jobs) {
  const container =
    document.getElementById("metrics");

  if (!container) {
    return;
  }

  const totalJobs = jobs.length;

  const companies = new Set(
    jobs
      .map((job) => job.company)
      .filter(Boolean)
  ).size;

  const provinces = new Set(
    jobs
      .map((job) => job.province)
      .filter(Boolean)
  ).size;

  const remoteJobs = jobs.filter(
    (job) => job.is_remote
  ).length;

  const metrics = [
    { label: "💼 کل آگهی‌ها", value: totalJobs },
    { label: "🏢 کارفرمایان", value: companies },
    { label: "📍 استان‌ها", value: provinces },
    { label: "🌐 آگهی‌های ریموت", value: remoteJobs },
  ];

  container.innerHTML = metrics
    .map(
      (metric) => `
        <div class="metric-card">
          <div class="value">
            ${metric.value.toLocaleString("fa-IR")}
          </div>
          <div class="label">
            ${metric.label}
          </div>
        </div>
      `
    )
    .join("");
}


// ============================================================
// Overview: Carousel
// ============================================================

function renderCarousel(jobs, limit = 20) {
  const container =
    document.getElementById("job-carousel");

  if (!container) {
    return;
  }

  const sorted = [...jobs].sort((a, b) => {
    const dateA = new Date(a.activation_date ?? 0).getTime() || 0;
    const dateB = new Date(b.activation_date ?? 0).getTime() || 0;

    return dateB - dateA;
  });

  const cards = sorted
    .slice(0, limit)
    .map((job) => {
      const metaParts = [];

      if (job.province) {
        metaParts.push(`📍 ${escapeHtml(job.province)}`);
      }

      if (job.work_type) {
        metaParts.push(`💼 ${escapeHtml(job.work_type)}`);
      }

      if (job.seniority) {
        metaParts.push(`🎯 ${escapeHtml(job.seniority)}`);
      }

      if (job.is_remote) {
        metaParts.push("🌐 ریموت");
      }

      const metaHtml = metaParts
        .map((item) => `<div class="job-meta">${item}</div>`)
        .join("");

      return `
        <div class="job-card">
          <div class="job-title">
            ${escapeHtml(job.title || "بدون عنوان")}
          </div>
          <div class="job-company">
            🏢 ${escapeHtml(job.company || "نامشخص")}
          </div>
          ${metaHtml}
        </div>
      `;
    })
    .join("");

  container.innerHTML = cards;
}


// ============================================================
// Charts
// ============================================================

function countValues(
  jobs,
  getter
) {
  const counts = {};

  for (const job of jobs) {
    const value =
      getter(job);

    if (!value) {
      continue;
    }

    const key =
      String(value).trim();

    if (!key) {
      continue;
    }

    counts[key] =
      (counts[key] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1]);
}


function makeBarChart(
  canvasId,
  labels,
  values,
  label
) {
  const canvas =
    document.getElementById(
      canvasId
    );

  if (!canvas) {
    return;
  }

  if (
    typeof Chart ===
    "undefined"
  ) {
    return;
  }

  /*
   * Destroy previous chart.
   */
  if (canvas._chart) {
    canvas._chart.destroy();
  }

  canvas._chart =
    new Chart(canvas, {
      type: "bar",

      data: {
        labels,

        datasets: [
          {
            label,
            data: values,
          },
        ],
      },

      options: {
        responsive: true,

        plugins: {
          legend: {
            display: false,
          },
        },

        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    });
}


function renderCharts(jobs) {
  const companies =
    countValues(
      jobs,
      (job) => job.company
    ).slice(0, 10);

  makeBarChart(
    "company-chart",
    companies.map(
      ([name]) => name
    ),
    companies.map(
      ([, count]) => count
    ),
    "تعداد آگهی"
  );


  const locations =
    countValues(
      jobs,
      (job) =>
        job.city ||
        job.province
    ).slice(0, 10);

  makeBarChart(
    "location-chart",
    locations.map(
      ([name]) => name
    ),
    locations.map(
      ([, count]) => count
    ),
    "تعداد آگهی"
  );


  const seniorities =
    countValues(
      jobs,
      (job) => job.seniority
    );

  makeBarChart(
    "seniority-chart",
    seniorities.map(
      ([name]) => name
    ),
    seniorities.map(
      ([, count]) => count
    ),
    "تعداد آگهی"
  );


  const workTypes =
    countValues(
      jobs,
      (job) => job.work_type
    );

  makeBarChart(
    "work-type-chart",
    workTypes.map(
      ([name]) => name
    ),
    workTypes.map(
      ([, count]) => count
    ),
    "تعداد آگهی"
  );
}


// ============================================================
// Overview: Orchestration
// ============================================================

function renderOverview(jobs) {
  renderMetrics(jobs);
  renderCarousel(jobs);
  renderCharts(jobs);
}


function setUpdatedAt(generatedAt, count) {
  const element =
    document.getElementById("updatedAt");

  if (!element) {
    return;
  }

  const parts = [];

  if (count) {
    parts.push(
      `${Number(count).toLocaleString("fa-IR")} آگهی`
    );
  }

  if (generatedAt) {
    const date = new Date(generatedAt);

    if (!Number.isNaN(date.getTime())) {
      parts.push(
        `به‌روزرسانی: ${date.toLocaleString("fa-IR")}`
      );
    }
  }

  element.textContent = parts.join(" • ");
}


async function loadOverviewData() {
  const loadingElement =
    document.getElementById("loading");

  const overviewSection =
    document.getElementById("overview-section");

  try {
    const response = await fetch(DATA_URL);

    if (!response.ok) {
      throw new Error(
        `Failed to load ${DATA_URL}: ${response.status}`
      );
    }

    const payload = await response.json();

    const rawJobs = Array.isArray(payload)
      ? payload
      : payload.jobs ?? [];

    const jobs = rawJobs.map(rawJobToRecord);

    OVERVIEW_JOBS = jobs;
    ALL_JOBS = jobs;

    setUpdatedAt(
      payload?.generated_at,
      payload?.count ?? jobs.length
    );

    renderOverview(jobs);

    if (loadingElement) {
      loadingElement.remove();
    }

    if (overviewSection) {
      overviewSection.classList.remove("hidden");
    }
  } catch (error) {
    console.error(
      "Failed to load overview data:",
      error
    );

    if (loadingElement) {
      loadingElement.textContent =
        "خطا در بارگذاری داده‌ها. لطفاً صفحه را دوباره بارگذاری کنید.";
    }
  }
}


// ============================================================
// Initialization
// ============================================================

document.addEventListener(
  "DOMContentLoaded",
  () => {
    const searchForm =
      document.getElementById(
        "search-form"
      );

    const searchInput =
      document.getElementById(
        "search-input"
      );

    const backBtn =
      document.getElementById("backBtn");

    const overviewSection =
      document.getElementById(
        "overview-section"
      );

    const searchSection =
      document.getElementById(
        "search-section"
      );

    if (searchForm && searchInput) {
      searchForm.addEventListener(
        "submit",
        async (event) => {
          event.preventDefault();

          const keyword = searchInput.value.trim();

          if (!keyword) {
            return;
          }

          if (overviewSection) {
            overviewSection.classList.add("hidden");
          }

          if (searchSection) {
            searchSection.classList.remove("hidden");
          }

          if (backBtn) {
            backBtn.classList.remove("hidden");
          }

          await doSearch(keyword);
        }
      );
    }

    if (backBtn) {
      backBtn.addEventListener(
        "click",
        () => {
          ALL_JOBS = OVERVIEW_JOBS;

          if (searchInput) {
            searchInput.value = "";
          }

          if (searchSection) {
            searchSection.classList.add("hidden");
          }

          if (overviewSection) {
            overviewSection.classList.remove("hidden");
          }

          backBtn.classList.add("hidden");
        }
      );
    }

    loadOverviewData();
  }
);