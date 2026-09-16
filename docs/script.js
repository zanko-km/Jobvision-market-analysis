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

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char]
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (digit) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
    )
    .replace(/[٠-٩]/g, (digit) =>
      String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    );
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString("fa-IR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) {
    return "0%";
  }

  return `${Number(value).toFixed(1)}%`;
}

function destroyCharts() {
  while (charts.length) {
    const chart = charts.pop();

    try {
      chart.destroy();
    } catch (error) {
      console.warn("Failed to destroy chart:", error);
    }
  }
}

function countValues(jobs, getter, limit = null) {
  const counts = new Map();

  for (const job of jobs) {
    const value = normalizeText(getter(job));

    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) || 0) + 1);
  }

  const entries = [...counts.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  return limit ? entries.slice(0, limit) : entries;
}

function makeBarChart(container, title, entries) {
  if (!container || !entries.length) {
    return;
  }

  const box = document.createElement("div");
  box.className = "chart-box";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const canvas = document.createElement("canvas");

  box.appendChild(heading);
  box.appendChild(canvas);
  container.appendChild(box);

  const ctx = canvas.getContext("2d");

  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: entries.map(([label]) => label),
      datasets: [
        {
          label: title,
          data: entries.map(([, count]) => count),
          backgroundColor: "#ff4b4b",
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          beginAtZero: true,
        },
      },
    },
  });

  charts.push(chart);
}

