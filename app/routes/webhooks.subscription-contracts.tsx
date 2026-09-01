import crypto from "crypto";
import type { ActionFunctionArgs } from "@remix-run/node";

export const action = async ({ request }: ActionFunctionArgs) => {
  const body = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = request.headers.get("x-shopify-shop-domain") ?? "";

  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  const generated = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(hmac))) {
    console.error(`[webhook] HMAC mismatch for ${topic} from ${shop}`);
    console.error(`[webhook] expected: ${generated}`);
    console.error(`[webhook] received: ${hmac}`);
    return new Response(null, { status: 401 });
  }

  try {
    const payload = JSON.parse(body);
    console.log(`[webhook] ${topic} for ${shop}`, JSON.stringify(payload).slice(0, 500));
  } catch {
    console.log(`[webhook] ${topic} for ${shop} (non-JSON body)`);
  }

  return new Response(null, { status: 200 });
};
