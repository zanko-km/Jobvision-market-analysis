const JOBVISION_API = "https://late-recipe-0638.zankokarimy.workers.dev";
const PAGE_SIZE = 30;
const SEARCH_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 10;
const DATA_URL = "data/jobs.json";

let OVERVIEW_JOBS = [];
let currentSearchResults = [];
let currentSearchToken = 0;

const jobDetailCache = new Map();
const charts = [];

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function countBy(items, getter) {
  const map = new Map();

  for (const item of items) {
    const value = normalizeText(getter(item));

    if (!value) {
      continue;
    }

    map.set(value, (map.get(value) || 0) + 1);
  }

  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      count
    }));
}

function destroyCharts() {
  while (charts.length) {
    const chart = charts.pop();

    try {
      chart.destroy();
    } catch {}
  }
}

function createChart(canvasId, type, labels, data, options = {}) {
  const canvas = $(canvasId);

  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  const chart = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [
        {
          data
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: type === "doughnut"
        }
      },
      ...options
    }
  });

  charts.push(chart);
}

function parseSalary(value) {
  const text = normalizeText(value);

  if (!text) {
    return [];
  }

  const matches = [];
  const regex = /(\d+(?:\.\d+)?)\s*(هزار|میلیون|میلیارد)?/gi;

  for (const match of text.matchAll(regex)) {
    const number = Number(match[1]);
    const unit = match[2] || "";

    if (!Number.isFinite(number)) {
      continue;
    }

    let multiplier = 1;

    if (unit === "هزار") {
      multiplier = 1000;
    } else if (unit === "میلیون") {
      multiplier = 1000000;
    } else if (unit === "میلیارد") {
      multiplier = 1000000000;
    }

    matches.push(number * multiplier);
  }

  return matches;
}

function calculateAverageSalary(jobs) {
  const values = [];

  for (const job of jobs) {
    values.push(...parseSalary(job.salary));
  }

  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatSalary(value) {
  if (!Number.isFinite(value)) {
    return "نامشخص";
  }

  if (value >= 1000000000) {
    return `${(value / 1000000000).toFixed(1)} میلیارد`;
  }

  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)} میلیون`;
  }

  if (value >= 1000) {
    return `${Math.round(value / 1000)} هزار`;
  }

  return Math.round(value).toLocaleString("fa-IR");
}

function getUniqueJobs(jobs) {
  const map = new Map();

  for (const job of jobs) {
    if (!job) {
      continue;
    }

    const id = job.id;

    if (id !== undefined && id !== null && id !== "") {
      map.set(String(id), job);
    }
  }

  return [...map.values()];
}

function rawJobToRecord(job) {
  const properties = job?.properties || {};
  const company = job?.company || {};
  const location = job?.location || {};
  const province = location?.province || {};
  const city = location?.city || {};
  const workType = job?.workType || {};
  const seniority = job?.seniorityLevel || {};
  const salary = job?.salary || {};
  const activationTime = job?.activationTime || {};

  return {
    id: job?.id,
    title: job?.title || "",
    company: company?.nameFa || "",
    province: province?.titleFa || "",
    city: city?.titleFa || "",
    categories: (job?.jobCategories || [])
      .map((item) => item?.titleFa)
      .filter(Boolean)
      .join(", "),
    work_type: workType?.titleFa || "",
    seniority: seniority?.titleFa || "",
    is_remote: Boolean(properties?.isRemote),
    salary: salary?.titleFa || "",
    activation_date: activationTime?.date || ""
  };
}

function showSection(sectionId) {
  const overview = $("overview-section");
  const search = $("search-section");

  overview?.classList.add("hidden");
  search?.classList.add("hidden");

  $(sectionId)?.classList.remove("hidden");
}

function clearSearchPositions() {
  document.querySelector(".search-positions")?.remove();
}

function showSearchLoading() {
  const searchResults = $("search-results");

  if (!searchResults) {
    return;
  }

  clearSearchPositions();

  searchResults.innerHTML = `
    <div class="loading-message">
      در حال جستجو در JobVision...
    </div>
  `;

  $("skills-analysis").innerHTML = `
    <div class="skills-empty">
      در حال دریافت و تحلیل مهارت‌های موردنیاز...
    </div>
  `;
}

function showSearchError(message) {
  const searchResults = $("search-results");

  if (!searchResults) {
    return;
  }

  searchResults.innerHTML = `
    <div class="error-message">
      ${escapeHtml(message)}
    </div>
  `;
}

async function fetchWithTimeout(url, options = {}, timeout = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSearchPage(keyword, page) {
  const response = await fetchWithTimeout(JOBVISION_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jobCategoryUrlTitle: null,
      keyword,
      locationWrapper: null,
      pageSize: PAGE_SIZE,
      requestedPage: page,
      sortBy: 1,
      searchId: null
    })
  });

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status}`);
  }

  const json = await response.json();

  if (!json?.data) {
    throw new Error("Invalid search response");
  }

  return json.data;
}

