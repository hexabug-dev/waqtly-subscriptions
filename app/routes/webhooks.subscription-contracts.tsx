import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);
    console.log(`[webhook] ${topic} for ${shop}`, JSON.stringify(payload));
    return new Response(null, { status: 200 });
  } catch (err) {
    // Log the real error so we can diagnose — still return 200 to stop Shopify retries
    console.error("[webhook] validation error:", err instanceof Error ? err.message : String(err));
    console.error("[webhook] headers:", Object.fromEntries(request.headers.entries()));
    return new Response(null, { status: 200 });
  }
};
