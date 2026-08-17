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
        roles: isBootstrapManager ? ["manager"] : user?.app_metadata?.roles?.length ? user.app_metadata.roles : ["member"],
      },
    }),
  };
};

export { handler };