function parseSalary(value) {
  if (value === null || value === undefined) {
    return null;
  }

  let text = normalizeDigits(String(value));

  text = text
    .replace(/,/g, "")
    .replace(/،/g, "")
    .replace(/٬/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  if (
    lower.includes("توافقی") ||
    lower.includes("negotiable")
  ) {
    return null;
  }

  const numbers = [
    ...text.matchAll(
      /(\d+(?:\.\d+)?)\s*(هزار|میلیون|میلیارد)?/gi
    ),
  ].map((match) => ({
    value: Number(match[1]),
    unit: match[2] || "",
  }));

  if (!numbers.length) {
    return null;
  }

  function toMillion(item) {
    if (!Number.isFinite(item.value)) {
      return null;
    }

    const unit = item.unit;

    if (unit === "میلیارد") {
      return item.value * 1000;
    }

    if (unit === "هزار") {
      return item.value / 1000;
    }

    return item.value;
  }

  const values = numbers
    .map(toMillion)
    .filter(
      (value) =>
        value !== null &&
        Number.isFinite(value)
    );

  if (!values.length) {
    return null;
  }

  if (values.length >= 2) {
    return {
      min: values[0],
      max: values[1],
      average: (values[0] + values[1]) / 2,
    };
  }

  return {
    min: values[0],
    max: values[0],
    average: values[0],
  };
}

function salaryAnalysis(jobs) {
  const salaries = jobs
    .map((job) => parseSalary(job.salary))
    .filter(Boolean);

  if (!salaries.length) {
    return {
      count: 0,
      average: null,
      min: null,
      max: null,
      ranges: [],
    };
  }

  const averages = salaries.map((item) => item.average);

  const average =
    averages.reduce(
      (sum, value) => sum + value,
      0
    ) / averages.length;

  const min = Math.min(
    ...salaries.map((item) => item.min)
  );

  const max = Math.max(
    ...salaries.map((item) => item.max)
  );

  const ranges = [
    {
      label: "کمتر از ۲۰ میلیون",
      count: 0,
    },
    {
      label: "۲۰ تا ۳۰ میلیون",
      count: 0,
    },
    {
      label: "۳۰ تا ۴۰ میلیون",
      count: 0,
    },
    {
      label: "۴۰ تا ۵۰ میلیون",
      count: 0,
    },
    {
      label: "۵۰ میلیون به بالا",
      count: 0,
    },
  ];

  for (const salary of salaries) {
    const value = salary.average;

    if (value < 20) {
      ranges[0].count++;
    } else if (value < 30) {
      ranges[1].count++;
    } else if (value < 40) {
      ranges[2].count++;
    } else if (value < 50) {
      ranges[3].count++;
    } else {
      ranges[4].count++;
    }
  }

  return {
    count: salaries.length,
    average,
    min,
    max,
    ranges,
  };
}

async function fetchLivePage(keyword, page) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(
      JOBVISION_API,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          jobCategoryUrlTitle: null,
          keyword,
          locationWrapper: null,
          pageSize: PAGE_SIZE,
          requestedPage: page,
          sortBy: 1,
          searchId: null,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `JobVision API returned ${response.status}`
      );
    }

    const json = await response.json();

    if (!json?.data) {
      throw new Error(
        "Unexpected JobVision API response"
      );
    }

    return json.data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Search page ${page} timed out after ${
          SEARCH_TIMEOUT_MS / 1000
        } seconds`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    activation_date: activationTime?.date || "",
  };
}

async function liveSearch(keyword) {
  const first = await fetchLivePage(keyword, 1);

  const total = Number(
    first?.jobPostCount || 0
  );

  const totalPages = Math.ceil(
    total / PAGE_SIZE
  );

  let rawJobs = [
    ...(first?.jobPosts || []),
  ];

  for (
    let page = 2;
    page <= totalPages;
    page++
  ) {
    try {
      console.log(
        `Fetching JobVision page ${page}/${totalPages}...`
      );

      const pageData =
        await fetchLivePage(
          keyword,
          page
        );

      const pageJobs =
        Array.isArray(pageData?.jobPosts)
          ? pageData.jobPosts
          : [];

      rawJobs.push(...pageJobs);

      console.log(
        `JobVision page ${page}: ${pageJobs.length} jobs`
      );

      if (pageJobs.length < PAGE_SIZE) {
        break;
      }
    } catch (error) {
      console.warn(
        `Failed to fetch JobVision page ${page}:`,
        error
      );

      break;
    }
  }

  const seen = new Set();
  const uniqueJobs = [];

  for (const job of rawJobs) {
    if (!job?.id) {
      continue;
    }

    if (seen.has(job.id)) {
      continue;
    }

    seen.add(job.id);
    uniqueJobs.push(job);
  }

  return {
    total,
    jobs: uniqueJobs.map(rawJobToRecord),
  };
}

function normalizeSkillName(name) {
  return normalizeText(name);
}

function normalizeSkillKey(name) {
  return normalizeSkillName(name).toLowerCase();
}

async function fetchJobDetail(jobId) {
  if (jobDetailCache.has(jobId)) {
    return jobDetailCache.get(jobId);
  }

  try {
    const response = await fetch(
      `${JOBVISION_API}/job-detail?id=${encodeURIComponent(
        jobId
      )}`
    );

    if (!response.ok) {
      throw new Error(
        `Detail API returned ${response.status}`
      );
    }

    const data = await response.json();

    const result = {
      id: jobId,
      skills: Array.isArray(data?.skills)
        ? data.skills
        : [],
      failed: false,
    };

    jobDetailCache.set(jobId, result);

    return result;
  } catch (error) {
    console.warn(
      `Failed to fetch job ${jobId}:`,
      error
    );

    const result = {
      id: jobId,
      skills: [],
      failed: true,
    };

    jobDetailCache.set(jobId, result);

    return result;
  }
}

function updateSkillLoadingProgress(
  current,
  total
) {
  const element = $("skills-loading");

  if (!element) {
    return;
  }

  element.textContent =
    `در حال تحلیل مهارت‌های ${formatNumber(
      current
    )} از ${formatNumber(total)} آگهی...`;
}

function showSkillLoading(total) {
  const container = $("skills-analysis");

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="skills-loading-box">
      <div
        id="skills-loading"
        class="skills-loading"
      >
        در حال تحلیل مهارت‌های ${formatNumber(
          total
        )} آگهی...
      </div>
    </div>
  `;
}

