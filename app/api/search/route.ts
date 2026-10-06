import { NextRequest } from "next/server";
import { searchDataRequest } from "@/lib/futu/api";

export async function GET(req: NextRequest) {
  return searchDataRequest(req);
}
