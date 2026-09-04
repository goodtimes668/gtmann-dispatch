import type { Handler } from "@netlify/functions";

function getBootstrapManagerEmail() {
  try {
    return (globalThis.Netlify?.env.get("BOOTSTRAP_MANAGER_EMAIL") || "").trim().toLowerCase();
  } catch {
    // Identity lifecycle hooks use Netlify's legacy function runtime. An optional
    // bootstrap setting must never prevent an ordinary requester from signing up.
    return "";
  }
}

// Netlify Identity lifecycle functions require the legacy named handler export.
const handler: Handler = async (event) => {
  const { user } = JSON.parse(event.body || "{}");
  const bootstrapEmail = getBootstrapManagerEmail();
  const isBootstrapManager = bootstrapEmail && user?.email?.toLowerCase() === bootstrapEmail;
  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...(user?.app_metadata || {}),
        // Public signup can create requester accounts only. Elevated access is assigned by a manager later.
        roles: isBootstrapManager ? ["manager"] : ["member"],
      },
    }),
  };
};

export { handler };
