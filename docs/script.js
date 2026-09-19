const JOBVISION_API =
  "https://jobvision-market-analysis.vercel.app";

const PAGE_SIZE = 30;
const MAX_LIVE_PAGES = 300;
const LIVE_PAGE_CONCURRENCY = 3;

const SEARCH_TIMEOUT_MS = 17000;

const DETAIL_CONCURRENCY = 50;

const DATA_URL = "data/jobs.json";

const JOBS_PER_PAGE_OPTIONS = [
  5,
  10,
  20,
  50,
  200,
];

const DEFAULT_JOBS_PER_PAGE = 5;

let currentJobsPage = 1;
let currentJobsPerPage =
  DEFAULT_JOBS_PER_PAGE;

let OVERVIEW_JOBS = [];
let currentSearchResults = [];
let currentSearchToken = 0;

let activeSearchController = null;

const jobDetailCache = new Map();
const charts = [];

const $ = (id) =>
  document.getElementById(id);

/* =========================================================
   GENERAL HELPERS
========================================================= */

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
      String(
        "۰۱۲۳۴۵۶۷۸۹".indexOf(digit)
      )
    )
    .replace(/[٠-٩]/g, (digit) =>
      String(
        "٠١٢٣٤٥٦٧٨٩".indexOf(digit)
      )
    );
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString(
    "fa-IR",
    {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }
  );
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) {
    return "0%";
  }

  return `${Number(value).toFixed(1)}%`;
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function destroyCharts() {
  while (charts.length) {
    const chart = charts.pop();

    try {
      chart.destroy();
    } catch (error) {
      console.warn(
        "Failed to destroy chart:",
        error
      );
    }
  }
}

/* =========================================================
   VALUE / CATEGORY HELPERS
========================================================= */

function valueToLabels(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        valueToLabels(item)
      )
      .filter(Boolean);
  }

  const text = normalizeText(value);

  return text ? [text] : [];
}

