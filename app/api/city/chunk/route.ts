import { NextResponse } from "next/server";
import {
  CITY_PER_PAGE,
  CITY_RECENT_DAYS,
  CITY_USER_LIMIT,
  fetchCityPage,
} from "@/app/lib/city-data";

function parseIntParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const pageIndex = parseIntParam(searchParams.get("pageIndex"), 1, 1, 10000);
  const perPage = parseIntParam(searchParams.get("perPage"), CITY_PER_PAGE, 1, 100);
  const userLimit = parseIntParam(
    searchParams.get("userLimit"),
    CITY_USER_LIMIT,
    1,
    perPage,
  );
  const recentDays = parseIntParam(
    searchParams.get("recentDays"),
    CITY_RECENT_DAYS,
    1,
    365,
  );
  const includeLogs = searchParams.get("includeLogs") !== "0";

  const payload = await fetchCityPage(pageIndex, {
    perPage,
    userLimit,
    recentDays,
    includeLogs,
    cache: "no-store",
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
