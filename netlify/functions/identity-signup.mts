import type { Handler } from "@netlify/functions";

// Netlify Identity lifecycle functions require the legacy named handler export.
const handler: Handler = async (event) => {
  const { user } = JSON.parse(event.body || "{}");
  const bootstrapEmail = (Netlify.env.get("BOOTSTRAP_MANAGER_EMAIL") || "").trim().toLowerCase();
  const isBootstrapManager = bootstrapEmail && user?.email?.toLowerCase() === bootstrapEmail;
  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...(user?.app_metadata || {}),
        // Public signup creates an inert account. A manager must approve it before any company data is visible.
        roles: isBootstrapManager ? ["manager"] : ["pending"],
      },
    }),
  };
};

export { handler };