function countValues(
  jobs,
  getter,
  limit = null
) {
  const counts = new Map();

  for (const job of jobs) {
    const values = valueToLabels(
      getter(job)
    );

    for (const value of values) {
      counts.set(
        value,
        (counts.get(value) || 0) + 1
      );
    }
  }

  const entries = [...counts.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  return limit
    ? entries.slice(0, limit)
    : entries;
}

/* =========================================================
   CHARTS
========================================================= */

function makeBarChart(
  container,
  title,
  entries
) {
  if (
    !container ||
    !entries.length ||
    typeof Chart === "undefined"
  ) {
    return;
  }

  const box =
    document.createElement("div");

  box.className = "chart-box";

  const heading =
    document.createElement("h3");

  heading.textContent = title;

  const canvas =
    document.createElement("canvas");

  box.appendChild(heading);
  box.appendChild(canvas);
  container.appendChild(box);

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
          label: title,

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

function makeExistingCanvasChart(
  canvasId,
  label,
  entries
) {
  const canvas = $(canvasId);

  if (
    !canvas ||
    !entries.length ||
    typeof Chart === "undefined"
  ) {
    return;
  }

  const existing =
    Chart.getChart(canvas);

  if (existing) {
    existing.destroy();
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

/* =========================================================
   SALARY
========================================================= */

function parseSalary(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  // JobVision salary object
  if (
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const min = Number(value.min);
    const max = Number(value.max);

    if (
      Number.isFinite(min) &&
      Number.isFinite(max)
    ) {
      return {
        min,
        max,
        average: (min + max) / 2,
      };
    }

    if (Number.isFinite(min)) {
      return {
        min,
        max: min,
        average: min,
      };
    }

    if (Number.isFinite(max)) {
      return {
        min: max,
        max,
        average: max,
      };
    }

    // Fallback to Persian/English title
    value =
      value.titleFa ??
      value.titleEn ??
      "";
  }

  let text = normalizeDigits(
    String(value)
  );

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

  const lower =
    text.toLowerCase();

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

    if (item.unit === "میلیارد") {
      return item.value * 1000;
    }

    if (item.unit === "هزار") {
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
      average:
        (values[0] + values[1]) / 2,
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
    .map((job) =>
      parseSalary(job.salary)
    )
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

  const averages = salaries.map(
    (item) => item.average
  );

  const average =
    averages.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / averages.length;

  const min = Math.min(
    ...salaries.map(
      (item) => item.min
    )
  );

  const max = Math.max(
    ...salaries.map(
      (item) => item.max
    )
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

/* =========================================================
   LIVE SEARCH
========================================================= */

async function fetchLivePage(
  keyword,
  page,
  signal
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, SEARCH_TIMEOUT_MS);

  const abortHandler = () => {
    controller.abort();
  };

  signal?.addEventListener(
    "abort",
    abortHandler,
    { once: true }
  );

  try {
    console.log(
      `Requesting JobVision page ${page}`
    );

    const response = await fetch(
      `${JOBVISION_API}/`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Accept:
            "application/json",

          "Cache-Control":
            "no-cache",
        },

        body: JSON.stringify({
          jobCategoryUrlTitle:
            null,

          keyword,

          locationWrapper:
            null,

          pageSize:
            PAGE_SIZE,

          requestedPage:
            page,

          sortBy: 1,

          searchId: null,
        }),

        signal:
          controller.signal,

        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error(
        `JobVision returned HTTP ${response.status}`
      );
    }

    const json =
      await response.json();
    if (!json?.data) {
      throw new Error(
        "Unexpected JobVision response"
      );
    }

    return json.data;
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw error;
    }

    throw error;
  } finally {
    clearTimeout(timeout);

    signal?.removeEventListener(
      "abort",
      abortHandler
    );
  }
}

function rawJobToRecord(job) {
  return {
    id:
      job.id ??
      null,

    title:
      job.title ??
      "",

    company:
      job.company?.nameFa ??
      job.company?.nameEn ??
      "",

    province:
      job.location?.province?.titleFa ??
      job.location?.province?.titleEn ??
      "",

    city:
      job.location?.city?.titleFa ??
      job.location?.city?.titleEn ??
      "",

    categories:
      Array.isArray(job.jobCategories)
        ? job.jobCategories
            .map(category =>
              category?.titleFa ??
              category?.titleEn ??
              ""
            )
            .filter(Boolean)
        : [],

    benefits:
      Array.isArray(job.benefits)
        ? job.benefits
            .map(benefit =>
              benefit?.titleFa ??
              benefit?.titleEn ??
              ""
            )
            .filter(Boolean)
        : [],

    work_type:
      job.workType?.titleFa ??
      job.workType?.titleEn ??
      "",

    seniority:
      job.seniorityLevel?.titleFa ??
      job.seniorityLevel?.titleEn ??
      "",

    industry:
      job.industry?.titleFa ??
      job.industry?.titleEn ??
      "",

    gender:
      job.gender?.titleFa ??
      job.gender?.titleEn ??
      "",

    is_remote:
      Boolean(job.properties?.isRemote),

    is_internship:
      Boolean(job.properties?.isInternship),

    is_urgent:
      Boolean(job.properties?.isUrgent),

    experience_years:
      job.properties?.requiredRelatedExperienceYears ??
      null,

    salary:
      job.salary ??
      "",

    activation_date:
      job.activationTime?.date ??
      job.firstActivationTime?.date ??
      "",

    expire_date:
      job.expireTime?.date ??
      "",
  };
}

function getJobId(job) {
  return (
    job?.id ??
    job?.jobPostId ??
    job?.jobPostID ??
    null
  );
}

function dedupeJobs(jobs) {
  const result = [];
  const seen = new Set();

  for (const job of jobs) {
    const id =
      getJobId(job);

    if (id == null) {
      continue;
    }

    const key = String(id);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(job);
  }

  return result;
}

function extractJobsFromPage(
  data
) {
  if (
    Array.isArray(
      data?.jobPosts
    )
  ) {
    return data.jobPosts;
  }

  if (
    Array.isArray(data?.jobs)
  ) {
    return data.jobs;
  }

  if (
    Array.isArray(data?.items)
  ) {
    return data.items;
  }

  return [];
}

async function fetchPageBatch(
  keyword,
  pages,
  signal
) {
  const results =
    await Promise.allSettled(
      pages.map((page) =>
        fetchLivePage(
          keyword,
          page,
          signal
        )
      )
    );

  const successful = [];
  const failed = [];

  results.forEach(
    (result, index) => {
      const page =
        pages[index];

      if (
        result.status ===
        "fulfilled"
      ) {
        successful.push({
          page,
          data:
            result.value,
        });
      } else {
        failed.push({
          page,
          error:
            result.reason,
        });
      }
    }
  );

  successful.sort(
    (a, b) =>
      a.page - b.page
  );

  failed.sort(
    (a, b) =>
      a.page - b.page
  );

  return {
    successful,
    failed,
  };
}

async function liveSearch(
  keyword,
  onProgress,
  signal
) {
  const normalizedKeyword =
    String(keyword || "").trim();

  if (!normalizedKeyword) {
    return {
      jobs: [],
      total: 0,
      loadedPages: 0,
      totalPages: 0,
    };
  }

  const firstPage =
    await fetchLivePage(
      normalizedKeyword,
      1,
      signal
    );

  const total =
    Number(
      firstPage.jobPostCount ??
        firstPage.totalCount ??
        firstPage.count ??
        0
    );

  let jobs =
    dedupeJobs(
      extractJobsFromPage(
        firstPage
      ).map(
        rawJobToRecord
      )
    );

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total / PAGE_SIZE
      )
    );

  const pagesToLoad =
    Math.min(
      totalPages,
      MAX_LIVE_PAGES
    );

  onProgress?.({
    jobs,
    total,
    loadedPages: 1,
    totalPages:
      pagesToLoad,

    complete:
      pagesToLoad === 1,
  });

  if (
    pagesToLoad <= 1
  ) {
    return {
      jobs,
      total,
      loadedPages: 1,
      totalPages:
        pagesToLoad,
    };
  }

  let loadedPages = 1;
  const failedPages = new Set();
  for (
    let start = 2;
    start <= pagesToLoad;
    start +=
      LIVE_PAGE_CONCURRENCY
  ) {
    if (
      signal?.aborted
    ) {
      throw new DOMException(
        "Search cancelled",
        "AbortError"
      );
    }

    const pages = [];

    for (
      let page = start;
      page <=
        Math.min(
          start + LIVE_PAGE_CONCURRENCY - 1,
          pagesToLoad
        );
      page++
    ) {
      pages.push(page);
    }

    const batch =
      await fetchPageBatch(
        normalizedKeyword,
        pages,
        signal
      );

    for (
      const item of
        batch.successful
    ) {
      jobs.push(
        ...extractJobsFromPage(
          item.data
        ).map(
          rawJobToRecord
        )
      );
    }

    jobs =
      dedupeJobs(jobs);

    loadedPages +=
      batch.successful.length;

    if (batch.failed.length) {
      for (const item of batch.failed) {
        failedPages.add(item.page);
      }
    }

    onProgress?.({
      jobs,
      total,
      loadedPages,
      totalPages:
        pagesToLoad,

      failedPages:
        batch.failed.map(
          (item) =>
            item.page
        ),

      complete:
        start +
          LIVE_PAGE_CONCURRENCY >
        pagesToLoad,
    });
  }
  const MAX_SEARCH_PAGE_RETRIES = 2;

  for (
    let retry = 1;
    retry <= MAX_SEARCH_PAGE_RETRIES &&
    failedPages.size > 0;
    retry++
  ) {
    const pagesToRetry = [
      ...failedPages,
    ];

    console.log(
      `Retrying ${pagesToRetry.length} failed search pages (attempt ${retry}/${MAX_SEARCH_PAGE_RETRIES})...`,
      pagesToRetry
    );

    const retryBatch =
      await fetchPageBatch(
        normalizedKeyword,
        pagesToRetry,
        signal
      );

    for (const item of retryBatch.successful) {
      jobs.push(
        ...extractJobsFromPage(
          item.data
        ).map(
          rawJobToRecord
        )
      );

      failedPages.delete(
        item.page
      );

      loadedPages++;
    }

    jobs = dedupeJobs(jobs);

    onProgress?.({
      jobs,
      total,
      loadedPages,
      totalPages: pagesToLoad,
      failedPages: [
        ...failedPages,
      ],
      complete:
        failedPages.size === 0,
    });
  }

  if (failedPages.size) {
    console.warn(
      "Search pages still failed after retries:",
      [...failedPages]
    );
  }
  return {
    jobs,
    total,
    loadedPages,
    totalPages:
      pagesToLoad,
  };
}

/* =========================================================
   SKILL ANALYSIS
========================================================= */

function normalizeSkillName(name) {
  return normalizeText(name);
}

function normalizeSkillKey(name) {
  return normalizeSkillName(
    name
  ).toLowerCase();
}

async function fetchJobDetail(
  jobId,
  signal
) {
  if (!jobId) {
    return null;
  }

  const key =
    String(jobId);

  if (
    jobDetailCache.has(key)
  ) {
    return jobDetailCache.get(
      key
    );
  }

  const url =
    `${JOBVISION_API}/job-detail?id=${encodeURIComponent(
      jobId
    )}`;

  try {
    const response =
      await fetch(url, {
        method: "GET",
        cache: "force-cache",
        signal,
      });

    if (!response.ok) {
      throw new Error(
        `Job detail returned HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    jobDetailCache.set(
      key,
      data
    );

    return data;
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw error;
    }

    console.warn(
      `Job detail failed for ${jobId}:`,
      error
    );

    return null;
  }
}

function updateSkillLoadingProgress(
  current,
  total
) {
  const element =
    $("skills-loading");

  if (!element) {
    return;
  }

  element.textContent =
    `در حال تحلیل مهارت‌های ${formatNumber(
      current
    )} از ${formatNumber(
      total
    )} آگهی...`;
}

function showSkillLoading(
  total
) {
  const container =
    $("skills-analysis");

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
  searchToken,
  signal
) {
  const uniqueIds = [
    ...new Set(
      jobIds
        .filter(Boolean)
        .map(String)
    ),
  ];

  const results =
    new Map();

  let completed = 0;
  let cursor = 0;

  updateSkillLoadingProgress(
    0,
    uniqueIds.length
  );

  async function worker() {
    while (true) {
      if (
        searchToken !==
        currentSearchToken
      ) {
        return;
      }

      if (
        signal?.aborted
      ) {
        return;
      }

      const index =
        cursor++;

      if (
        index >=
        uniqueIds.length
      ) {
        return;
      }

      const id =
        uniqueIds[index];

      try {
        const data =
          await fetchJobDetail(
            id,
            signal
          );

        if (data) {
          results.set(
            id,
            data
          );
        }
      } catch (error) {
        if (
          error?.name ===
          "AbortError"
        ) {
          return;
        }

        console.warn(
          `Skill detail failed for ${id}:`,
          error
        );
      }

      completed++;

      updateSkillLoadingProgress(
        completed,
        uniqueIds.length
      );
    }
  }

  const workerCount =
    Math.min(
      DETAIL_CONCURRENCY,
      uniqueIds.length
    );

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      worker
    )
  );

  return results;
}

function aggregateSkills(
  details
) {
  const skillCounts =
    new Map();

  let analyzedJobs = 0;

  for (
    const detail of details
  ) {
    if (
      !detail ||
      detail.failed ||
      !Array.isArray(
        detail.skills
      )
    ) {
      continue;
    }

    analyzedJobs++;

    const skillsInJob =
      new Set();

    for (
      const skill of
        detail.skills
    ) {
      const name =
        normalizeSkillName(
          skill?.name
        );

      if (!name) {
        continue;
      }

      const key =
        normalizeSkillKey(
          name
        );

      if (
        skillsInJob.has(key)
      ) {
        continue;
      }

      skillsInJob.add(key);

      if (
        !skillCounts.has(key)
      ) {
        skillCounts.set(
          key,
          {
            name,
            count: 0,
          }
        );
      }

      skillCounts.get(
        key
      ).count++;
    }
  }

  const skills = [
    ...skillCounts.values(),
  ]
    .map((skill) => ({
      ...skill,

      percentage:
        analyzedJobs > 0
          ? (skill.count /
              analyzedJobs) *
            100
          : 0,
    }))
    .sort((a, b) => {
      if (
        b.count !==
        a.count
      ) {
        return (
          b.count -
          a.count
        );
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

  if (
    analyzedJobs === 0
  ) {
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

  const rows =
    topSkills
      .map((skill) => {
        const percentage =
          skill.percentage;

        return `
          <div class="skill-row">
            <div class="skill-row-header">
              <span class="skill-name">
                ${escapeHtml(
                  skill.name
                )}
              </span>

              <span class="skill-percentage">
                ${formatNumber(
                  skill.count
                )} آگهی
                (${formatPercent(
                  percentage
                )})
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
    analyzedJobs ===
    totalJobs
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
  searchToken,
  signal
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
      searchToken,
      signal
    );

  if (
    searchToken !==
    currentSearchToken
  ) {
    return;
  }

  const analysis =
    aggregateSkills(
      details.values()
    );

  renderSkillAnalysis(
    analysis,
    validJobs.length
  );
}

/* =========================================================
   SEARCH METRICS
========================================================= */

function searchMetricsHtml(
  jobs,
  total
) {
  const companies =
    new Set(
      jobs
        .map((job) =>
          normalizeText(
            job.company
          )
        )
        .filter(Boolean)
    ).size;

  const provinces =
    new Set(
      jobs
        .map((job) =>
          normalizeText(
            job.province
          )
        )
        .filter(Boolean)
    ).size;

  const remote =
    jobs.filter(
      (job) =>
        Boolean(
          job.is_remote
        )
    ).length;

  return `
    <div class="metrics">
      <div class="metric-card">
        <div class="value">
          ${formatNumber(
            total
          )}
        </div>

        <div class="label">
          💼 کل آگهی‌های پیدا شده
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(
            companies
          )}
        </div>

        <div class="label">
          🏢 شرکت‌ها
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(
            provinces
          )}
        </div>

        <div class="label">
          📍 استان‌ها
        </div>
      </div>

      <div class="metric-card">
        <div class="value">
          ${formatNumber(
            remote
          )}
        </div>

        <div class="label">
          🌐 دورکاری
        </div>
      </div>
    </div>
  `;
}

function salaryAnalysisHtml(
  jobs
) {
  const analysis =
    salaryAnalysis(jobs);

  const salaries = jobs
    .map((job) => {
      const parsed =
        parseSalary(
          job.salary
        );

      if (!parsed) {
        return null;
      }

      return {
        job,
        ...parsed,
      };
    })
    .filter(Boolean);

  const minSalaryJob =
    salaries.find(
      (item) =>
        item.min ===
        analysis.min
    );

  const maxSalaryJob =
    salaries.find(
      (item) =>
        item.max ===
        analysis.max
    );

  if (
    analysis.count === 0
  ) {
    return `
      <div class="info-box">
        💰 برای آگهی‌های این جستجو اطلاعات قابل استفاده‌ای از حقوق پیدا نشد.
      </div>
    `;
  }

  const buildJobLink =
    (job) => {
      if (!job?.id) {
        return "";
      }

      return `
        <a
          href="https://jobvision.ir/jobs/${encodeURIComponent(
            job.id
          )}?utm_source=github&utm_medium=jobvision_market_analysis&utm_campaign=zanko"
          target="_blank"
          rel="noopener noreferrer"
          class="job-link"
        >
          مشاهده آگهی →
        </a>
      `;
    };

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

        ${buildJobLink(
          minSalaryJob?.job
        )}
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

        ${buildJobLink(
          maxSalaryJob?.job
        )}
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

/* =========================================================
   SEARCH CHARTS
========================================================= */

function renderSearchCharts(
  jobs
) {
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
      (job) =>
        job.company,
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
      (job) =>
        job.seniority
    )
  );

  makeBarChart(
    container,
    "📋 نوع همکاری",
    countValues(
      jobs,
      (job) =>
        job.work_type
    )
  );

  makeBarChart(
    container,
    "💼 دسته‌بندی شغلی",
    countValues(
      jobs,
      (job) =>
        job.categories,
      10
    )
  );

  const remoteCount =
    jobs.filter(
      (job) =>
        Boolean(
          job.is_remote
        )
    ).length;

  const nonRemoteCount =
    jobs.length -
    remoteCount;

  makeBarChart(
    container,
    "🌐 وضعیت دورکاری",
    [
      [
        "دورکاری",
        remoteCount,
      ],
      [
        "غیر دورکاری",
        nonRemoteCount,
      ],
    ]
  );
}

function renderSalaryChart(
  jobs
) {
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

/* =========================================================
   SEARCH TABLE
========================================================= */

function renderSearchTable(
  jobs
) {
  const container =
    $("search-positions");

  if (!container) {
    return;
  }

  if (!jobs.length) {
    container.innerHTML = `
      <div class="section-title">
        💼 پوزیشن‌های شغلی
      </div>

      <div class="empty">
        آگهی‌ای پیدا نشد.
      </div>
    `;

    return;
  }

  const totalJobs =
    jobs.length;

  const totalPages =
    Math.ceil(
      totalJobs /
        currentJobsPerPage
    );

  if (
    currentJobsPage >
    totalPages
  ) {
    currentJobsPage =
      totalPages;
  }

  const startIndex =
    (currentJobsPage - 1) *
    currentJobsPerPage;

  const endIndex =
    startIndex +
    currentJobsPerPage;

  const pageJobs =
    jobs.slice(
      startIndex,
      endIndex
    );

  const rows =
    pageJobs
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
                ${escapeHtml(
                  job.title
                )}
              </a>
            </td>

            <td>
              ${escapeHtml(
                job.company
              )}
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

  const pageButtons = [];

  function addPageButton(
    page
  ) {
    pageButtons.push(`
      <button
        type="button"
        class="pagination-button ${
          page === currentJobsPage
            ? "active"
            : ""
        }"
        data-page="${page}"
      >
        ${formatNumber(page)}
      </button>
    `);
  }

  function addEllipsis() {
    pageButtons.push(`
      <span class="pagination-ellipsis">
        ...
      </span>
    `);
  }

  if (
    totalPages <= 7
  ) {
    for (
      let page = 1;
      page <= totalPages;
      page++
    ) {
      addPageButton(page);
    }
  } else {
    addPageButton(1);

    if (
      currentJobsPage > 4
    ) {
      addEllipsis();
    }

    const startPage =
      Math.max(
        2,
        currentJobsPage - 2
      );

    const endPage =
      Math.min(
        totalPages - 1,
        currentJobsPage + 2
      );

    for (
      let page = startPage;
      page <= endPage;
      page++
    ) {
      addPageButton(page);
    }

    if (
      currentJobsPage <
      totalPages - 3
    ) {
      addEllipsis();
    }

    addPageButton(
      totalPages
    );
  }

  const paginationHtml =
    totalPages > 1
      ? `
        <div class="pagination">

          <button
            type="button"
            class="pagination-button"
            data-page="${
              currentJobsPage - 1
            }"
            ${
              currentJobsPage ===
              1
                ? "disabled"
                : ""
            }
          >
            قبلی
          </button>

          ${pageButtons.join(
            ""
          )}

          <button
            type="button"
            class="pagination-button"
            data-page="${
              currentJobsPage + 1
            }"
            ${
              currentJobsPage ===
              totalPages
                ? "disabled"
                : ""
            }
          >
            بعدی
          </button>

        </div>
      `
      : "";

  const startDisplay =
    startIndex + 1;

  const endDisplay =
    Math.min(
      endIndex,
      totalJobs
    );

  container.innerHTML = `
    <div class="section-title">
      💼 پوزیشن‌های شغلی
    </div>

    <div class="jobs-toolbar">

      <div class="jobs-count">
        نمایش ${formatNumber(
          startDisplay
        )} تا ${formatNumber(
          endDisplay
        )} از ${formatNumber(
          totalJobs
        )} آگهی
      </div>

      <div class="jobs-per-page">

        <label for="jobs-per-page">
          تعداد در هر صفحه:
        </label>

        <select id="jobs-per-page">

          ${JOBS_PER_PAGE_OPTIONS
            .map(
              (size) => `
                <option
                  value="${size}"
                  ${
                    size ===
                    currentJobsPerPage
                      ? "selected"
                      : ""
                  }
                >
                  ${size}
                </option>
              `
            )
            .join("")}

        </select>

      </div>
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

    ${paginationHtml}
  `;

  const pageButtonsElements =
    container.querySelectorAll(
      ".pagination-button[data-page]"
    );

  pageButtonsElements.forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          const page =
            Number(
              button.dataset.page
            );

          if (
            !Number.isFinite(
              page
            ) ||
            page < 1 ||
            page >
              totalPages ||
            page ===
              currentJobsPage
          ) {
            return;
          }

          currentJobsPage =
            page;

          renderSearchTable(
            currentSearchResults
          );

          container.scrollIntoView(
            {
              behavior:
                "smooth",
              block:
                "start",
            }
          );
        }
      );
    }
  );

  const pageSizeSelect =
    $("jobs-per-page");

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener(
      "change",
      () => {
        currentJobsPerPage =
          Number(
            pageSizeSelect.value
          );

        currentJobsPage = 1;

        renderSearchTable(
          currentSearchResults
        );
      }
    );
  }
}

