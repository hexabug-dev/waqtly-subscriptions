import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} for ${shop}`, JSON.stringify(payload));

  // TODO: forward to hooks.waqtly.com when backend is ready
  // await fetch("https://hooks.waqtly.com/subscriptions/created", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });

  return new Response();
};
