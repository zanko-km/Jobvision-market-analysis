// Deploy this on Cloudflare Workers (free tier, no credit card needed).
// It simply forwards POST requests to the JobVision API and adds the
// CORS header that lets your GitHub Pages site call it from the browser.

const TARGET = "https://candidateapi.jobvision.ir/api/v1/JobPost/List";

// Only your Pages site is allowed to use this proxy.
const ALLOWED_ORIGIN = "https://zanko-km.github.io";

export default {
  async fetch(request) {
    // Handle the browser's CORS preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();

    const upstream = await fetch(TARGET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const data = await upstream.text();

    return new Response(data, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      },
    });
  },
};
