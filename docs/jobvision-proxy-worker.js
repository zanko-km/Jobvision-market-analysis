const SEARCH_TARGET =
  "https://candidateapi.jobvision.ir/api/v1/JobPost/List";

const JOB_PAGE_TARGET = "https://jobvision.ir/jobs/";

const ALLOWED_ORIGIN = "https://zanko-km.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSkillName(name) {
  return name
    .replace(/\s+/g, " ")
    .trim();
}

function extractSkills(html) {
  const skills = [];

  /*
   * Expected JobVision structure:
   *
   * <app-tag>
   *   ...
   *   <span class="tag-title">Python</span>
   *   <span class="tag-value">پیشرفته</span>
   *   ...
   * </app-tag>
   */

  const tagRegex =
    /<app-tag[\s\S]*?<span[^>]*class=["'][^"']*tag-title[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class=["'][^"']*tag-value[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/app-tag>/gi;

  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const name = normalizeSkillName(stripHtml(match[1]));
    const level = stripHtml(match[2]);

    if (!name) {
      continue;
    }

    skills.push({
      name,
      level: level || null,
    });
  }

  /*
   * Remove duplicate skills inside the same job.
   */
  const unique = [];
  const seen = new Set();

  for (const skill of skills) {
    const key = skill.name.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(skill);
  }

  return unique;
}

async function handleJobDetail(url) {
  const id = url.searchParams.get("id");

  if (!id || !/^\d+$/.test(id)) {
    return jsonResponse(
      {
        error: "Invalid job id",
      },
      400
    );
  }

  try {
    const jobUrl = `${JOB_PAGE_TARGET}${id}`;

    const upstream = await fetch(jobUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; JobVisionMarketAnalysis/1.0)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
      },
    });

    if (!upstream.ok) {
      return jsonResponse(
        {
          error: `Job page returned ${upstream.status}`,
          id: Number(id),
        },
        upstream.status
      );
    }

    const html = await upstream.text();

    const skills = extractSkills(html);

    return jsonResponse({
      id: Number(id),
      skills,
      skillCount: skills.length,
      source: "jobvision-html",
    });
  } catch (error) {
    return jsonResponse(
      {
        error: String(error),
        id: Number(id),
      },
      502
    );
  }
}

async function handleSearch(request) {
  try {
    const body = await request.text();

    const upstream = await fetch(SEARCH_TARGET, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    const data = await upstream.text();

    return new Response(data, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: String(error),
      },
      502
    );
  }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);

    /*
     * GET /job-detail?id=1504056
     */
    if (
      request.method === "GET" &&
      url.pathname === "/job-detail"
    ) {
      return handleJobDetail(url);
    }

    /*
     * POST /
     *
     * Existing JobVision search proxy.
     */
    if (
      request.method === "POST" &&
      url.pathname === "/"
    ) {
      return handleSearch(request);
    }

    return jsonResponse(
      {
        error: "Not found",
      },
      404
    );
  },
};