async function fetchJobDetails(
  jobIds,
  searchToken
) {
  const results = new Array(jobIds.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= jobIds.length) {
        return;
      }

      const detail =
        await fetchJobDetail(
          jobIds[index]
        );

      results[index] = detail;

      if (
        searchToken ===
        currentSearchToken
      ) {
        updateSkillLoadingProgress(
          index + 1,
          jobIds.length
        );
      }
    }
  }

  const workerCount = Math.min(
    DETAIL_CONCURRENCY,
    jobIds.length
  );

  await Promise.all(
    Array.from(
      {
        length: workerCount,
      },
      () => worker()
    )
  );

  return results.filter(Boolean);
}

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

    const skillsInJob = new Set();

    for (const skill of detail.skills) {
      const name =
        normalizeSkillName(
          skill?.name
        );

      if (!name) {
        continue;
      }

      const key =
        normalizeSkillKey(name);

      if (skillsInJob.has(key)) {
        continue;
      }

      skillsInJob.add(key);

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

function renderSkillAnalysis(
  analysis,
  totalJobs
) {
  const container =
    $("skills-analysis");

  if (!container) {
    return;
  }

  const {
    skills,
    analyzedJobs,
  } = analysis;

  if (analyzedJobs === 0) {
    container.innerHTML = `
      <div class="skills-empty">
        اطلاعات مهارت برای این جستجو قابل استخراج نبود.
      </div>
    `;

    return;
  }

  if (!skills.length) {
    container.innerHTML = `
      <div class="skills-empty">
        در آگهی‌های بررسی‌شده مهارتی پیدا نشد.
      </div>
    `;

    return;
  }

  const topSkills =
    skills.slice(0, 20);

  const rows = topSkills
    .map((skill) => {
      const percentage =
        skill.percentage;

      return `
        <div class="skill-row">
          <div class="skill-row-header">
            <span class="skill-name">
              ${escapeHtml(skill.name)}
            </span>
            <span class="skill-percentage">
              ${formatNumber(skill.count)} آگهی
              (${formatPercent(percentage)})
            </span>
          </div>
          <div class="skill-bar-background">
            <div
              class="skill-bar"
              style="width: ${Math.min(
                percentage,
                100
              )}%"
            ></div>
          </div>
        </div>
      `;
    })
    .join("");

  const analyzedText =
    analyzedJobs === totalJobs
      ? `${formatNumber(
          analyzedJobs
        )} آگهی`
      : `${formatNumber(
          analyzedJobs
        )} از ${formatNumber(
          totalJobs
        )} آگهی`;

  container.innerHTML = `
    <div class="skills-summary">
      <strong>${analyzedText}</strong>
      برای استخراج مهارت‌ها بررسی شدند.
    </div>
    <div class="skills-list">
      ${rows}
    </div>
  `;
}

async function analyzeSearchSkills(
  jobs,
  searchToken
) {
  const validJobs =
    jobs.filter(
      (job) => job?.id
    );

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
    await fetchJobDetails(
      jobIds,
      searchToken
    );

  if (
    searchToken !==
    currentSearchToken
  ) {
    return;
  }

  const analysis =
    aggregateSkills(details);

  renderSkillAnalysis(
    analysis,
    validJobs.length
  );
}

function searchMetricsHtml(
  jobs,
  total
) {
  const salary =
    salaryAnalysis(jobs);

  const companies =
    new Set(
      jobs
        .map((job) =>
          normalizeText(job.company)
        )
        .filter(Boolean)
    ).size;

  const provinces =
    new Set(
      jobs
        .map((job) =>
          normalizeText(job.province)
        )
        .filter(Boolean)
    ).size;

  const remote =
    jobs.filter(
      (job) =>
        Boolean(job.is_remote)
    ).length;

  return `
    <div class="metrics">
      <div class="metric-card">
        <div class="value">
          ${formatNumber(total)}
        </div>
        <div class="label">
          💼 کل آگهی‌های پیدا شده
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(companies)}
        </div>
        <div class="label">
          🏢 شرکت‌ها
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(provinces)}
        </div>
        <div class="label">
          📍 استان‌ها
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(remote)}
        </div>
        <div class="label">
          🌐 دورکاری
        </div>
      </div>

      ${
        salary.average !== null
          ? `
            <div class="metric-card">
              <div class="value">
                ${formatNumber(
                  salary.average,
                  1
                )}
              </div>
              <div class="label">
                💰 میانگین حقوق (میلیون تومان)
              </div>
            </div>

            <div class="metric-card">
              <div class="value">
                ${formatNumber(
                  salary.count
                )}
              </div>
              <div class="label">
                📄 آگهی دارای اطلاعات حقوق
              </div>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function salaryAnalysisHtml(jobs) {
  const analysis =
    salaryAnalysis(jobs);

  if (analysis.count === 0) {
    return `
      <div class="info-box">
        💰 برای آگهی‌های این جستجو اطلاعات قابل استفاده‌ای از حقوق پیدا نشد.
      </div>
    `;
  }

  return `
    <div class="section-title">
      💰 تحلیل حقوق
    </div>

    <div class="metrics">
      <div class="metric-card">
        <div class="value">
          ${formatNumber(
            analysis.average,
            1
          )}
        </div>
        <div class="label">
          میانگین حقوق (میلیون تومان)
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(
            analysis.min,
            1
          )}
        </div>
        <div class="label">
          کمترین مقدار ثبت‌شده
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(
            analysis.max,
            1
          )}
        </div>
        <div class="label">
          بیشترین مقدار ثبت‌شده
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(
            analysis.count
          )}
        </div>
        <div class="label">
          آگهی دارای اطلاعات حقوق
        </div>
      </div>
    </div>

    <div
      class="charts-grid"
      id="salary-charts"
    ></div>
  `;
}

function renderSearchCharts(jobs) {
  const container =
    $("search-charts");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  makeBarChart(
    container,
    "🏢 برترین شرکت‌ها",
    countValues(
      jobs,
      (job) => job.company,
      10
    )
  );

  makeBarChart(
    container,
    "📍 موقعیت مکانی",
    countValues(
      jobs,
      (job) =>
        job.city ||
        job.province,
      10
    )
  );

  makeBarChart(
    container,
    "🎯 سطح تجربه",
    countValues(
      jobs,
      (job) => job.seniority
    )
  );

  makeBarChart(
    container,
    "📋 نوع همکاری",
    countValues(
      jobs,
      (job) => job.work_type
    )
  );

  makeBarChart(
    container,
    "💼 دسته‌بندی شغلی",
    countValues(
      jobs,
      (job) => job.categories,
      10
    )
  );

  const remoteCount =
    jobs.filter(
      (job) =>
        Boolean(job.is_remote)
    ).length;

  const nonRemoteCount =
    jobs.length - remoteCount;

  makeBarChart(
    container,
    "🌐 وضعیت دورکاری",
    [
      ["دورکاری", remoteCount],
      ["غیر دورکاری", nonRemoteCount],
    ]
  );
}

function renderSalaryChart(jobs) {
  const container =
    $("salary-charts");

  if (!container) {
    return;
  }

  const analysis =
    salaryAnalysis(jobs);

  makeBarChart(
    container,
    "💰 توزیع بازه حقوق",
    analysis.ranges.map(
      (item) => [
        item.label,
        item.count,
      ]
    )
  );
}

function renderSearchTable(jobs) {
  if (!jobs.length) {
    return `
      <div class="empty">
        آگهی‌ای پیدا نشد.
      </div>
    `;
  }

  const rows = jobs
    .slice(0, 200)
    .map((job) => {
      const jobUrl =
        `https://jobvision.ir/jobs/${encodeURIComponent(
          job.id
        )}?utm_source=github&utm_medium=jobvision_market_analysis&utm_campaign=zanko`;

      return `
        <tr>
          <td>
            <a
              href="${jobUrl}"
              target="_blank"
              rel="noopener noreferrer"
              class="job-link"
            >
              ${escapeHtml(job.title)}
            </a>
          </td>

          <td>
            ${escapeHtml(job.company)}
          </td>

          <td>
            ${escapeHtml(
              job.city ||
              job.province
            )}
          </td>

          <td>
            ${escapeHtml(
              job.seniority
            )}
          </td>

          <td>
            ${escapeHtml(
              job.work_type
            )}
          </td>

          <td>
            ${escapeHtml(
              job.salary
            )}
          </td>

          <td>
            <a
              href="${jobUrl}"
              target="_blank"
              rel="noopener noreferrer"
              class="job-link"
            >
              مشاهده آگهی
            </a>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="section-title">
      📄 لیست آگهی‌ها
    </div>

    <div class="results-table table-wrapper">
      <table>
        <thead>
          <tr>
            <th>عنوان</th>
            <th>شرکت</th>
            <th>شهر</th>
            <th>سطح تجربه</th>
            <th>نوع همکاری</th>
            <th>حقوق</th>
            <th>آگهی</th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    ${
      jobs.length > 200
        ? `
          <div class="info-box">
            فقط ۲۰۰ آگهی اول در جدول نمایش داده شده‌اند؛
            تحلیل‌ها بر اساس تمام ${formatNumber(
              jobs.length
            )} آگهی بارگذاری‌شده انجام شده‌اند.
          </div>
        `
        : ""
    }
  `;
}

function renderSearchResults(
  jobs,
  query,
  totalCount,
  isFallback = false
) {
  destroyCharts();

  currentSearchResults = jobs;

  document
    .querySelectorAll(".search-positions")
    .forEach((element) => element.remove());

  const searchSection =
    $("search-section");

  const overviewSection =
    $("overview-section");

  if (overviewSection) {
    overviewSection.classList.add(
      "hidden"
    );
  }

  if (searchSection) {
    searchSection.classList.remove(
      "hidden"
    );
  }

  const container =
    $("search-results");

  if (!container) {
    return;
  }

  if (!jobs.length) {
    container.innerHTML = `
      <div class="info-box">
        هیچ آگهی‌ای برای «${escapeHtml(
          query
        )}» پیدا نشد.
      </div>
    `;

    const skills =
      $("skills-analysis");

    if (skills) {
      skills.innerHTML = `
        <div class="skills-empty">
          آگهی‌ای برای تحلیل مهارت وجود ندارد.
        </div>
      `;
    }

    return;
  }

  const total =
    Number.isFinite(
      Number(totalCount)
    )
      ? Number(totalCount)
      : jobs.length;

  const shownNote =
    total > jobs.length
      ? ` (${formatNumber(
          jobs.length
        )} آگهی برای تحلیل بارگذاری شده؛ مجموع نتایج: ${formatNumber(
          total
        )})`
      : "";

  const fallbackNote =
    isFallback
      ? `
        <br>
        <small>
          ⚠️ دسترسی زنده به JobVision ممکن نشد؛
          نتایج زیر از داده‌های ذخیره‌شده فیلتر شده‌اند.
        </small>
      `
      : "";

  container.innerHTML = `
    <div class="info-box">
      ${formatNumber(
        total
      )} آگهی مطابق «${escapeHtml(
        query
      )}» پیدا شد
      ${shownNote}
      ${fallbackNote}
    </div>

    ${searchMetricsHtml(
      jobs,
      total
    )}

    ${salaryAnalysisHtml(jobs)}

    <div class="section-title">
      📊 تحلیل بازار این جستجو
    </div>

    <div
      class="charts-grid"
      id="search-charts"
    ></div>
  `;

  renderSearchCharts(jobs);
  renderSalaryChart(jobs);
}

function renderOverviewMetrics(jobs) {
  const container =
    $("metrics");

  if (!container) {
    return;
  }

  const companies =
    new Set(
      jobs
        .map((job) =>
          normalizeText(job.company)
        )
        .filter(Boolean)
    ).size;

  const provinces =
    new Set(
      jobs
        .map((job) =>
          normalizeText(job.province)
        )
        .filter(Boolean)
    ).size;

  const remote =
    jobs.filter(
      (job) =>
        Boolean(job.is_remote)
    ).length;

  container.innerHTML = `
    <div class="metric-card">
      <div class="value">
        ${formatNumber(jobs.length)}
      </div>
      <div class="label">
        💼 کل آگهی‌ها
      </div>
    </div>

    <div class="metric-card">
      <div class="value">
        ${formatNumber(companies)}
      </div>
      <div class="label">
        🏢 کارفرمایان
      </div>
    </div>

    <div class="metric-card">
      <div class="value">
        ${formatNumber(provinces)}
      </div>
      <div class="label">
        📍 استان‌ها
      </div>
    </div>

    <div class="metric-card">
      <div class="value">
        ${formatNumber(remote)}
      </div>
      <div class="label">
        🌐 دورکاری
      </div>
    </div>
  `;
}

function renderOverviewCarousel(jobs) {
  const container =
    $("job-carousel");

  if (!container) {
    return;
  }

  const sorted = [...jobs].sort(
    (a, b) =>
      new Date(
        b.activation_date || 0
      ) -
      new Date(
        a.activation_date || 0
      )
  );

  const top =
    sorted.slice(0, 20);

  container.innerHTML = top
    .map((job) => {
      const meta = [];

      if (job.province) {
        meta.push(
          `📍 ${job.province}`
        );
      }

      if (job.work_type) {
        meta.push(
          `💼 ${job.work_type}`
        );
      }

      if (job.seniority) {
        meta.push(
          `🎯 ${job.seniority}`
        );
      }

      if (job.is_remote) {
        meta.push("🌐 دورکاری");
      }

      return `
        <div class="job-card">
          <div class="job-title">
            ${escapeHtml(
              job.title ||
              "بدون عنوان"
            )}
          </div>

          <div class="job-company">
            🏢 ${escapeHtml(
              job.company ||
              "نامشخص"
            )}
          </div>

          ${meta
            .map(
              (item) => `
                <div class="job-meta">
                  ${escapeHtml(item)}
                </div>
              `
            )
            .join("")}
        </div>
      `;
    })
    .join("");
}

function renderOverviewCharts(jobs) {
  const chartIds = [
    "company-chart",
    "location-chart",
    "seniority-chart",
    "work-type-chart",
  ];

  for (const id of chartIds) {
    const canvas = $(id);

    if (!canvas) {
      continue;
    }

    const existing =
      Chart.getChart(canvas);

    if (existing) {
      existing.destroy();
    }
  }

  makeExistingCanvasChart(
    "company-chart",
    "تعداد آگهی",
    countValues(
      jobs,
      (job) => job.company,
      10
    )
  );

  makeExistingCanvasChart(
    "location-chart",
    "تعداد آگهی",
    countValues(
      jobs,
      (job) =>
        job.city ||
        job.province,
      10
    )
  );

  makeExistingCanvasChart(
    "seniority-chart",
    "تعداد آگهی",
    countValues(
      jobs,
      (job) => job.seniority
    )
  );

  makeExistingCanvasChart(
    "work-type-chart",
    "تعداد آگهی",
    countValues(
      jobs,
      (job) => job.work_type
    )
  );
}

function makeExistingCanvasChart(
  canvasId,
  label,
  entries
) {
  const canvas = $(canvasId);

  if (
    !canvas ||
    !entries.length
  ) {
    return;
  }

  const ctx =
    canvas.getContext("2d");

  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: entries.map(
        ([label]) => label
      ),
      datasets: [
        {
          label,
          data: entries.map(
            ([, count]) => count
          ),
          backgroundColor: "#ff4b4b",
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          beginAtZero: true,
        },
      },
    },
  });

  charts.push(chart);
}

function renderOverview(jobs) {
  destroyCharts();

  const overviewSection =
    $("overview-section");

  const searchSection =
    $("search-section");

  if (overviewSection) {
    overviewSection.classList.remove(
      "hidden"
    );
  }

  if (searchSection) {
    searchSection.classList.add(
      "hidden"
    );
  }

  renderOverviewMetrics(jobs);
  renderOverviewCarousel(jobs);
  renderOverviewCharts(jobs);
}

function setUpdatedAt(
  generatedAt,
  count
) {
  const element =
    $("updatedAt");

  if (!element) {
    return;
  }

  const parts = [];

  if (count) {
    parts.push(
      `${formatNumber(count)} آگهی`
    );
  }

  if (generatedAt) {
    const date =
      new Date(generatedAt);

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      parts.push(
        `به‌روزرسانی: ${date.toLocaleString(
          "fa-IR"
        )}`
      );
    }
  }

  element.textContent =
    parts.join(" • ");
}

