import { NextRequest } from "next/server";
import { stockDataRequest } from "@/lib/futu/api";

export async function GET(req: NextRequest) {
  return stockDataRequest(req, "ratings");
}