/* =========================================================
   SEARCH RESULTS
========================================================= */

function renderSearchResults(
  jobs,
  query,
  totalCount,
  isFallback = false
) {
  destroyCharts();

  currentSearchResults =
    jobs;

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

    ${salaryAnalysisHtml(
      jobs
    )}

    <div class="section-title">
      📊 تحلیل بازار این جستجو
    </div>

    <div
      class="charts-grid"
      id="search-charts"
    ></div>

    <div id="search-positions"></div>
  `;

  renderSearchCharts(
    jobs
  );

  renderSalaryChart(
    jobs
  );

  currentJobsPage = 1;

  currentJobsPerPage =
    DEFAULT_JOBS_PER_PAGE;

  renderSearchTable(
    jobs
  );
}

/* =========================================================
   OVERVIEW
========================================================= */

function renderOverviewMetrics(
  jobs
) {
  const container =
    $("metrics");

  if (!container) {
    return;
  }

  const companies =
    new Set(
      jobs
        .map((job) =>
          normalizeText(
            job.company
          )
        )
        .filter(Boolean)
    ).size;

  const provinces =
    new Set(
      jobs
        .map((job) =>
          normalizeText(
            job.province
          )
        )
        .filter(Boolean)
    ).size;

  const remote =
    jobs.filter(
      (job) =>
        Boolean(
          job.is_remote
        )
    ).length;

  container.innerHTML = `
    <div class="metric-card">
      <div class="value">
        ${formatNumber(
          jobs.length
        )}
      </div>

      <div class="label">
        💼 کل آگهی‌ها
      </div>
    </div>

    <div class="metric-card">
      <div class="value">
        ${formatNumber(
          companies
        )}
      </div>

      <div class="label">
        🏢 کارفرمایان
      </div>
    </div>

    <div class="metric-card">
      <div class="value">
        ${formatNumber(
          provinces
        )}
      </div>

      <div class="label">
        📍 استان‌ها
      </div>
    </div>

    <div class="metric-card">
      <div class="value">
        ${formatNumber(
          remote
        )}
      </div>

      <div class="label">
        🌐 دورکاری
      </div>
    </div>
  `;
}

function renderOverviewCarousel(
  jobs
) {
  const container =
    $("job-carousel");

  if (!container) {
    return;
  }

  const sorted =
    [...jobs].sort(
      (a, b) =>
        new Date(
          b.activation_date ||
            0
        ) -
        new Date(
          a.activation_date ||
            0
        )
    );

  const top =
    sorted.slice(0, 20);

  container.innerHTML =
    top
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
          meta.push(
            "🌐 دورکاری"
          );
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
                    ${escapeHtml(
                      item
                    )}
                  </div>
                `
              )
              .join("")}

          </div>
        `;
      })
      .join("");
}

function renderOverviewCharts(
  jobs
) {
  const chartIds = [
    "company-chart",
    "location-chart",
    "seniority-chart",
    "work-type-chart",
  ];

  for (
    const id of chartIds
  ) {
    const canvas = $(id);

    if (!canvas) {
      continue;
    }

    if (
      typeof Chart !==
      "undefined"
    ) {
      const existing =
        Chart.getChart(
          canvas
        );

      if (existing) {
        existing.destroy();
      }
    }
  }

  makeExistingCanvasChart(
    "company-chart",
    "تعداد آگهی",
    countValues(
      jobs,
      (job) =>
        job.company,
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
      (job) =>
        job.seniority
    )
  );

  makeExistingCanvasChart(
    "work-type-chart",
    "تعداد آگهی",
    countValues(
      jobs,
      (job) =>
        job.work_type
    )
  );
}

function renderOverview(
  jobs
) {
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

  renderOverviewMetrics(
    jobs
  );

  renderOverviewCarousel(
    jobs
  );

  renderOverviewCharts(
    jobs
  );
}

/* =========================================================
   OVERVIEW DATA
========================================================= */

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
      `${formatNumber(
        count
      )} آگهی`
    );
  }

  if (generatedAt) {
    const date =
      new Date(
        generatedAt
      );

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
  const loading =
    $("loading");

  try {
    const response =
      await fetch(
        DATA_URL,
        {
          cache:
            "no-store",
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

    OVERVIEW_JOBS =
      jobs;

    setUpdatedAt(
      payload?.generated_at,
      payload?.count ??
        jobs.length
    );

    renderOverview(
      jobs
    );

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

/* =========================================================
   SEARCH LOADING
========================================================= */

function showSearchLoading(
  keyword
) {
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
        «${escapeHtml(
          keyword
        )}»...

        <br><br>

        <span
          id="searchLoadingStatus"
        >
          در حال اتصال به JobVision...
        </span>

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
}

function updateSearchLoadingStatus(
  message
) {
  const status =
    $("searchLoadingStatus");

  if (status) {
    status.textContent =
      message;
  }
}

/* =========================================================
   MAIN SEARCH
========================================================= */

async function doSearch() {
  const input =
    document.querySelector(
      "#search-input"
    ) ||
    document.querySelector(
      "#searchInput"
    );

  const query =
    input?.value?.trim();

  if (!query) {
    return;
  }

  /*
   * Abort previous search completely.
   */
  if (
    activeSearchController
  ) {
    activeSearchController.abort();
  }

  const controller =
    new AbortController();

  activeSearchController =
    controller;

  const searchToken =
    ++currentSearchToken;

  showSearchLoading(
    query
  );

  try {
    const result =
      await liveSearch(
        query,

        ({
          jobs,
          total,
          loadedPages,
          totalPages,
          complete,
          failedPages,
        }) => {
          if (
            searchToken !==
            currentSearchToken
          ) {
            return;
          }

          /*
           * IMPORTANT:
           * Do NOT render the entire search UI
           * on every page.
           *
           * Only update the loading text.
           */
          if (complete) {
            updateSearchLoadingStatus(
              `جستجو کامل شد — ${formatNumber(
                jobs.length
              )} آگهی دریافت شد`
            );
          } else {
            let message =
              `در حال دریافت نتایج... صفحه ${formatNumber(
                loadedPages
              )} از ${formatNumber(
                totalPages
              )}`;

            if (
              failedPages?.length
            ) {
              message +=
                ` — ${failedPages.length} صفحه ناموفق`;
            }

            updateSearchLoadingStatus(
              message
            );
          }
        },

        controller.signal
      );

    if (
      searchToken !==
      currentSearchToken
    ) {
      return;
    }

    /*
     * Render exactly once after search finishes.
     */
    renderSearchResults(
      result.jobs,
      query,
      result.total
    );

    updateSearchLoadingStatus(
      `جستجو کامل شد — ${formatNumber(
        result.jobs.length
      )} آگهی بارگذاری شد`
    );

    /*
     * Skill analysis happens after
     * search results are already visible.
     *
     * It is limited to MAX_SKILL_ANALYSIS_JOBS.
     */
    await analyzeSearchSkills(
      result.jobs,
      searchToken,
      controller.signal
    );
  } catch (error) {
    if (
      searchToken !==
      currentSearchToken
    ) {
      return;
    }

    if (
      error?.name ===
      "AbortError"
    ) {
      return;
    }

    console.error(
      "Live search failed:",
      error
    );

    updateSearchLoadingStatus(
      "جستجوی زنده ناموفق بود؛ در حال استفاده از داده‌های ذخیره‌شده..."
    );

    const normalizedQuery =
      normalizeText(query);

    const fallback =
      OVERVIEW_JOBS.filter(
        (job) => {
          const text =
            normalizeText(
              [
                job.title,
                job.company,
                job.city,
                job.province,
                ...(Array.isArray(
                  job.categories
                )
                  ? job.categories
                  : []),
              ].join(" ")
            );

          return text.includes(
            normalizedQuery
          );
        }
      );

    renderSearchResults(
      fallback,
      query,
      fallback.length,
      true
    );
  } finally {
    if (
      activeSearchController ===
      controller
    ) {
      activeSearchController =
        null;
    }
  }
}

/* =========================================================
   BACK
========================================================= */

function goBackToOverview() {
  ++currentSearchToken;

  if (
    activeSearchController
  ) {
    activeSearchController.abort();
    activeSearchController =
      null;
  }

  currentSearchResults =
    [];

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

/* =========================================================
   DOM READY
========================================================= */

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