async function loadOverviewData() {
  const loading = $("loading");

  try {
    const response =
      await fetch(
        DATA_URL,
        {
          cache: "no-store",
        }
      );

    if (!response.ok) {
      throw new Error(
        `Failed to load ${DATA_URL}: ${response.status}`
      );
    }

    const payload =
      await response.json();

    const jobs =
      Array.isArray(payload)
        ? payload
        : Array.isArray(
            payload?.jobs
          )
        ? payload.jobs
        : [];

    OVERVIEW_JOBS = jobs;

    setUpdatedAt(
      payload?.generated_at,
      payload?.count ?? jobs.length
    );

    renderOverview(jobs);

    if (loading) {
      loading.remove();
    }
  } catch (error) {
    console.error(
      "Failed to load overview data:",
      error
    );

    if (loading) {
      loading.textContent =
        "خطا در بارگذاری داده‌ها. لطفاً صفحه را دوباره بارگذاری کنید.";
    }
  }
}

function showSearchLoading(keyword) {
  const overview =
    $("overview-section");

  const search =
    $("search-section");

  if (overview) {
    overview.classList.add(
      "hidden"
    );
  }

  if (search) {
    search.classList.remove(
      "hidden"
    );
  }

  const results =
    $("search-results");

  if (results) {
    results.innerHTML = `
      <div class="info-box">
        🔍 در حال جستجوی زنده در JobVision برای
        «${escapeHtml(keyword)}»...
      </div>
    `;
  }

  const skills =
    $("skills-analysis");

  if (skills) {
    skills.innerHTML = `
      <div class="skills-empty">
        بعد از دریافت آگهی‌ها، مهارت‌ها نیز تحلیل خواهند شد.
      </div>
    `;
  }

  document
    .querySelectorAll(".search-positions")
    .forEach((element) => element.remove());
}