async function liveSearch(keyword) {
  const firstPage = await fetchSearchPage(keyword, 1);

  const total = Number(firstPage?.jobPostCount || 0);
  const firstJobs = Array.isArray(firstPage?.jobPosts)
    ? firstPage.jobPosts.map(rawJobToRecord)
    : [];

  if (!firstJobs.length) {
    return {
      jobs: [],
      total
    };
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const allJobs = [...firstJobs];

  for (let page = 2; page <= totalPages; page++) {
    try {
      const pageData = await fetchSearchPage(keyword, page);

      const jobs = Array.isArray(pageData?.jobPosts)
        ? pageData.jobPosts.map(rawJobToRecord)
        : [];

      allJobs.push(...jobs);

      if (jobs.length < PAGE_SIZE) {
        break;
      }
    } catch {
      break;
    }
  }

  return {
    jobs: getUniqueJobs(allJobs),
    total
  };
}

async function fetchJobDetail(jobId) {
  const key = String(jobId);

  if (jobDetailCache.has(key)) {
    return jobDetailCache.get(key);
  }

  const promise = fetchWithTimeout(
    `${JOBVISION_API}/job-detail?id=${encodeURIComponent(jobId)}`,
    {},
    SEARCH_TIMEOUT_MS
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Detail request failed: ${response.status}`);
      }

      const json = await response.json();

      return json?.data ?? json;
    })
    .catch(() => null);

  jobDetailCache.set(key, promise);

  return promise;
}

function extractSkills(detail) {
  const skills = [];

  function collect(value) {
    if (!value) {
      return;
    }

    if (typeof value === "string") {
      const text = normalizeText(value);

      if (text) {
        skills.push(text);
      }

      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collect(item);
      }

      return;
    }

    if (typeof value === "object") {
      const preferredKeys = [
        "titleFa",
        "nameFa",
        "title",
        "name",
        "skillName",
        "skill",
        "text"
      ];

      for (const key of preferredKeys) {
        if (value[key]) {
          collect(value[key]);
        }
      }
    }
  }

  const candidates = [
    detail?.skills,
    detail?.jobSkills,
    detail?.requiredSkills,
    detail?.properties?.skills,
    detail?.jobPost?.skills,
    detail?.jobPost?.jobSkills,
    detail?.data?.skills
  ];

  for (const candidate of candidates) {
    collect(candidate);
  }

  return skills
    .flatMap((skill) =>
      skill
        .split(/[,،|]/)
        .map((item) => normalizeText(item))
    )
    .filter(Boolean);
}

async function fetchJobSkills(job) {
  if (!job?.id) {
    return [];
  }

  const detail = await fetchJobDetail(job.id);

  if (!detail) {
    return [];
  }

  return extractSkills(detail);
}

async function fetchAllJobSkills(jobs, token) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      if (token !== currentSearchToken) {
        return;
      }

      const index = nextIndex++;

      if (index >= jobs.length) {
        return;
      }

      const skills = await fetchJobSkills(jobs[index]);

      results[index] = {
        job: jobs[index],
        skills
      };

      updateSkillsProgress(results.filter(Boolean).length, jobs.length);
    }
  }

  const workers = Array.from(
    {
      length: Math.min(DETAIL_CONCURRENCY, jobs.length)
    },
    () => worker()
  );

  await Promise.all(workers);

  return results.filter(Boolean);
}

function updateSkillsProgress(completed, total) {
  const container = $("skills-analysis");

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="skills-loading">
      در حال تحلیل مهارت‌ها...
      <strong>${completed.toLocaleString("fa-IR")}</strong>
      از
      <strong>${total.toLocaleString("fa-IR")}</strong>
      آگهی بررسی شده است.
    </div>
  `;
}

function renderSkillsAnalysis(results) {
  const container = $("skills-analysis");

  if (!container) {
    return;
  }

  const skillCounts = new Map();

  for (const result of results) {
    for (const skill of result.skills) {
      const normalized = normalizeText(skill);

      if (!normalized) {
        continue;
      }

      skillCounts.set(
        normalized,
        (skillCounts.get(normalized) || 0) + 1
      );
    }
  }

  const skills = [...skillCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  if (!skills.length) {
    container.innerHTML = `
      <div class="skills-empty">
        مهارتی در جزئیات آگهی‌های این جستجو پیدا نشد.
      </div>
    `;

    return;
  }

  const maxCount = skills[0][1];

  container.innerHTML = `
    <div class="skills-summary">
      <div class="skill-count">
        ${skills.length.toLocaleString("fa-IR")}
        مهارت پرتکرار
      </div>

      <div class="skill-count">
        ${results.length.toLocaleString("fa-IR")}
        آگهی تحلیل‌شده
      </div>
    </div>

    <div class="skills-list">
      ${skills
        .map(([skill, count]) => {
          const percentage = Math.max(
            5,
            Math.round((count / maxCount) * 100)
          );

          return `
            <div class="skill-item">
              <div class="skill-header">
                <span>${escapeHtml(skill)}</span>
                <strong>${count.toLocaleString("fa-IR")}</strong>
              </div>

              <div class="skill-bar">
                <div
                  class="skill-bar-fill"
                  style="width: ${percentage}%"
                ></div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

async function analyzeSearchSkills(jobs, token) {
  if (!jobs.length) {
    $("skills-analysis").innerHTML = `
      <div class="skills-empty">
        آگهی‌ای برای تحلیل مهارت وجود ندارد.
      </div>
    `;

    return;
  }

  updateSkillsProgress(0, jobs.length);

  const results = await fetchAllJobSkills(jobs, token);

  if (token !== currentSearchToken) {
    return;
  }

  renderSkillsAnalysis(results);
}

function renderMetrics(jobs, total = jobs.length) {
  const metrics = $("metrics");

  if (!metrics) {
    return;
  }

  const companies = new Set(
    jobs
      .map((job) => normalizeText(job.company))
      .filter(Boolean)
  );

  const cities = new Set(
    jobs
      .map((job) => normalizeText(job.city))
      .filter(Boolean)
  );

  const averageSalary = calculateAverageSalary(jobs);

  metrics.innerHTML = `
    <div class="metric-card">
      <span class="metric-value">
        ${jobs.length.toLocaleString("fa-IR")}
      </span>
      <span class="metric-label">
        آگهی بارگذاری‌شده
      </span>
    </div>

    <div class="metric-card">
      <span class="metric-value">
        ${total.toLocaleString("fa-IR")}
      </span>
      <span class="metric-label">
        کل نتایج
      </span>
    </div>

    <div class="metric-card">
      <span class="metric-value">
        ${companies.size.toLocaleString("fa-IR")}
      </span>
      <span class="metric-label">
        شرکت
      </span>
    </div>

    <div class="metric-card">
      <span class="metric-value">
        ${cities.size.toLocaleString("fa-IR")}
      </span>
      <span class="metric-label">
        شهر
      </span>
    </div>

    <div class="metric-card">
      <span class="metric-value">
        ${averageSalary ? formatSalary(averageSalary) : "—"}
      </span>
      <span class="metric-label">
        میانگین حقوق
      </span>
    </div>
  `;
}

function renderSearchCharts(jobs) {
  destroyCharts();

  const companies = countBy(jobs, (job) => job.company).slice(0, 10);
  const locations = countBy(
    jobs,
    (job) => job.city || job.province
  ).slice(0, 10);
  const seniority = countBy(jobs, (job) => job.seniority);
  const workTypes = countBy(jobs, (job) => job.work_type);

  createChart(
    "company-chart",
    "bar",
    companies.map((item) => item.label),
    companies.map((item) => item.count),
    {
      indexAxis: "y"
    }
  );

  createChart(
    "location-chart",
    "bar",
    locations.map((item) => item.label),
    locations.map((item) => item.count),
    {
      indexAxis: "y"
    }
  );

  createChart(
    "seniority-chart",
    "doughnut",
    seniority.map((item) => item.label),
    seniority.map((item) => item.count)
  );

  createChart(
    "work-type-chart",
    "doughnut",
    workTypes.map((item) => item.label),
    workTypes.map((item) => item.count)
  );
}

function renderSearchResults(jobs, keyword, total, fallback = false) {
  const searchResults = $("search-results");

  if (!searchResults) {
    return;
  }

  renderMetrics(jobs, total);

  const averageSalary = calculateAverageSalary(jobs);

  searchResults.innerHTML = `
    <div class="search-heading">
      <h2>
        نتایج جستجو برای «${escapeHtml(keyword)}»
      </h2>

      <p>
        ${jobs.length.toLocaleString("fa-IR")}
        آگهی بارگذاری شد
        ${
          total > jobs.length
            ? `از ${total.toLocaleString("fa-IR")} نتیجه`
            : ""
        }
      </p>

      ${
        fallback
          ? `
            <div class="fallback-message">
              اطلاعات زنده در دسترس نبود؛ نتایج ذخیره‌شده نمایش داده می‌شوند.
            </div>
          `
          : ""
      }
    </div>

    <div class="search-metrics">
      <div class="metric-card">
        <span class="metric-value">
          ${jobs.length.toLocaleString("fa-IR")}
        </span>
        <span class="metric-label">
          آگهی
        </span>
      </div>

      <div class="metric-card">
        <span class="metric-value">
          ${new Set(jobs.map((job) => job.company).filter(Boolean)).size.toLocaleString("fa-IR")}
        </span>
        <span class="metric-label">
          شرکت
        </span>
      </div>

      <div class="metric-card">
        <span class="metric-value">
          ${averageSalary ? formatSalary(averageSalary) : "—"}
        </span>
        <span class="metric-label">
          میانگین حقوق
        </span>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-box">
        <h3>🏢 برترین شرکت‌ها</h3>
        <canvas id="company-chart"></canvas>
      </div>

      <div class="chart-box">
        <h3>📍 موقعیت‌های جغرافیایی</h3>
        <canvas id="location-chart"></canvas>
      </div>

      <div class="chart-box">
        <h3>🎯 سطح شغلی</h3>
        <canvas id="seniority-chart"></canvas>
      </div>

      <div class="chart-box">
        <h3>📋 نوع همکاری</h3>
        <canvas id="work-type-chart"></canvas>
      </div>
    </div>
  `;

  renderSearchCharts(jobs);
}

function renderSearchTable(jobs) {
  const visibleJobs = jobs.slice(0, 200);

  if (!visibleJobs.length) {
    return `
      <div class="empty-message">
        آگهی‌ای پیدا نشد.
      </div>
    `;
  }

  return `
    <div class="table-wrapper">
      <table class="jobs-table">
        <thead>
          <tr>
            <th>عنوان شغلی</th>
            <th>شرکت</th>
            <th>شهر</th>
            <th>سطح</th>
            <th>نوع همکاری</th>
            <th>حقوق</th>
            <th>لینک</th>
          </tr>
        </thead>

        <tbody>
          ${visibleJobs
            .map((job) => {
              const jobUrl = `https://jobvision.ir/jobs/${encodeURIComponent(job.id)}?utm_source=github&utm_medium=jobvision_market_analysis&utm_campaign=zanko`;

              return `
                <tr>
                  <td>${escapeHtml(job.title)}</td>
                  <td>${escapeHtml(job.company)}</td>
                  <td>
                    ${escapeHtml(job.city || job.province || "—")}
                  </td>
                  <td>${escapeHtml(job.seniority || "—")}</td>
                  <td>${escapeHtml(job.work_type || "—")}</td>
                  <td>${escapeHtml(job.salary || "—")}</td>
                  <td>
                    <a
                      href="${jobUrl}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      مشاهده
                    </a>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>

    ${
      jobs.length > 200
        ? `
          <div class="table-limit">
            ۲۰۰ آگهی اول نمایش داده شده‌اند.
            تحلیل‌ها بر اساس تمام
            ${jobs.length.toLocaleString("fa-IR")}
            آگهی انجام شده است.
          </div>
        `
        : ""
    }
  `;
}

async function doSearch(keyword) {
  const searchToken = ++currentSearchToken;

  currentSearchResults = [];
  clearSearchPositions();
  destroyCharts();

  showSection("search-section");
  showSearchLoading();

  try {
    const result = await liveSearch(keyword);

    if (searchToken !== currentSearchToken) {
      return;
    }

    if (!result.jobs.length) {
      showSearchError("برای این عبارت شغلی نتیجه‌ای پیدا نشد.");
      $("skills-analysis").innerHTML = `
        <div class="skills-empty">
          آگهی‌ای برای تحلیل مهارت وجود ندارد.
        </div>
      `;
      return;
    }

    currentSearchResults = result.jobs;

    renderSearchResults(
      result.jobs,
      keyword,
      result.total,
      false
    );

    await analyzeSearchSkills(
      result.jobs,
      searchToken
    );

    if (searchToken !== currentSearchToken) {
      return;
    }

    const searchSection = $("search-section");

    const positions = document.createElement("div");
    positions.className = "search-positions";

    positions.innerHTML = `
      <div class="section-title">
        💼 پوزیشن‌های شغلی
      </div>

      ${renderSearchTable(result.jobs)}
    `;

    searchSection.appendChild(positions);
  } catch {
    if (searchToken !== currentSearchToken) {
      return;
    }

    if (!OVERVIEW_JOBS.length) {
      showSearchError(
        "جستجو انجام نشد. لطفاً دوباره تلاش کنید."
      );

      return;
    }

    const fallbackJobs = OVERVIEW_JOBS.filter((job) => {
      const text = [
        job.title,
        job.company,
        job.categories
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(keyword.toLowerCase());
    });

    currentSearchResults = fallbackJobs;

    renderSearchResults(
      fallbackJobs,
      keyword,
      fallbackJobs.length,
      true
    );

    $("skills-analysis").innerHTML = `
      <div class="skills-empty">
        تحلیل مهارت در حالت داده‌های ذخیره‌شده در دسترس نیست.
      </div>
    `;

    const searchSection = $("search-section");

    const positions = document.createElement("div");
    positions.className = "search-positions";

    positions.innerHTML = `
      <div class="section-title">
        💼 پوزیشن‌های شغلی
      </div>

      ${renderSearchTable(fallbackJobs)}
    `;

    searchSection.appendChild(positions);
  }
}

function renderOverviewMetrics(jobs) {
  const metrics = $("metrics");

  if (!metrics) {
    return;
  }

  const companies = new Set(
    jobs.map((job) => job.company).filter(Boolean)
  );

  const averageSalary = calculateAverageSalary(jobs);

  metrics.innerHTML = `
    <div class="metric-card">
      <span class="metric-value">
        ${jobs.length.toLocaleString("fa-IR")}
      </span>
      <span class="metric-label">
        آگهی
      </span>
    </div>

    <div class="metric-card">
      <span class="metric-value">
        ${companies.size.toLocaleString("fa-IR")}
      </span>
      <span class="metric-label">
        شرکت
      </span>
    </div>

    <div class="metric-card">
      <span class="metric-value">
        ${new Set(jobs.map((job) => job.city).filter(Boolean)).size.toLocaleString("fa-IR")}
      </span>
      <span class="metric-label">
        شهر
      </span>
    </div>

    <div class="metric-card">
      <span class="metric-value">
        ${averageSalary ? formatSalary(averageSalary) : "—"}
      </span>
      <span class="metric-label">
        میانگین حقوق
      </span>
    </div>
  `;
}

function renderOverviewCarousel(jobs) {
  const carousel = $("job-carousel");

  if (!carousel) {
    return;
  }

  const latestJobs = jobs.slice(0, 12);

  carousel.innerHTML = latestJobs
    .map((job) => {
      const jobUrl = `https://jobvision.ir/jobs/${encodeURIComponent(job.id)}?utm_source=github&utm_medium=jobvision_market_analysis&utm_campaign=zanko`;

      return `
        <article class="job-card">
          <h3>${escapeHtml(job.title)}</h3>

          <p>
            🏢 ${escapeHtml(job.company || "نامشخص")}
          </p>

          <p>
            📍 ${escapeHtml(job.city || job.province || "نامشخص")}
          </p>

          <p>
            🎯 ${escapeHtml(job.seniority || "نامشخص")}
          </p>

          <a
            href="${jobUrl}"
            target="_blank"
            rel="noopener noreferrer"
          >
            مشاهده آگهی
          </a>
        </article>
      `;
    })
    .join("");
}

function renderOverviewCharts(jobs) {
  destroyCharts();

  const companies = countBy(
    jobs,
    (job) => job.company
  ).slice(0, 10);

  const locations = countBy(
    jobs,
    (job) => job.city || job.province
  ).slice(0, 10);

  const seniority = countBy(
    jobs,
    (job) => job.seniority
  );

  const workTypes = countBy(
    jobs,
    (job) => job.work_type
  );

  createChart(
    "company-chart",
    "bar",
    companies.map((item) => item.label),
    companies.map((item) => item.count),
    {
      indexAxis: "y"
    }
  );

  createChart(
    "location-chart",
    "bar",
    locations.map((item) => item.label),
    locations.map((item) => item.count),
    {
      indexAxis: "y"
    }
  );

  createChart(
    "seniority-chart",
    "doughnut",
    seniority.map((item) => item.label),
    seniority.map((item) => item.count)
  );

  createChart(
    "work-type-chart",
    "doughnut",
    workTypes.map((item) => item.label),
    workTypes.map((item) => item.count)
  );
}

function renderOverview(jobs) {
  OVERVIEW_JOBS = getUniqueJobs(jobs);

  renderOverviewMetrics(OVERVIEW_JOBS);
  renderOverviewCarousel(OVERVIEW_JOBS);
  renderOverviewCharts(OVERVIEW_JOBS);

  showSection("overview-section");

  const updatedAt = $("updatedAt");

  if (updatedAt) {
    updatedAt.textContent =
      `تعداد ${OVERVIEW_JOBS.length.toLocaleString("fa-IR")} آگهی`;
  }
}

async function loadOverviewData() {
  const loading = $("loading");

  try {
    const response = await fetch(DATA_URL);

    if (!response.ok) {
      throw new Error("Failed to load overview data");
    }

    const data = await response.json();

    const jobs = Array.isArray(data)
      ? data
      : Array.isArray(data?.jobs)
        ? data.jobs
        : [];

    renderOverview(jobs);
  } catch {
    if (loading) {
      loading.textContent =
        "بارگذاری داده‌ها انجام نشد.";
    }

    return;
  }

  loading?.classList.add("hidden");
}

function showOverview() {
  currentSearchToken++;

  clearSearchPositions();
  destroyCharts();

  $("search-section")?.classList.add("hidden");
  $("overview-section")?.classList.remove("hidden");

  if (OVERVIEW_JOBS.length) {
    renderOverview(OVERVIEW_JOBS);
  }
}

function initialize() {
  const searchForm = $("search-form");
  const searchInput = $("search-input");
  const backButton = $("backBtn");

  searchForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const keyword = normalizeText(searchInput?.value);

    if (!keyword) {
      return;
    }

    backButton?.classList.remove("hidden");

    await doSearch(keyword);
  });

  backButton?.addEventListener("click", () => {
    backButton.classList.add("hidden");
    showOverview();
  });

  loadOverviewData();
}

document.addEventListener("DOMContentLoaded", initialize);