async function doSearch() {
  const input =
    $("search-input");

  const backButton =
    $("backBtn");

  if (!input) {
    return;
  }

  const keyword =
    input.value.trim();

  if (!keyword) {
    return;
  }

  const searchToken =
    ++currentSearchToken;

  if (backButton) {
    backButton.classList.remove(
      "hidden"
    );
  }

  showSearchLoading(keyword);

  try {
    const result =
      await liveSearch(keyword);

    if (
      searchToken !==
      currentSearchToken
    ) {
      return;
    }

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

    if (
      searchToken !==
      currentSearchToken
    ) {
      return;
    }

    const searchSection =
      $("search-section");

    if (!searchSection) {
      return;
    }

    const positions =
      document.createElement("div");

    positions.className =
      "search-positions";

    positions.innerHTML = `
      <div class="section-title">
        💼 پوزیشن‌های شغلی
      </div>

      ${renderSearchTable(
        result.jobs
      )}
    `;

    searchSection.appendChild(
      positions
    );
  } catch (error) {
    console.error(
      "Live search failed:",
      error
    );

    const query =
      keyword.toLowerCase();

    const filtered =
      OVERVIEW_JOBS.filter(
        (job) => {
          const title =
            normalizeText(
              job.title
            ).toLowerCase();

          const company =
            normalizeText(
              job.company
            ).toLowerCase();

          const categories =
            normalizeText(
              job.categories
            ).toLowerCase();

          return (
            title.includes(query) ||
            company.includes(query) ||
            categories.includes(query)
          );
        }
      );

    if (
      searchToken !==
      currentSearchToken
    ) {
      return;
    }

    renderSearchResults(
      filtered,
      keyword,
      filtered.length,
      true
    );

    const skills =
      $("skills-analysis");

    if (skills) {
      skills.innerHTML = `
        <div class="skills-empty">
          تحلیل مهارت در حالت داده‌ی ذخیره‌شده فعال نیست؛
          برای Skill Analysis باید جستجوی زنده موفق باشد.
        </div>
      `;
    }

    const searchSection =
      $("search-section");

    if (searchSection) {
      const positions =
        document.createElement("div");

      positions.className =
        "search-positions";

      positions.innerHTML = `
        <div class="section-title">
          💼 پوزیشن‌های شغلی
        </div>

        ${renderSearchTable(
          filtered
        )}
      `;

      searchSection.appendChild(
        positions
      );
    }
  }
}

function goBackToOverview() {
  ++currentSearchToken;

  currentSearchResults = [];

  const input =
    $("search-input");

  const backButton =
    $("backBtn");

  if (input) {
    input.value = "";
  }

  if (backButton) {
    backButton.classList.add(
      "hidden"
    );
  }

  renderOverview(
    OVERVIEW_JOBS
  );
}

document.addEventListener(
  "DOMContentLoaded",
  () => {
    const searchForm =
      $("search-form");

    const searchInput =
      $("search-input");

    const backButton =
      $("backBtn");

    if (
      searchForm &&
      searchInput
    ) {
      searchForm.addEventListener(
        "submit",
        async (event) => {
          event.preventDefault();
          await doSearch();
        }
      );
    }

    if (backButton) {
      backButton.addEventListener(
        "click",
        goBackToOverview
      );
    }

    loadOverviewData();
  }
);